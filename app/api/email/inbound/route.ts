import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry<T>(
  fn: () => Promise<T>,
  attempts = 4,
  delayMs = 350
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

function normalizeToken(t: string) {
  return t.trim().replace(/\s+/g, ' ');
}

/**
 * Supports:
 *  - "Searches - 100"
 *  - "Searches - PG-2025-0012"
 *  - "File No: PG-2025-0012"
 *  - "File #: 100"
 *  - "[FILE: PG-2025-0012]"
 *  - "(File No PG-2025-0012)"
 */
function extractFileNumberFromText(text: string): string | null {
  if (!text) return null;

  // Prefer "Searches - ..." since that's your current workflow
  // Capture everything up to a separator/end (avoid grabbing full sentence)
  const searches = text.match(/Searches\s*[-:]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{0,40})/i);
  if (searches?.[1]) return normalizeToken(searches[1]);

  // File No / File # variants
  const fileNo = text.match(/\bFile\s*(?:No\.?|Number|#)\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{0,40})\b/i);
  if (fileNo?.[1]) return normalizeToken(fileNo[1]);

  // Bracketed tags like [FILE: ...] or (FILE: ...)
  const bracketed = text.match(/[\[\(]\s*FILE\s*[:\-]\s*([A-Za-z0-9][A-Za-z0-9\-\/]{0,40})\s*[\]\)]/i);
  if (bracketed?.[1]) return normalizeToken(bracketed[1]);

  // As a last resort: pick the most "file-like" token after a dash (risky; keep conservative)
  // Example: "Searches - PG-2025-0012 - 125 Brookside"
  const dashToken = text.match(/-\s*([A-Za-z]{1,6}-\d{2,4}-\d{2,6})\b/);
  if (dashToken?.[1]) return normalizeToken(dashToken[1]);

  return null;
}

function extractFileNumber(subject: string, bodyText?: string): string | null {
  return (
    extractFileNumberFromText(subject) ||
    extractFileNumberFromText(bodyText || '') ||
    null
  );
}


async function extractTitleFacts(bodyText: string, subject: string) {
  const prompt = `
You are an Ontario real estate law clerk assistant.
You are given an email from a lawyer summarizing a title search.
Extract ONLY the title-search facts and return ONLY valid JSON.

Use this exact JSON structure:
{
  "pin_count": number|null,
  "writs_clear": boolean|null,
  "mortgages_present": boolean|null,
  "easements_or_restrictions_noted": boolean|null,
  "tax_arrears_noted": boolean|null,
  "notes": ["string"]
}

Rules:
- If not mentioned, set fields to null.
- notes must be short bullet-style phrases.
- notes must include at least 1 item summarizing the overall result.
- No markdown, no extra keys.

Email subject: ${subject}
Email body:
${bodyText}
`.trim();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return strictly valid JSON only.' },
      { role: 'user', content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content || '{}';
  return JSON.parse(content);
}

async function extractLawyerAdditions(bodyText: string, subject: string) {
  const prompt = `
You are an Ontario real estate law clerk assistant.
From the same title-search email, extract any lawyer instructions or custom requisitions that should be ADDED to the requisition letter.

Return ONLY valid JSON in this exact format:
{
  "additions": ["string"],
  "flags": ["string"]
}

Rules:
- additions must be concrete requisition points (one sentence each), suitable to paste into the requisition letter as numbered items.
- If something is unclear/ambiguous, put it into flags instead of additions.
- If there are no additions, return additions: [].
- No markdown, no extra keys.

Email subject: ${subject}
Email body:
${bodyText}
`.trim();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Return strictly valid JSON only.' },
      { role: 'user', content: prompt },
    ],
  });

  const content = completion.choices[0]?.message?.content || '{"additions":[],"flags":[]}';
  const parsed = JSON.parse(content);

  const additions: string[] = Array.isArray(parsed?.additions)
    ? parsed.additions.filter((s: any) => typeof s === 'string' && s.trim())
    : [];

  const flags: string[] = Array.isArray(parsed?.flags)
    ? parsed.flags.filter((s: any) => typeof s === 'string' && s.trim())
    : [];

  return { additions, flags };
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => null);

    const providerMessageId =
      payload?.data?.id ||
      payload?.id ||
      payload?.message_id ||
      payload?.data?.message_id ||
      null;

    const toEmail =
      payload?.data?.to?.[0] ||
      payload?.to?.[0] ||
      payload?.to ||
      null;

    const fromEmail = payload?.data?.from || payload?.from || null;

    const subject = payload?.data?.subject || payload?.subject || '(no subject)';

    const bodyText = payload?.data?.text || payload?.text || '';
    const bodyHtml = payload?.data?.html || payload?.html || null;

    // 1) Insert inbound email first (best effort with retries)
    const insertRes = await retry(async () => {
      return await supabaseAdmin
        .from('inbox_emails')
        .insert({
          provider: 'resend',
          provider_message_id: providerMessageId,
          to_email: toEmail,
          from_email: fromEmail,
          subject,
          body_text: bodyText,
          body_html: bodyHtml,
          status: 'RECEIVED',
        })
        .select('id, subject, body_text')
        .single();
    });

    const inserted = (insertRes as any)?.data;
    const insertError = (insertRes as any)?.error;

    if (insertError || !inserted) {
      return NextResponse.json(
        { ok: false, message: 'Failed to save inbound email', error: insertError?.message },
        { status: 500 }
      );
    }

    // 2) Match transaction by file number
    const fileNumber = extractFileNumber(subject);

    if (!fileNumber) {
      await supabaseAdmin.from('inbox_emails').update({ status: 'UNASSIGNED' }).eq('id', inserted.id);

      return NextResponse.json({
        ok: true,
        message: 'Inbound email saved (no file number found)',
        inboxEmailId: inserted.id,
        matched: false,
      });
    }

    const { data: tx, error: txErr } = await supabaseAdmin
      .from('transactions')
      .select('id, file_number, workflow_status')
      .eq('file_number', fileNumber)
      .maybeSingle();

    if (txErr || !tx) {
      await supabaseAdmin.from('inbox_emails').update({ status: 'UNASSIGNED' }).eq('id', inserted.id);

      return NextResponse.json({
        ok: true,
        message: 'Inbound email saved (no matching transaction)',
        inboxEmailId: inserted.id,
        fileNumber,
        matched: false,
      });
    }

    await supabaseAdmin
      .from('inbox_emails')
      .update({ status: 'MATCHED', transaction_id: tx.id })
      .eq('id', inserted.id);

    // 3) Extract (A) title facts and (B) lawyer additions
    const [titleFacts, lawyer] = await Promise.all([
      extractTitleFacts(bodyText || '', subject),
      extractLawyerAdditions(bodyText || '', subject),
    ]);

    const nowIso = new Date().toISOString();

    // 4) Step A: mark received + status
    const stepA = await retry(async () => {
      const { error } = await supabaseAdmin
        .from('transactions')
        .update({
          title_search_received_at: nowIso,
          workflow_status: 'TITLE_SEARCH_RECEIVED',
        })
        .eq('id', tx.id);
      return { error };
    });

    if ((stepA as any)?.error) {
      const msg = (stepA as any).error.message || 'Unknown error';
      await supabaseAdmin.from('inbox_emails').update({ status: 'ERROR', error: msg }).eq('id', inserted.id);

      return NextResponse.json(
        { ok: false, message: 'Matched email but failed to update transaction (step A)', error: msg, transactionId: tx.id },
        { status: 500 }
      );
    }

    // 5) Step B: save title_search_data (facts + lawyer additions/flags)
    const title_search_data = {
      ...titleFacts,
      lawyer_additions: lawyer.additions,
      lawyer_flags: lawyer.flags,
      source_inbox_email_id: inserted.id,
      updated_at: nowIso,
    };

    const stepB = await retry(async () => {
      const { error } = await supabaseAdmin
        .from('transactions')
        .update({
          title_search_data,
        })
        .eq('id', tx.id);
      return { error };
    });

    if ((stepB as any)?.error) {
      const msg = (stepB as any).error.message || 'Unknown error';
      await supabaseAdmin.from('inbox_emails').update({ status: 'ERROR', error: msg }).eq('id', inserted.id);

      return NextResponse.json(
        {
          ok: false,
          message: 'Matched email but failed to update transaction (step B)',
          error: msg,
          transactionId: tx.id,
          extracted: title_search_data,
        },
        { status: 500 }
      );
    }

    // 6) Verify saved state (Bolt transient “fetch failed” protection)
    const { data: verifyTx } = await supabaseAdmin
      .from('transactions')
      .select('id, title_search_received_at, title_search_data, workflow_status')
      .eq('id', tx.id)
      .maybeSingle();

    const looksSaved =
      !!verifyTx?.title_search_received_at &&
      !!verifyTx?.title_search_data &&
      verifyTx?.workflow_status === 'TITLE_SEARCH_RECEIVED';

    // 7) Trigger automations AFTER verified save (best effort)
    if (looksSaved) {
      try {
        const base = process.env.APP_PUBLIC_URL?.trim();
        if (base) {
          await fetch(`${base}/api/automations/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionId: tx.id }),
          }).catch(() => null);
        }
      } catch {
        // ignore
      }

      await supabaseAdmin.from('inbox_emails').update({ status: 'PROCESSED' }).eq('id', inserted.id);

      return NextResponse.json({
        ok: true,
        message: 'Inbound email processed',
        transactionId: tx.id,
        extracted: title_search_data,
      });
    }

    await supabaseAdmin
      .from('inbox_emails')
      .update({ status: 'ERROR', error: 'Verify failed: title search not persisted' })
      .eq('id', inserted.id);

    return NextResponse.json(
      {
        ok: false,
        message: 'Inbound matched but verification failed (possible transient DB write issue)',
        transactionId: tx.id,
        extracted: title_search_data,
      },
      { status: 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: 'Inbound email handler failed', error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
