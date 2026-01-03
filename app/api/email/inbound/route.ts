import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry<T>(
  fn: () => Promise<T>,
  attempts = 4,
  delayMs = 250
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
function isEmail(s: string | null | undefined) {
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

/**
 * Try to find an email in body/signature. Conservative: first match only.
 */
function extractEmailFromText(text: string) {
  if (!text) return null;
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m?.[0]?.trim() ?? null;
}

/**
 * Priority:
 * 1) fromEmail (best signal)
 * 2) any email found in body text (fallback)
 */
function deriveLawyerEmail(fromEmail: string | null, bodyText: string) {
  if (isEmail(fromEmail)) return fromEmail!.trim();
  const fromBody = extractEmailFromText(bodyText);
  if (isEmail(fromBody)) return fromBody!.trim();
  return null;
}

/**
 * Resend inbound payloads are inconsistent across modes.
 * This tries multiple shapes and falls back gracefully.
 */
function pickString(...vals: any[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return '';
}

function htmlToText(html: string): string {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function extractFileNumber(subject: string): string | null {
  const s = String(subject || '').trim();

  // Preferred: exact file_number present, e.g. AIC-2025-000001
  const m1 = s.match(/\b[A-Z]{2,6}-\d{4}-\d{4,8}\b/i);
  if (m1?.[0]) return m1[0];

  // Also accept: "Searches - 251220-9452" style
  const m2 = s.match(/\b\d{6}-\d{3,6}\b/);
  if (m2?.[0]) return m2[0];

  // Last resort: any 4-10 digit token (only if you still use those somewhere)
  const m3 = s.match(/\b\d{4,10}\b/);
  if (m3?.[0]) return m3[0];

  return null;
}

async function extractTitleFacts(bodyText: string, subject: string) {
  const prompt = `
You are an assistant for Ontario real estate law clerks.
You are given a short email from a lawyer summarizing title search results.
Extract facts and return ONLY valid JSON.

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
- "notes" should preserve key bullet points as short items.
- "notes" must contain at least 1 short bullet summarizing the key findings.
- No extra keys, no markdown, no commentary.

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
You are an assistant for Ontario real estate law clerks.

From this email, extract:
1) "additions": a list of requisition additions the lawyer wants (short bullet strings)
2) "flags": any risks/issues to pay attention to (short bullet strings)

Return ONLY valid JSON in this exact structure:
{
  "additions": ["string"],
  "flags": ["string"]
}

Rules:
- If none, return empty arrays.
- No extra keys, no markdown.

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

  const additions = Array.isArray(parsed?.additions)
    ? parsed.additions.filter((s: any) => typeof s === 'string' && s.trim())
    : [];
  const flags = Array.isArray(parsed?.flags)
    ? parsed.flags.filter((s: any) => typeof s === 'string' && s.trim())
    : [];

  return { additions, flags };
}

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json().catch(() => null);

    // Provider message id (used for idempotency)
    const providerMessageId =
      payload?.data?.id ||
      payload?.id ||
      payload?.message_id ||
      payload?.data?.message_id ||
      null;

    const subject = pickString(
      payload?.data?.subject,
      payload?.subject,
      '(no subject)'
    );

    // Try multiple inbound shapes for email addresses
    const toEmail = pickString(
      payload?.data?.to?.[0],
      payload?.to?.[0],
      payload?.to
    );

    const fromEmail = pickString(payload?.data?.from, payload?.from);

    // Try multiple inbound shapes for bodies
    const bodyHtml = pickString(
      payload?.data?.html,
      payload?.html,
      payload?.data?.email?.html,
      payload?.data?.content?.html
    );

    const bodyTextRaw = pickString(
      payload?.data?.text,
      payload?.text,
      payload?.data?.email?.text,
      payload?.data?.content?.text
    );

    const bodyText = bodyTextRaw || (bodyHtml ? htmlToText(bodyHtml) : '');

    // 1) Insert inbound email first (idempotent-ish)
    const insertRes = await retry(async () => {
      return await supabaseAdmin
        .from('inbox_emails')
        .insert({
          provider: 'resend',
          provider_message_id: providerMessageId,
          to_email: toEmail || null,
          from_email: fromEmail || null,
          subject,
          body_text: bodyText || null,
          body_html: bodyHtml || null,
          status: 'RECEIVED',
        })
        .select('id, subject')
        .single();
    });

    const inserted = (insertRes as any)?.data;
    const insertError = (insertRes as any)?.error;

    // Duplicate handling (if you have a unique constraint on provider_message_id)
    if (
      insertError &&
      String(insertError.message || '').toLowerCase().includes('duplicate')
    ) {
      return NextResponse.json({ ok: true, message: 'Duplicate ignored' });
    }

    if (insertError || !inserted) {
      return NextResponse.json(
        { ok: false, message: 'Failed to save inbound email', error: insertError?.message },
        { status: 500 }
      );
    }

    // 2) Match transaction by file number
    const fileNumber = extractFileNumber(subject);

    if (!fileNumber) {
      await supabaseAdmin
        .from('inbox_emails')
        .update({ status: 'UNASSIGNED' })
        .eq('id', inserted.id);

      return NextResponse.json({
        ok: true,
        message: 'Inbound email saved (no file number found)',
        inboxEmailId: inserted.id,
        matched: false,
      });
    }

    const { data: tx, error: txErr } = await supabaseAdmin
      .from('transactions')
      .select('id, file_number, workflow_status, title_search_received_at, title_search_data')
      .eq('file_number', fileNumber)
      .maybeSingle();

    if (txErr || !tx) {
      await supabaseAdmin
        .from('inbox_emails')
        .update({ status: 'UNASSIGNED' })
        .eq('id', inserted.id);

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

    // 3) Extract (A) title facts and (B) lawyer additions/flags
    const [titleFacts, lawyer] = await Promise.all([
      extractTitleFacts(bodyText || '', subject),
      extractLawyerAdditions(bodyText || '', subject),
    ]);

    const nowIso = new Date().toISOString();
    const derivedLawyerEmail = deriveLawyerEmail(fromEmail, bodyText || '');

// Only set lawyer_email if it's currently null/empty
if (derivedLawyerEmail) {
  const { data: existingTx } = await supabaseAdmin
    .from('transactions')
    .select('lawyer_email')
    .eq('id', tx.id)
    .maybeSingle();

  const alreadySet = !!(existingTx as any)?.lawyer_email;

  if (!alreadySet) {
    await supabaseAdmin
      .from('transactions')
      .update({ lawyer_email: derivedLawyerEmail })
      .eq('id', tx.id);
  }

  // Optional: also stamp this into title_search_data for traceability
  // (do this where you build title_search_data)
}
    // 4) Step A: mark received + workflow
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
      await supabaseAdmin
        .from('inbox_emails')
        .update({ status: 'ERROR', error: msg })
        .eq('id', inserted.id);

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
  source_from_email: fromEmail,
  derived_lawyer_email: derivedLawyerEmail,
  updated_at: nowIso,
};


    const stepB = await retry(async () => {
      const { error } = await supabaseAdmin
        .from('transactions')
        .update({ title_search_data })
        .eq('id', tx.id);
      return { error };
    });

    if ((stepB as any)?.error) {
      const msg = (stepB as any).error.message || 'Unknown error';
      await supabaseAdmin
        .from('inbox_emails')
        .update({ status: 'ERROR', error: msg })
        .eq('id', inserted.id);

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

    // 6) Verify saved state (protect against transient infra errors)
    const { data: verifyTx } = await supabaseAdmin
      .from('transactions')
      .select('id, title_search_received_at, title_search_data, workflow_status, requisition_letter_draft')
      .eq('id', tx.id)
      .maybeSingle();

    const looksSaved =
      !!verifyTx?.title_search_received_at &&
      !!verifyTx?.title_search_data &&
      verifyTx?.workflow_status === 'TITLE_SEARCH_RECEIVED';

    if (!looksSaved) {
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
    }

    // 7) Trigger automations AFTER verified save (best effort)
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

    await supabaseAdmin
      .from('inbox_emails')
      .update({ status: 'PROCESSED' })
      .eq('id', inserted.id);

    return NextResponse.json({
      ok: true,
      message: 'Inbound email processed',
      transactionId: tx.id,
      extracted: title_search_data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: 'Inbound email handler failed', error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
