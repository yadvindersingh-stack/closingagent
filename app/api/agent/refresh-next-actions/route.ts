import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabase-admin';

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

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function uniqPush(arr: string[], s: string) {
  const t = (s || '').trim();
  if (!t) return;
  if (!arr.includes(t)) arr.push(t);
}

/**
 * Deterministic fallback: always returns something useful,
 * even when OpenAI or network flakes.
 */
function computeActionsRules(context: any): string[] {
  const actions: string[] = [];
  const tx = context?.transaction || {};

  const workflow = String(tx.workflow_status || '').toUpperCase();
  const hasEmail = !!tx.client_email;

  const intakeDone =
    tx.client_intake_data &&
    typeof tx.client_intake_data === 'object' &&
    Object.keys(tx.client_intake_data).length > 0;

  const hasTitleSearch =
    !!tx.title_search_received_at ||
    (!!tx.title_search_data &&
      typeof tx.title_search_data === 'object' &&
      Object.keys(tx.title_search_data).length > 0);

  const hasReqDraft =
    !!tx.requisition_letter ||
    !!tx.requisition_letter_draft; // support either naming if it drifts

  // Always: email gate
  if (!hasEmail) {
    uniqPush(actions, 'Obtain client email address.');
  }

  // Intake stage
  if (workflow.includes('APS_EXTRACTED') || workflow.includes('CLIENT_INTAKE')) {
    if (!intakeDone) {
      uniqPush(actions, 'Send client intake form and follow up.');
    } else {
      uniqPush(actions, 'Review client intake responses for any red flags or missing info.');
    }
  }

  // Title search / requisitions
  if (intakeDone && !hasTitleSearch) {
    uniqPush(actions, 'Await title search details from lawyer to finalize requisitions.');
  }

  if (hasTitleSearch && !hasReqDraft) {
    uniqPush(actions, 'Generate requisition letter draft from the title search notes.');
  }

  if (hasReqDraft) {
    uniqPush(actions, 'Review the requisition letter draft, finalize it, and send it to the vendor’s solicitor.');
  }

  // Status certificate reminder
  if (tx.requires_status_cert) {
    uniqPush(actions, 'Request and review status certificate.');
  }

  // If we somehow have nothing, add a generic safe step
  if (actions.length === 0) {
    uniqPush(actions, 'Review the file status and confirm the next required step (APS / intake / title search / requisitions).');
  }

  return actions;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const transactionId = body?.transactionId as string | undefined;

    if (!transactionId) {
      return NextResponse.json(
        { message: 'transactionId is required' },
        { status: 400 }
      );
    }

    // 1) Load transaction context (admin client) with retry
    const { data: tx, error: txErr } = await retry(async () => {
      return await supabaseAdmin
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();
    });

    if (txErr) {
      return NextResponse.json(
        { message: 'Failed to load transaction', error: txErr.message },
        { status: 500 }
      );
    }

    if (!tx) {
      return NextResponse.json(
        { message: 'Transaction not found' },
        { status: 404 }
      );
    }

    // 2) Load docs (optional) — also retry to avoid Bolt flakes
    const { data: docs } = await retry(async () => {
      return await supabaseAdmin
        .from('documents')
        .select('id,type,status,extracted_json,file_name,uploaded_at')
        .eq('transaction_id', transactionId)
        .order('uploaded_at', { ascending: false });
    });

    const context = {
      transaction: {
        id: tx.id,
        workflow_status: tx.workflow_status,
        client_name: tx.client_name,
        client_email: tx.client_email,
        property_address: tx.property_address,
        closing_date: tx.closing_date,
        requires_status_cert: tx.requires_status_cert,
        property_type: tx.property_type,
        // support both names if schema drifts
        requisition_letter: tx.requisition_letter ?? null,
        requisition_letter_draft: tx.requisition_letter_draft ?? null,
        title_search_received_at: tx.title_search_received_at ?? null,
        title_search_data: tx.title_search_data ?? null,
        client_intake_data: tx.client_intake_data ?? null,
        client_intake_completed_at: tx.client_intake_completed_at ?? null,
      },
      documents: docs || [],
    };

    // 3) Compute actions
    // Start with deterministic baseline (always works)
    let actions = computeActionsRules(context);
    let reasoning: string | null = null;
    let used_llm = false;

    // Then attempt LLM to refine (best effort, never blocks saving)
    try {
      const prompt = `
You are an Ontario real estate law clerk assistant.
Given the transaction context, produce the next best actions to move the file forward.
Return ONLY valid JSON in this exact format:

{ "actions": ["..."], "reasoning": "short explanation" }

Rules:
- actions must be short, concrete, and ordered.
- if client_email missing, one action must be: "Obtain client email address."
- if workflow_status indicates intake not complete, include: "Send client intake form and follow up."
- if requires_status_cert true, include: "Request and review status certificate."
- if requisition letter draft exists, include: "Review and send requisition letter."
- if title search not provided, include: "Await title search details from lawyer to finalize requisitions."
Context:
${JSON.stringify(context)}
`.trim();

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'Return strictly valid JSON only.' },
          { role: 'user', content: prompt },
        ],
      });

      const content = completion.choices[0]?.message?.content || '';
      const parsed = safeJsonParse(content);

      const llmActions: string[] = Array.isArray(parsed?.actions)
        ? parsed.actions.filter((a: any) => typeof a === 'string' && a.trim())
        : [];

      if (llmActions.length > 0) {
        actions = llmActions; // replace baseline with refined actions
        used_llm = true;
      }

      reasoning = typeof parsed?.reasoning === 'string' ? parsed.reasoning : null;
    } catch (e) {
      // keep baseline actions
      used_llm = false;
    }

    const payload = {
      actions,
      updated_at: new Date().toISOString(),
      reasoning,
      used_llm,
    };

    // 4) Save to DB with retry
    const saveResult = await retry(async () => {
      return await supabaseAdmin
        .from('transactions')
        .update({
          next_actions: payload,
          next_actions_updated_at: payload.updated_at,
        })
        .eq('id', transactionId)
        .select('id,next_actions,next_actions_updated_at')
        .maybeSingle();
    });

    const { data: updated, error: updErr } = saveResult;

    // If saving returned an error, do verify-and-return-200 if state is already saved
    if (updErr) {
      // Verify (best effort)
      const { data: verify } = await supabaseAdmin
        .from('transactions')
        .select('id,next_actions,next_actions_updated_at')
        .eq('id', transactionId)
        .maybeSingle();

      if (verify?.next_actions) {
        return NextResponse.json({
          message: 'Next actions already saved (verified after transient error)',
          saved: verify,
          payload,
        });
      }

      return NextResponse.json(
        {
          message: 'Computed next actions but failed to save them',
          error: updErr.message,
          payload,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Next actions saved',
      saved: updated,
      payload,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        message: 'Unexpected error in refresh-next-actions',
        error: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
