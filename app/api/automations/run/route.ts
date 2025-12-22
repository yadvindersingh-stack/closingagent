import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildRequisitionHtml } from '@/lib/requisition-html';

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
      (!tx.requisition_letter_draft ||
        String(tx.requisition_letter_draft).trim().length === 0);

    if (!shouldGenerate) {
      return NextResponse.json({
        ok: true,
        message: 'No automation needed',
        workflow_status: tx.workflow_status,
        has_title: !!tx.title_search_data,
        has_draft: !!tx.requisition_letter_draft,
      });
    }

    const title = tx.title_search_data || {};
    const additionsRaw = (title as any)?.lawyer_additions;
    const additions: string[] = Array.isArray(additionsRaw)
      ? additionsRaw.filter((s: any) => typeof s === 'string' && s.trim())
      : [];

    // Load profile if you use it in your HTML template
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('full_name, firm_name, email, phone, address_line')
      .eq('id', tx.user_id)
      .maybeSingle();

    const html = buildRequisitionHtml({
      transaction: tx,
      profile: profile || null,
      title,
      appended: additions,
    });

    const { error: updErr } = await supabaseAdmin
      .from('transactions')
      .update({
        requisition_letter_draft: html,
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

    return NextResponse.json({
      ok: true,
      message: 'Requisition draft generated',
      transactionId: tx.id,
      additions_count: additions.length,
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
