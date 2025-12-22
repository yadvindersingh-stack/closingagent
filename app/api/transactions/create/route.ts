import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

function generateFileNumber() {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${yy}${mm}${dd}-${rand}`;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function insertWithRetry(payload: any, attempts = 3) {
  let lastErr: any = null;

  for (let i = 0; i < attempts; i++) {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .insert(payload)
      .select('*')
      .maybeSingle();

    if (!error && data) return { data, error: null };

    lastErr = error;

    // In Bolt, "fetch failed" style issues often appear as empty/odd errors.
    // Backoff and retry.
    await sleep(250 * (i + 1));
  }

  return { data: null, error: lastErr };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const userId = body?.userId;

    if (!userId) {
      return NextResponse.json(
        { ok: false, message: 'userId is required' },
        { status: 400 }
      );
    }

    const fileNumber = generateFileNumber();

    const payload = {
      user_id: userId,
      file_number: fileNumber,

      // placeholders until APS extraction overwrites them
      client_name: 'TBD',
      property_address: 'TBD',
      closing_date: '2099-12-31',

      workflow_status: 'TRANSACTION_CREATED',
    };

    // 1) Try insert with retry
    const { data: tx, error } = await insertWithRetry(payload, 3);

    if (tx && !error) {
      return NextResponse.json({ ok: true, transaction: tx });
    }

    // 2) Verify by lookup (in case insert succeeded but response failed)
    // If file_number is unique, this is a safe verification.
    const { data: verify, error: verifyErr } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('file_number', fileNumber)
      .maybeSingle();

    if (verify && !verifyErr) {
      return NextResponse.json({
        ok: true,
        transaction: verify,
        message: 'Created (verified after transient error)',
      });
    }

    return NextResponse.json(
      {
        ok: false,
        message: 'Failed to create transaction',
        error: error?.message || verifyErr?.message || 'Unknown error',
      },
      { status: 500 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        message: 'Unexpected error creating transaction',
        error: err?.message || String(err),
      },
      { status: 500 }
    );
  }
}
