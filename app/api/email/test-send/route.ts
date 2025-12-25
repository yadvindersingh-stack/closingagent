import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const to = body?.to as string | undefined;

    const hasKey = !!process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL; // e.g. lawclerk@ailawclerk.ca

    if (!hasKey) {
      return NextResponse.json({ ok: false, message: 'Missing RESEND_API_KEY' }, { status: 500 });
    }
    if (!from) {
      return NextResponse.json({ ok: false, message: 'Missing RESEND_FROM_EMAIL' }, { status: 500 });
    }
    if (!to) {
      return NextResponse.json({ ok: false, message: 'Missing "to" in body' }, { status: 400 });
    }

    const resend = new Resend(process.env.RESEND_API_KEY!);

    const result = await resend.emails.send({
      from,
      to,
      subject: 'Test email from myclosingagent',
      html: `<p>If you got this, outbound email is working.</p>`,
    });

    return NextResponse.json({
      ok: true,
      message: 'Sent',
      from,
      to,
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Failed to send',
        error: err?.message ?? String(err),
        // Resend often returns structured errors:
        raw: err,
      },
      { status: 500 }
    );
  }
}
