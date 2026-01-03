import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildRequisitionHtml } from '@/lib/requisition-html';
import crypto from 'crypto';
import { Resend } from 'resend';
import { buildRequisitionText } from '@/lib/requisition-text';

const resend = new Resend(process.env.RESEND_API_KEY!);


export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Resend client not needed directly in this route; email sending is delegated to /api/email/send

function randomToken() {
  return crypto.randomBytes(24).toString('hex'); // 48 chars
}
function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

// ultra-simple HTML -> text for copy/paste + textarea fallback
function htmlToText(html: string) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const TS_BLOCK_START = "\n\n---\nTITLE SEARCH NOTES (FROM LAWYER)\n";
const TS_BLOCK_END = "\n---\n";

function stripTitleSearchBlock(text: string) {
  if (!text) return text;
  const i = text.indexOf(TS_BLOCK_START);
  if (i === -1) return text;
  return text.slice(0, i).trimEnd();
}

function formatBullets(items: string[]) {
  const clean = (items || [])
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (clean.length === 0) return "";
  return clean.map((s) => `- ${s}`).join("\n");
}

function appendTitleSearchNotesToText(draftText: string, appended: string[]) {
  const base = stripTitleSearchBlock(draftText);

  const bullets = formatBullets(appended);
  if (!bullets) return base;

  return `${base}${TS_BLOCK_START}${bullets}${TS_BLOCK_END}`;
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const transactionId = body?.transactionId as string | undefined;

    if (!transactionId) {
      return NextResponse.json(
        { ok: false, message: 'transactionId is required' },
        { status: 400 }
      );
    }

    const { data: tx, error: txErr } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('id', transactionId)
      .maybeSingle();

    if (txErr) {
      return NextResponse.json(
        { ok: false, message: 'Failed to load transaction', error: txErr.message },
        { status: 500 }
      );
    }
    if (!tx) {
      return NextResponse.json(
        { ok: false, message: 'Transaction not found' },
        { status: 404 }
      );
    }

    const shouldGenerate =
      tx.workflow_status === 'TITLE_SEARCH_RECEIVED' &&
      !!tx.title_search_data &&
      (!tx.requisition_letter_draft || String(tx.requisition_letter_draft).trim().length === 0);

    if (!shouldGenerate) {
      return NextResponse.json({
        ok: true,
        message: 'No automation needed',
        workflow_status: tx.workflow_status,
        has_title: !!tx.title_search_data,
        has_draft: !!tx.requisition_letter_draft,
      });
    }

    // ✅ title_search_data in your system already contains "notes" array (e.g., ["1 PIN", "Writs clear"...])
    const titleSearch = tx.title_search_data || {};
    const notesRaw = (titleSearch as any)?.notes;
    const notes: string[] = Array.isArray(notesRaw)
      ? notesRaw.filter((s: any) => typeof s === 'string' && s.trim())
      : [];

    // optional: lawyer additions if you later add them
    const additionsRaw = (titleSearch as any)?.lawyer_additions;
    const additions: string[] = Array.isArray(additionsRaw)
      ? additionsRaw.filter((s: any) => typeof s === 'string' && s.trim())
      : [];

    const appended = [...notes, ...additions];

    // Load firm profile (used by template)
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, firm_name, email, phone, address_line')
      .eq('id', tx.user_id)
      .maybeSingle();

  const html = buildRequisitionHtml({
  transaction: tx,
  profile: profile || null,
  title: titleSearch,
  appended,
});

// ✅ text should come from the real text template (NOT htmlToText)
const text = buildRequisitionText({
  transaction: tx,
  profile: profile || null,
  appended, // still appended at text layer (as you want)
});



    // ✅ Save BOTH html + text
   const { error: updErr } = await supabaseAdmin
  .from('transactions')
  .update({
    requisition_letter_draft: text,      // ✅ always plain text with appended notes
    requisition_letter_draft_html: html,      // keep HTML as-is for later “View as HTML”
    requisition_letter_generated_at: new Date().toISOString(),
    workflow_status: 'REQUISITION_DRAFT_READY',
  })
  .eq('id', tx.id);


    if (updErr) {
      return NextResponse.json(
        { ok: false, message: 'Failed to save requisition draft', error: updErr.message },
        { status: 500 }
      );
    }

    // Create approval link (optional if lawyer_email exists)
    const token = randomToken();
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(); // 24h

    await supabaseAdmin.from('approval_links').insert({
      transaction_id: transactionId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    
    

    // ✅ Outbound email (lawyer approval) — guarded + debuggable
   // const resendKeyOk = !!process.env.RESEND_API_KEY;
    //const from = process.env.RESEND_FROM_EMAIL; // must be verified domain email
    //const appUrl = process.env.APP_PUBLIC_URL;

const lawyerEmail = (tx as any).lawyer_email as string | undefined;

if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
  await supabaseAdmin
    .from('transactions')
    .update({ workflow_status: 'REQUISITION_DRAFT_READY_AWAITING_EMAIL_CONFIG' })
    .eq('id', transactionId);

  return NextResponse.json({
    ok: true,
    message: 'Draft generated; missing email config',
    transactionId: tx.id,
  });
}

if (!lawyerEmail) {
  await supabaseAdmin
    .from('transactions')
    .update({ workflow_status: 'REQUISITION_DRAFT_READY_AWAITING_LAWYER_EMAIL' })
    .eq('id', transactionId);

  return NextResponse.json({
    ok: true,
    message: 'Draft generated; missing lawyer email',
    transactionId: tx.id,
  });
}

// build baseUrl robustly (works in dev & prod)
const baseUrl =
  process.env.APP_PUBLIC_URL?.replace(/\/$/, '') ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

const approveUrl = `${baseUrl}/lawyer/approve/${tx.id}?token=${token}`;

try {
  const { data: outbox, error: outboxErr } = await supabaseAdmin
    .from('email_outbox')
    .insert({
      transaction_id: tx.id,
      kind: 'LAWYER_APPROVAL',
      to_email: lawyerEmail,
      subject: `Lawyer Approval - ${tx.file_number}`,
      status: 'QUEUED',
    })
    .select('id')
    .maybeSingle();

  if (outboxErr) throw outboxErr;
  if (!outbox?.id) throw new Error('email_outbox insert did not return id');

  const result = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: lawyerEmail,
    subject: `Lawyer Approval - ${tx.file_number}`,
    html: `
      <p>Please review and approve:</p>
      <p><a href="${approveUrl}" target="_blank" rel="noopener noreferrer">Review & approve</a></p>
    `,
  });

  await supabaseAdmin
    .from('email_outbox')
    .update({
      status: 'SENT',
      sent_at: new Date().toISOString(),
      provider_message_id: result.data?.id ?? null,
      error: null,
    })
    .eq('id', outbox.id);

  await supabaseAdmin
    .from('transactions')
    .update({ workflow_status: 'REQUISITION_SENT_TO_LAWYER' })
    .eq('id', transactionId);

  return NextResponse.json({
    ok: true,
    message: 'Draft generated and lawyer email sent/queued',
    transactionId: tx.id,
  });

} catch (e: any) {
  try {
    await supabaseAdmin
      .from('email_outbox')
      .update({
        status: 'FAILED',
        error: e?.message ?? String(e),
      })
      .eq('transaction_id', tx.id)
      .eq('kind', 'LAWYER_APPROVAL');
  } catch {}

  await supabaseAdmin
    .from('transactions')
    .update({ workflow_status: 'REQUISITION_DRAFT_READY_EMAIL_FAILED' })
    .eq('id', transactionId);

  return NextResponse.json(
    {
      ok: true,
      message: 'Draft generated but lawyer email failed',
      transactionId: tx.id,
      email_error: e?.message ?? String(e),
    },
    { status: 200 }
  );
}

}catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Unexpected error in automations/run',
        error: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
