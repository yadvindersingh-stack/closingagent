import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const transactionId = body?.transactionId as string | undefined;

    if (!transactionId) {
      return NextResponse.json({ ok: false, message: "transactionId is required" }, { status: 400 });
    }

    const { data: tx, error: txErr } = await supabaseAdmin
      .from("transactions")
      .select("id,file_number,user_id,vendor_solicitor_email,requisition_letter_draft")
      .eq("id", transactionId)
      .maybeSingle();

    if (txErr) {
      return NextResponse.json({ ok: false, message: "Failed to load transaction", error: txErr.message }, { status: 500 });
    }
    if (!tx) {
      return NextResponse.json({ ok: false, message: "Transaction not found" }, { status: 404 });
    }

    if (!tx.vendor_solicitor_email || !String(tx.vendor_solicitor_email).trim()) {
      return NextResponse.json(
        { ok: false, message: "vendor_solicitor_email is required before sending" },
        { status: 400 }
      );
    }

    const html = tx.requisition_letter_draft ? String(tx.requisition_letter_draft) : "";
    if (!html.trim()) {
      return NextResponse.json({ ok: false, message: "No requisition_letter_draft found" }, { status: 400 });
    }

    // From: use your domain sender
    const from = process.env.RESEND_FROM_EMAIL || "lawclerk@ailawclerk.ca";

    const subject = `Requisitions – File ${tx.file_number}`;

    await resend.emails.send({
      from,
      to: [tx.vendor_solicitor_email],
      subject,
      html,
    });

    await supabaseAdmin
      .from("transactions")
      .update({ requisition_letter_sent_at: new Date().toISOString() })
      .eq("id", tx.id);

    return NextResponse.json({ ok: true, message: "Requisition email sent", transactionId: tx.id });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: "Failed to send requisition email", error: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
