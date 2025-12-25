import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY || '');

export async function POST(req: NextRequest) {
  const startedAt = new Date().toISOString();

  try {
    const body = await req.json().catch(() => null);

    const transactionId = body?.transactionId as string | undefined;
    const kind = body?.kind as string | undefined; // CLIENT_INTAKE | LAWYER_APPROVAL | VENDOR_SOLICITOR
    const to = body?.to as string | undefined;
    const subject = body?.subject as string | undefined;
    const html = body?.html as string | undefined;

    if (!kind || !to || !subject || !html) {
      return NextResponse.json(
        { ok: false, message: 'kind, to, subject, html are required', received: body },
        { status: 400 }
      );
    }

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ ok: false, message: 'Missing RESEND_API_KEY' }, { status: 500 });
    }
    if (!process.env.RESEND_FROM_EMAIL) {
      return NextResponse.json({ ok: false, message: 'Missing RESEND_FROM_EMAIL' }, { status: 500 });
    }

    // 1) Create outbox row first (QUEUED)
    const { data: outboxRow, error: outboxErr } = await supabaseAdmin
      .from('email_outbox')
      .insert({
        transaction_id: transactionId ?? null,
        kind,
        to_email: to,
        subject,
        status: 'QUEUED',
      })
      .select('id')
      .maybeSingle();

    if (outboxErr || !outboxRow?.id) {
      return NextResponse.json(
        { ok: false, message: 'Failed to create outbox row', error: outboxErr?.message },
        { status: 500 }
      );
    }

    // 2) Send via Resend
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL!,
      to,
      subject,
      html,
    });

    // 3) Mark SENT
    await supabaseAdmin
      .from('email_outbox')
      .update({ status: 'SENT', sent_at: new Date().toISOString(), error: null })
      .eq('id', outboxRow.id);

    return NextResponse.json({
      ok: true,
      message: 'Sent',
      outboxId: outboxRow.id,
      startedAt,
      result,
    });
  } catch (err: any) {
    // If we fail before outbox row exists, we can't log it here.
    return NextResponse.json(
      { ok: false, message: 'Failed to send', error: err?.message ?? String(err), startedAt },
      { status: 500 }
    );
  }
}
