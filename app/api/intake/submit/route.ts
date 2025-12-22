import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

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

function looksLikeIntakeSaved(tx: any) {
  const hasData =
    tx?.client_intake_data &&
    typeof tx.client_intake_data === 'object' &&
    Object.keys(tx.client_intake_data).length > 0;

  return !!tx?.client_intake_completed_at && hasData;
}

export async function POST(req: NextRequest) {
  const startedAt = new Date().toISOString();

  try {
    const body = await req.json().catch(() => null);
    const transactionId = body?.transactionId as string | undefined;
    const form = body?.form as any;

    if (!transactionId || !form || typeof form !== 'object') {
      return NextResponse.json(
        { ok: false, message: 'transactionId and form are required' },
        { status: 400 }
      );
    }

    const completedAt = new Date().toISOString();

    // A) Try to save intake (retry to survive transient fetch failures)
    let updated: any = null;

    try {
      const res = await retry(async () => {
        return await supabaseAdmin
          .from('transactions')
          .update({
            client_intake_data: form,
            client_intake_completed_at: completedAt,
            workflow_status: 'CLIENT_INTAKE_COMPLETED',
          })
          .eq('id', transactionId)
          .select(
            'id, workflow_status, client_intake_completed_at, client_intake_data'
          )
          .maybeSingle();
      });

      if (res.error) {
        // This is a real PostgREST error (not a thrown fetch error)
        throw new Error(res.error.message);
      }

      updated = res.data;
    } catch (e: any) {
      // B) If saving errored (often "TypeError: fetch failed"), VERIFY whether it actually saved
      try {
        const verifyRes = await retry(async () => {
          return await supabaseAdmin
            .from('transactions')
            .select(
              'id, workflow_status, client_intake_completed_at, client_intake_data'
            )
            .eq('id', transactionId)
            .maybeSingle();
        });

        if (!verifyRes.error && looksLikeIntakeSaved(verifyRes.data)) {
          // IMPORTANT: return 200, because it DID save
          return NextResponse.json({
            ok: true,
            message: 'Intake saved (verified after transient error)',
            saved: verifyRes.data,
            debug: { startedAt },
          });
        }
      } catch {
        // ignore verify crash
      }

      // If we got here, it truly didn’t save (or we couldn’t verify)
      return NextResponse.json(
        {
          ok: false,
          message: 'Failed to save intake',
          error: e?.message || String(e),
          debug: { startedAt },
        },
        { status: 500 }
      );
    }

    // C) Best-effort: refresh next actions (never blocks success)
    (async () => {
      try {
        await fetch(`${process.env.APP_PUBLIC_URL}/api/agent/refresh-next-actions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transactionId }),
        });
      } catch {
        // swallow
      }
    })();

    return NextResponse.json({
      ok: true,
      message: 'Intake saved',
      saved: updated,
      debug: { startedAt },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Unexpected error in intake submit',
        error: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}

