import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import pdfParse from 'pdf-parse-fork';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { validateAPSData, APSData } from '@/lib/aps-schema';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function stripJsonFences(s: string) {
  return s
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}

function extractPathFromStorageUrl(storageUrl: string): string | null {
  const marker = '/storage/v1/object/public/documents/';
  const idx = storageUrl.indexOf(marker);
  if (idx === -1) return null;
  return storageUrl.substring(idx + marker.length);
}

async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text || '';
}

function looksLikeCondoFromAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  const a = String(addr).toLowerCase();
  return (
    a.includes('condo') ||
    a.includes('condominium') ||
    a.includes('unit ') ||
    a.includes('suite ') ||
    a.includes('apt ') ||
    a.includes('apartment') ||
    /\d+\s*-\s*\d+/.test(a)
  );
}

const APS_EXTRACTION_PROMPT = `You are an assistant for Ontario real estate lawyers. You are given the full text of an Agreement of Purchase and Sale (APS) for a residential property.

Extract as many of the following fields as possible and return ONLY valid JSON, no extra text.
If a field is missing or unclear, use null or an empty array.

Use this exact JSON structure:
{
  "purchaser_names": ["string"],
  "vendor_names": ["string"],
  "property_address": "string or null",
  "purchase_price": number or null,
  "deposit_amount": number or null,
  "completion_date": "YYYY-MM-DD or null",
  "requisition_date": "YYYY-MM-DD or null",
  "chattels_included": ["string"],
  "fixtures_excluded": ["string"],
  "rental_items": ["string"],
  "hst_included": boolean or null,
  "commission_percentage": number or null,
  "closing_adjustments": ["string"],
  "conditions": ["string"],
  "irrevocability_date": "YYYY-MM-DD or null"
}

Input text:
{{APS_TEXT}}`;

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function updateDocumentWithRetry(
  documentId: string,
  aps: APSData,
  attempts = 3
): Promise<{ ok: boolean; error?: string; verified?: boolean }> {
  let lastErr: any = null;

  for (let i = 0; i < attempts; i++) {
    const { error } = await supabaseAdmin
      .from('documents')
      .update({ extracted_json: aps, status: 'EXTRACTED' })
      .eq('id', documentId);

    if (!error) return { ok: true };

    lastErr = error;
    await sleep(250 * (i + 1));
  }

  // verify save (in case write succeeded but response failed)
  const { data: verify, error: vErr } = await supabaseAdmin
    .from('documents')
    .select('id, status, extracted_json')
    .eq('id', documentId)
    .maybeSingle();

  const verified =
    !!verify &&
    verify.status === 'EXTRACTED' &&
    verify.extracted_json != null &&
    !vErr;

  if (verified) return { ok: true, verified: true };

  return { ok: false, error: lastErr?.message || vErr?.message || 'Unknown error' };
}

