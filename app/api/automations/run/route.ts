import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildRequisitionHtml } from '@/lib/requisition-html';
import crypto from 'crypto';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY || '');

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
      appended, // ✅ append to end as main points
    });

    const text = htmlToText(html);

    // ✅ Save BOTH html + text
    const { error: updErr } = await supabaseAdmin
      .from('transactions')
      .update({
        requisition_letter_draft: text,
        requisition_letter_draft_html: html,
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
    const resendKeyOk = !!process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL; // must be verified domain email
    const appUrl = process.env.APP_PUBLIC_URL;

    const lawyerEmail = (tx as any).lawyer_email as string | undefined;

    if (lawyerEmail && resendKeyOk && from && appUrl) {
      const approveUrl = `${appUrl}/lawyer/approve/${transactionId}?token=${token}`;

      try {
        await fetch(`${process.env.APP_PUBLIC_URL}/api/email/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId: tx.id,
            kind: 'LAWYER_APPROVAL',
            to: tx.client_email,
            subject: `Lawyer Approval - ${tx.file_number}`,
            html: `
              <p>Please review and approve:</p>
              <p>
                <a href="${approveUrl}" target="_blank" rel="noopener noreferrer">
                  Open intake form
                </a>
              </p>
            `,
          }),
        });
      } catch (err) {
        console.error('Failed to send lawyer approval email', err);
      }
      
try{
        await supabaseAdmin
          .from('transactions')
          .update({ workflow_status: 'REQUISITION_SENT_TO_LAWYER' })
          .eq('id', transactionId);
      } catch (e: any) {
        // Don’t fail the whole automation if email fails — just keep draft ready
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
    } else if (!lawyerEmail) {
      await supabaseAdmin
        .from('transactions')
        .update({ workflow_status: 'REQUISITION_DRAFT_READY_AWAITING_LAWYER_EMAIL' })
        .eq('id', transactionId);
    } else {
      await supabaseAdmin
        .from('transactions')
        .update({ workflow_status: 'REQUISITION_DRAFT_READY_AWAITING_EMAIL_CONFIG' })
        .eq('id', transactionId);
    }

    return NextResponse.json({
      ok: true,
      message: 'Requisition draft generated',
      transactionId: tx.id,
      appended_count: appended.length,
    });
  } catch (err: any) {
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
