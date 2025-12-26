import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY!);

function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const transactionId = body?.transactionId as string | undefined;
    const token = body?.token as string | undefined;
    const editedHtml = body?.editedHtml as string | undefined;

    if (!transactionId || !token || !editedHtml) {
      return NextResponse.json(
        { ok: false, message: 'transactionId, token, editedHtml are required' },
        { status: 400 }
      );
    }

    const tokenHash = sha256(token);

    const { data: link, error: linkErr } = await supabaseAdmin
      .from('approval_links')
      .select('*')
      .eq('transaction_id', transactionId)
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (linkErr) {
      return NextResponse.json({ ok: false, message: 'Failed to load approval link', error: linkErr.message }, { status: 500 });
    }

    if (!link || link.used_at) {
      return NextResponse.json({ ok: false, message: 'Approval link is invalid or already used' }, { status: 400 });
    }

    if (new Date(link.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, message: 'Approval link expired' }, { status: 400 });
    }

    // Load tx + vendor email
    const { data: tx, error: txErr } = await supabaseAdmin
      .from('transactions')
      .select('id, vendor_solicitor_email, lawyer_email, requisition_letter_draft_html, file_number')
      .eq('id', transactionId)
      .maybeSingle();

    if (txErr || !tx) {
      return NextResponse.json({ ok: false, message: 'Transaction not found' }, { status: 404 });
    }

    if (!tx.vendor_solicitor_email) {
      return NextResponse.json(
        { ok: false, message: 'Vendor solicitor email missing on transaction' },
        { status: 400 }
      );
    }

    // Persist edited HTML + mark approved
    const now = new Date().toISOString();

    const { error: updErr } = await supabaseAdmin
      .from('transactions')
      .update({
        requisition_letter_draft_html: editedHtml,
        requisition_approved_at: now,
        workflow_status: 'REQUISITION_APPROVED',
      })
      .eq('id', transactionId);

    if (updErr) {
      return NextResponse.json({ ok: false, message: 'Failed to save approval', error: updErr.message }, { status: 500 });
    }

    await supabaseAdmin
      .from('approval_links')
      .update({ used_at: now })
      .eq('id', link.id);

    // Send to vendor solicitor
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!, // e.g. lawclerk@ailawclerk.ca
      to: tx.vendor_solicitor_email,
      subject: `Requisitions - ${tx.file_number || tx.id}`,
      html: editedHtml,
    });


try {
  await fetch(`/api/email/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactionId: tx.id,
      kind: 'Requisition Letter',
      to: tx.vendor_solicitor_email,
      subject: `Requisitions - ${tx.file_number || tx.id}`,
      html: editedHtml,
    }),
  });
} catch (err) {
  console.error('Failed to send lawyer approval email', err);
}


    // Update status after send
    await supabaseAdmin
      .from('transactions')
      .update({ workflow_status: 'REQUISITION_SENT_TO_VENDOR' })
      .eq('id', transactionId);

    return NextResponse.json({ ok: true, message: 'Approved and sent to vendor solicitor' });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: 'Unexpected error approving requisition', error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