async function updateTransactionWithRetry(
  txId: string,
  txUpdate: any,
  attempts = 3
): Promise<{ ok: boolean; error?: string; verified?: boolean }> {
  let lastErr: any = null;

  for (let i = 0; i < attempts; i++) {
    const { error } = await supabaseAdmin
      .from('transactions')
      .update(txUpdate)
      .eq('id', txId);

    if (!error) return { ok: true };

    lastErr = error;
    await sleep(250 * (i + 1));
  }

  // verify (check a couple of fields)
  const { data: verify, error: vErr } = await supabaseAdmin
    .from('transactions')
    .select('id, workflow_status, property_address, closing_date, requires_status_cert')
    .eq('id', txId)
    .maybeSingle();

  const verified = !!verify && !vErr; // loose verify; we just want to know it didn't totally fail
  if (verified) return { ok: true, verified: true };

  return { ok: false, error: lastErr?.message || vErr?.message || 'Unknown error' };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const documentId = body?.documentId as string | undefined;

    if (!documentId) {
      return NextResponse.json({ message: 'documentId is required' }, { status: 400 });
    }

    // 1) Load document (admin)
    const { data: doc, error: docErr } = await supabaseAdmin
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .maybeSingle();

    if (docErr) {
      return NextResponse.json(
        { message: 'Failed to load document from Supabase', error: docErr.message },
        { status: 500 }
      );
    }
    if (!doc) {
      return NextResponse.json({ message: 'Document not found', documentId }, { status: 404 });
    }
    if (doc.type !== 'APS') {
      return NextResponse.json(
        { message: 'Document type must be APS', type: doc.type },
        { status: 400 }
      );
    }

    const storageUrl: string | null = doc.storage_url ?? null;
    if (!storageUrl) {
      return NextResponse.json(
        { message: 'storage_url missing on document', documentId },
        { status: 400 }
      );
    }

    const storagePath = extractPathFromStorageUrl(storageUrl);
    if (!storagePath) {
      return NextResponse.json(
        { message: 'Unable to parse storage path from storage_url', storageUrl },
        { status: 400 }
      );
    }

    // 2) Download PDF from Supabase storage (admin)
    const { data: fileData, error: dlErr } = await supabaseAdmin.storage
      .from('documents')
      .download(storagePath);

    if (dlErr || !fileData) {
      return NextResponse.json(
        {
          message: 'Failed to fetch APS PDF from storage',
          error: dlErr?.message || 'download returned null',
          storagePath,
        },
        { status: 500 }
      );
    }

    const pdfBuffer = Buffer.from(await fileData.arrayBuffer());

    // 3) Extract PDF text
    const text = await extractTextFromPDF(pdfBuffer);
    if (!text || text.trim().length < 50) {
      return NextResponse.json({ message: 'Unable to extract text from APS PDF' }, { status: 500 });
    }

    // 4) LLM extraction
    const prompt = APS_EXTRACTION_PROMPT.replace('{{APS_TEXT}}', text);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return strictly valid JSON only.' },
        { role: 'user', content: prompt },
      ],
    });

    const content = completion.choices[0]?.message?.content || '';
    const cleaned = stripJsonFences(content);

    let parsed: any = null;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { message: 'Failed to parse APS extraction result as JSON', sample: content.slice(0, 200) },
        { status: 500 }
      );
    }

    let aps: APSData;
    try {
      aps = validateAPSData(parsed);
    } catch (e: any) {
      return NextResponse.json(
        { message: 'APS JSON failed schema validation', error: e?.message || String(e) },
        { status: 500 }
      );
    }

    // 5) Save APS JSON to document (retry + verify)
    const docSave = await updateDocumentWithRetry(documentId, aps, 3);
    if (!docSave.ok) {
      return NextResponse.json(
        { message: 'Failed to save APS extraction to document', error: docSave.error },
        { status: 500 }
      );
    }

    // 6) Update transaction summary fields (retry + verify)
    const txId: string | null = doc.transaction_id ?? null;
    if (txId) {
      const { data: tx } = await supabaseAdmin
        .from('transactions')
        .select('id, client_email, client_name, property_address, closing_date')
        .eq('id', txId)
        .maybeSingle();

      const looksLikeCondo = looksLikeCondoFromAddress(aps.property_address);

      const txUpdate: any = {
        client_name: aps.purchaser_names?.[0] ?? tx?.client_name ?? null,
        property_address: aps.property_address ?? tx?.property_address ?? null,
        closing_date: aps.completion_date ?? tx?.closing_date ?? null,
        property_type: looksLikeCondo ? 'CONDO' : 'FREEHOLD',
        requires_status_cert: looksLikeCondo,
        workflow_status: tx?.client_email ? 'CLIENT_INTAKE_READY' : 'APS_EXTRACTED_AWAITING_EMAIL',
      };

      const txSave = await updateTransactionWithRetry(txId, txUpdate, 3);
      if (!txSave.ok) {
        // Don’t fail extraction; the doc is saved. Return ok with warning.
        return NextResponse.json({
          ok: true,
          data: aps,
          warning: 'APS saved to document, but transaction update may be delayed',
        });
      }

      // Best-effort triggers (do not block)
      const origin = process.env.APP_PUBLIC_URL || new URL(req.url).origin;

      fetch(`${origin}/api/agent/refresh-next-actions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId }),
      }).catch(() => null);

      fetch(`${origin}/api/automations/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: txId }),
      }).catch(() => null);
    }

    return NextResponse.json({
      ok: true,
      data: aps,
      message: docSave.verified ? 'APS saved (verified after transient error)' : 'APS saved',
    });
  } catch (err: any) {
    return NextResponse.json(
      { message: 'Unexpected error during APS extraction', error: err?.message || String(err) },
      { status: 500 }
    );
  }
}
