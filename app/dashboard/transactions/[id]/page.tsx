'use client';

import { useEffect, useState, ChangeEvent, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Home,
  Users,
  Calendar,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import { CheckCircle2, AlertTriangle, Circle } from 'lucide-react';
import crypto from 'crypto';


interface Transaction {
  id: string;
  property_address?: string;
  client_name?: string;
  file_number?: string;
  closing_date?: string;
  status?: string;
  created_at: string;

  client_email?: string | null;
  workflow_status?: string | null;

  client_intake_data?: any | null;
  client_intake_completed_at?: string | null;

  property_type?: string | null;
  requires_status_cert?: boolean | null;

  requisition_letter_draft?: string | null;
  requisition_letter_draft_html?: string | null;
  requisition_letter_generated_at?: string | null;

  vendor_solicitor_email?: string | null;
  lawyer_email?: string | null;

  requisition_approved_at?: string | null;
}

interface Document {
  id: string;
  transaction_id: string;
  file_name: string;
  type: string; // 'APS', 'STATUS_CERT', etc.
  storage_url: string;
  uploaded_at: string;
  status?: string | null;
  extracted_json?: any | null;
}

type ChecklistRow = {
  key: string;
  label: string;
  status: 'DONE' | 'PENDING' | 'BLOCKED';
  detail?: string;
};

function randomToken() {
  return crypto.randomBytes(24).toString('hex'); // 48 chars
}
function sha256(s: string) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
type Stage = 'NEW' | 'IN_PROGRESS' | 'CLOSED';

function deriveStage(tx: any, rows: ChecklistRow[]): Stage {
  // Closed is explicit only (button-controlled)
  if (tx?.status === 'CLOSED' || tx?.workflow_status === 'CLOSED') return 'CLOSED';

  // New until APS is uploaded
  const apsUploaded = rows.find(r => r.key === 'aps_uploaded')?.status === 'DONE';
  return apsUploaded ? 'IN_PROGRESS' : 'NEW';
}

function deriveWorkflowStatusFromChecklist(rows: ChecklistRow[]): string {
  // Pick the first item that isn’t DONE; that’s the “current” step.
  const current = rows.find(r => r.status !== 'DONE');
  if (!current) return 'READY_FOR_CLOSING'; // (future) everything done

  // Map keys to nicer labels (what you show in UI)
  const map: Record<string, string> = {
    created: 'TRANSACTION_CREATED',
    aps_uploaded: 'APS_UPLOAD_REQUIRED',
    aps_extracted: 'APS_EXTRACTION_REQUIRED',
    email: 'CLIENT_EMAIL_REQUIRED',
    intake: 'CLIENT_INTAKE_PENDING',
    title_search: 'TITLE_SEARCH_PENDING',
    req_draft: 'REQUISITION_DRAFT_PENDING',
    status_cert: 'STATUS_CERT_REQUIRED',
  };

  return map[current.key] || current.label.toUpperCase().replace(/\s+/g, '_');
}


function deriveChecklist(tx: any, docs: any[]): ChecklistRow[] {
  const apsDocs = (docs || []).filter((d) => d.type === 'APS');
  const apsUploaded = apsDocs.length > 0;
  const apsExtracted = apsDocs.some(
    (d) => d.status === 'EXTRACTED' || !!d.extracted_json
  );

  const hasEmail = !!tx?.client_email;
  const intakeDone =
    !!tx?.client_intake_completed_at || !!tx?.client_intake_data;

const titleSearchDone = !!tx?.title_search_received_at || !!tx?.title_search_data;

const reqDraftDone =
  !!tx?.requisition_letter_draft ||
  !!tx?.requisition_letter_draft_html ||
  !!tx?.requisition_letter_generated_at;

const requiresStatusCert = !!tx?.requires_status_cert;
const reqSentToVendor =
  tx?.workflow_status === 'REQUISITION_SENT_TO_VENDOR' ||
  !!(tx as any)?.requisition_sent_to_vendor_at;


// --- workflow rank helper (so DONE status works even if workflow isn't perfectly linear)
const workflowRank: Record<string, number> = {
  TRANSACTION_CREATED: 10,
  APS_UPLOADED: 20,
  APS_EXTRACTED: 30,
  APS_EXTRACTED_AWAITING_EMAIL: 31,
  CLIENT_INTAKE_READY: 40,
  CLIENT_INTAKE_COMPLETED: 50,

  TITLE_SEARCH_RECEIVED: 60,

  REQUISITION_DRAFT_READY: 70,
  REQUISITION_SENT_TO_LAWYER: 80,
  REQUISITION_APPROVED: 90,
  REQUISITION_SENT_TO_VENDOR: 100,

  CLOSED: 999,
};

const currentRank = workflowRank[String(tx?.workflow_status || '')] ?? 0;
const atLeast = (status: string) => currentRank >= (workflowRank[status] ?? 0);

const rows: ChecklistRow[] = [
  { key: 'created', label: 'Transaction created', status: 'DONE' },
  {
    key: 'aps_uploaded',
    label: 'APS uploaded',
    status: apsUploaded ? 'DONE' : 'PENDING',
  },
  {
    key: 'aps_extracted',
    label: 'APS extracted',
    status: apsExtracted ? 'DONE' : apsUploaded ? 'PENDING' : 'BLOCKED',
    detail: !apsUploaded ? 'Upload APS first' : undefined,
  },
  {
    key: 'email',
    label: 'Client email on file',
    status: hasEmail ? 'DONE' : 'PENDING',
  },
  {
    key: 'intake',
    label: 'Client intake completed',
    status: intakeDone ? 'DONE' : hasEmail ? 'PENDING' : 'BLOCKED',
    detail: !hasEmail && !intakeDone ? 'Add client email to send intake' : undefined,
  },
  {
    key: 'title_search',
    label: 'Title search received',
    status: titleSearchDone ? 'DONE' : 'PENDING',
  },

  // ✅ Draft
  {
    key: 'req_draft',
    label: 'Requisition letter drafted',
    status:
      reqDraftDone || atLeast('REQUISITION_DRAFT_READY')
        ? 'DONE'
        : titleSearchDone
        ? 'PENDING'
        : 'BLOCKED',
    detail: !titleSearchDone && !reqDraftDone ? 'Await title search details' : undefined,
  },

  // ✅ NEW: Sent to lawyer
  {
    key: 'req_sent_lawyer',
    label: 'Requisition sent to lawyer for approval',
    status:
      atLeast('REQUISITION_SENT_TO_LAWYER') || atLeast('REQUISITION_APPROVED') || atLeast('REQUISITION_SENT_TO_VENDOR')
        ? 'DONE'
        : reqDraftDone
        ? 'PENDING'
        : 'BLOCKED',
    detail: !reqDraftDone ? 'Generate requisition draft first' : undefined,
  },

  // ✅ NEW: Approved
  {
    key: 'req_approved',
    label: 'Requisition approved by lawyer',
    status:
      atLeast('REQUISITION_APPROVED') || atLeast('REQUISITION_SENT_TO_VENDOR')
        ? 'DONE'
        : atLeast('REQUISITION_SENT_TO_LAWYER')
        ? 'PENDING'
        : 'BLOCKED',
    detail: !atLeast('REQUISITION_SENT_TO_LAWYER') ? 'Send to lawyer first' : undefined,
  },

  // ✅ NEW: Sent to vendor
  {
    key: 'req_sent_vendor',
    label: 'Requisition sent to vendor solicitor',
    status:
      atLeast('REQUISITION_SENT_TO_VENDOR')
        ? 'DONE'
        : atLeast('REQUISITION_APPROVED')
        ? 'PENDING'
        : 'BLOCKED',
    detail: !atLeast('REQUISITION_APPROVED') ? 'Await lawyer approval first' : undefined,
  },
];

if (requiresStatusCert) {
  rows.push({
    key: 'status_cert',
    label: 'Status certificate required',
    status: 'PENDING',
    detail: 'Upload & review status certificate',
  });
}

if (reqSentToVendor) {
  rows.push(
    { key: 'incoming_docs_header', label: 'Incoming docs (pre-closing)', status: 'PENDING' as any, detail: 'Auto-tracked from vendor solicitor emails' as any }
  );

  const incoming = (tx as any)?.incoming_docs && typeof (tx as any).incoming_docs === 'object'
    ? (tx as any).incoming_docs
    : {};

  const has = (k: string) => !!incoming?.[k]?.received;

  const docRows = [
    { key: 'reply_to_requisitions', label: 'Reply to requisitions' },
    { key: 'statement_of_adjustments', label: 'Statement of Adjustments' },
    { key: 'closing_documents', label: 'Closing documents' },
    { key: 'hst', label: 'HST' },
    { key: 'stat_dec_residency', label: 'Statutory Declaration – residency' },
    { key: 'stat_dec_spousal', label: 'Statutory Declaration – spousal status' },
    { key: 'undertakings', label: 'Undertakings' },
    { key: 'uff_warranty', label: 'UFF Warranty' },
    { key: 'bill_of_sale', label: 'Bill of Sale' },
    { key: 'doc_registration_agreement', label: 'Document registration agreement' },
    { key: 'signature_required', label: 'Signature required' },
    { key: 'lawyers_undertaking_vendor_mortgage', label: "Lawyer's Undertaking – vendor mortgage" },
    { key: 'payout_statement_mortgage', label: 'Payout statement of mortgage' },
  ];

  docRows.forEach((d) => {
    rows.push({
      key: `incoming_${d.key}`,
      label: d.label,
      status: has(d.key) ? 'DONE' : 'PENDING',
      detail: has(d.key) ? 'Received via inbound email' : undefined,
    });
  });
}

return rows;

}

export default function TransactionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const transactionId = params.id as string;

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const [isExtracting, setIsExtracting] = useState(false);

  // Upload
  const [uploading, setUploading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState<'APS' | 'STATUS_CERT' | 'OTHER'>(
    'APS'
  );

  // Client email edit
  const [editableEmail, setEditableEmail] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Vendor solicitor email edit
  const [vendorEmail, setVendorEmail] = useState('');
  const [savingVendorEmail, setSavingVendorEmail] = useState(false);

  // Expand/collapse per document
  const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({});
  const toggleDoc = (id: string) =>
    setExpandedDocs((prev) => ({ ...prev, [id]: !prev[id] }));

  // Requisition
  const [isGeneratingReq, setIsGeneratingReq] = useState(false);

  // Lawyer approval controls (in requisition card)
  const [lawyerEmail, setLawyerEmail] = useState('');
  const [savingLawyerEmail, setSavingLawyerEmail] = useState(false);
  const [sendingApproval, setSendingApproval] = useState(false);

  useEffect(() => {
    loadTransactionData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId]);

  useEffect(() => {
    if (!transaction) return;
    setLawyerEmail(transaction.lawyer_email || '');
    setVendorEmail(transaction.vendor_solicitor_email || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transaction?.id]);

  async function loadTransactionData() {
    try {
      const { data: transactionData, error: transactionError } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .maybeSingle();

      if (transactionError) throw transactionError;

      setTransaction(transactionData as Transaction);
      setEditableEmail((transactionData as any)?.client_email ?? '');

      const { data: documentsData, error: documentsError } = await supabase
        .from('documents')
        .select('*')
        .eq('transaction_id', transactionId)
        .order('uploaded_at', { ascending: false });

      if (documentsError) throw documentsError;

      setDocuments((documentsData || []) as Document[]);
    } catch (error) {
      console.error('Error loading transaction:', error);
      toast.error('Failed to load transaction data');
    } finally {
      setLoading(false);
    }
  }
const [closingFile, setClosingFile] = useState(false);

const handleCloseFile = async () => {
  if (!transaction?.id) return;
  try {
    setClosingFile(true);
    const { error } = await supabase
      .from('transactions')
      .update({
        status: 'CLOSED',
        workflow_status: 'CLOSED',
      })
      .eq('id', transaction.id);

    if (error) throw error;

    toast.success('File closed');
    await loadTransactionData();
    router.refresh();
  } catch (e: any) {
    console.error('Close file error:', e);
    toast.error(e?.message || 'Failed to close file');
  } finally {
    setClosingFile(false);
  }
};

  const handleRunApsExtraction = async (documentId: string) => {
    const tx = transaction;
    if (!tx) {
      toast.error('Transaction not loaded yet');
      return;
    }

    try {
      setIsExtracting(true);

      const res = await fetch('/api/extract-aps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      });

      const text = await res.text();
      let body: any = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }

      if (!res.ok) {
        const message =
          body?.message || body?.error || 'Unexpected error during APS extraction';
        throw new Error(message);
      }

      const aps = body?.data;
      if (!aps) {
        toast.error('APS extraction returned no data');
        return;
      }

      // Save APS JSON to the document (best-effort)
      const { error: docUpdateError } = await supabase
        .from('documents')
        .update({ extracted_json: aps, status: 'EXTRACTED' })
        .eq('id', documentId);

      if (docUpdateError) {
        console.error('APS: document update error', docUpdateError);
        toast.error('APS extracted, but failed to save document data');
      }

      // Update transaction summary fields derived from APS
      const txUpdate: any = {
        client_name: aps.purchaser_names?.[0] ?? tx.client_name ?? null,
        property_address: aps.property_address ?? tx.property_address ?? null,
        closing_date: aps.completion_date ?? tx.closing_date ?? null,
      };

      // Workflow status
      txUpdate.workflow_status = tx.client_email
        ? 'CLIENT_INTAKE_READY'
        : 'APS_EXTRACTED_AWAITING_EMAIL';

      // Condo / status cert detection
      if (aps.property_address) {
        const addr = String(aps.property_address).toLowerCase();
        const looksLikeCondo =
          addr.includes('condo') ||
          addr.includes('condominium') ||
          addr.includes('unit ') ||
          addr.includes('suite ') ||
          addr.includes('apt ') ||
          addr.includes('apartment') ||
          /\d+\s*-\s*\d+/.test(addr);

        txUpdate.property_type = looksLikeCondo ? 'CONDO' : 'FREEHOLD';
        txUpdate.requires_status_cert = looksLikeCondo;
      }

      const { error: txUpdateError } = await supabase
        .from('transactions')
        .update(txUpdate)
        .eq('id', tx.id);

      if (txUpdateError) {
        console.error('APS: transaction update error', txUpdateError);
        toast.error('APS extracted, but failed to update transaction summary');
      }

      await loadTransactionData();
      toast.success('APS extraction complete');
      router.refresh();

      // Send intake email (best-effort) ONLY if client_email exists
      if (tx.client_email) {
        const origin =
          typeof window !== 'undefined' ? window.location.origin : '';
        const intakeLink = origin ? `${origin}/intake/${tx.id}` : `/intake/${tx.id}`;

        await fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId: tx.id,
            kind: 'CLIENT_INTAKE',
            to: tx.client_email,
            subject: `Client Intake Form - ${tx.file_number}`,
            html: `<p>Please complete intake:</p><p><a href="${intakeLink}">Open intake form</a></p>`,
          }),
        }).catch(() => null);
      }

      // Optional: automation pipeline (best effort)
      fetch('/api/automations/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactionId: tx.id }),
      }).catch(() => null);
    } catch (err: any) {
      console.error('handleRunApsExtraction error:', err);
      toast.error(
        err?.message ||
          'APS extraction failed. Please check your API configuration.'
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setUploadFile(file);
  };

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();

    const txId = transaction?.id;
    if (!txId) {
      toast.error('Transaction not loaded yet');
      return;
    }
    if (!uploadFile) {
      toast.error('Please choose a file');
      return;
    }

    try {
      setUploading(true);

      const file = uploadFile;
      const ext = file.name.split('.').pop() || 'pdf';
      const path = `${transactionId}/${Date.now()}.${ext}`;

      const { error: storageError } = await supabase.storage
        .from('documents')
        .upload(path, file);
      if (storageError) throw storageError;

      const { data: publicUrlData } = supabase.storage
        .from('documents')
        .getPublicUrl(path);
      const publicUrl = publicUrlData?.publicUrl;
      if (!publicUrl) throw new Error('Failed to get public URL for uploaded file');

      const { error: insertError } = await supabase.from('documents').insert({
        transaction_id: transactionId,
        file_name: file.name,
        type: uploadType,
        storage_url: publicUrl,
        status: 'UPLOADED',
      });

      if (insertError) throw insertError;

      toast.success('Document uploaded');
      setUploadFile(null);
      await loadTransactionData();
    } catch (err: any) {
      console.error('Upload error:', err);
      toast.error(err?.message || 'Failed to upload document. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleCopyRequisition = async () => {
    if (!transaction?.requisition_letter_draft) return;
    try {
      await navigator.clipboard.writeText(transaction.requisition_letter_draft);
      toast.success('Requisition letter copied to clipboard');
    } catch {
      toast.error('Failed to copy. Please select and copy manually.');
    }
  };

  const handleGenerateRequisition = async () => {
    if (!transaction) return;

    const apsDoc = documents.find(
      (d) => d.type === 'APS' && d.status === 'EXTRACTED' && d.extracted_json
    );
    if (!apsDoc) {
      toast.error('No extracted APS found. Please run APS extraction first.');
      return;
    }

    const aps = apsDoc.extracted_json;
    const intake = transaction.client_intake_data || null;

    const txSummary = {
      client_name: transaction.client_name,
      client_email: transaction.client_email,
      file_number: transaction.file_number,
      property_address: transaction.property_address,
      closing_date: transaction.closing_date,
      property_type: transaction.property_type,
    };

    try {
      setIsGeneratingReq(true);

      const res = await fetch('/api/requisition/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: transaction.id,
          transaction: txSummary,
          aps,
          intake,
        }),
      });

      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok) {
        const message = body?.message || 'Failed to generate requisition';
        const details = body?.error;
        throw new Error(details ? `${message}: ${details}` : message);
      }

      const draft = body?.draft;
      const draftHtml = body?.draft_html;

      if (!draft && !draftHtml) throw new Error('Requisition API returned no draft');

      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          requisition_letter_draft: draft ?? transaction.requisition_letter_draft ?? null,
          requisition_letter_draft_html: draftHtml ?? transaction.requisition_letter_draft_html ?? null,
          requisition_letter_generated_at: new Date().toISOString(),
          workflow_status: 'REQUISTION_DRAFT_READY',
        })
        .eq('id', transaction.id);

      if (updateError) {
        console.error('Client-side requisition save error:', updateError);
        throw new Error('Draft generated, but failed to save in database.');
      }

      toast.success('Requisition letter draft generated');
      await loadTransactionData();
      router.refresh();
    } catch (err: any) {
      console.error('Generate requisition error:', err);
      toast.error(
        err?.message || 'Failed to generate requisition letter. Please try again.'
      );
    } finally {
      setIsGeneratingReq(false);
    }
  };

  const handleSaveEmail = async () => {
    if (!transaction) return;

    try {
      setSavingEmail(true);

      const hasEmail = !!editableEmail;
      const hasExtractedAps = documents.some(
        (d) => d.type === 'APS' && d.status === 'EXTRACTED' && d.extracted_json
      );
      const intakeDone = !!transaction.client_intake_completed_at;

      let workflowStatus: string | null = transaction.workflow_status ?? null;

      if (hasExtractedAps && !intakeDone) {
        workflowStatus = hasEmail ? 'CLIENT_INTAKE_READY' : 'CLIENT_EMAIL_REQUIRED';
      }

      const { error } = await supabase
        .from('transactions')
        .update({
          client_email: editableEmail || null,
          workflow_status: workflowStatus,
        })
        .eq('id', transaction.id);

      if (error) throw error;

      toast.success('Client email updated');
      if(hasExtractedAps){ 
        const tx = transaction;
        const origin =
          typeof window !== 'undefined' ? window.location.origin : '';
        const intakeLink = origin ? `${origin}/intake/${tx.id}` : `/intake/${tx.id}`;

        await fetch('/api/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transactionId: tx.id,
            kind: 'CLIENT_INTAKE',
            to: tx.client_email,
            subject: `Client Intake Form - ${tx.file_number}`,
            html: `<p>Please complete intake:</p><p><a href="${intakeLink}">Open intake form</a></p>`,
          }),
        }).catch(() => null);}
      await loadTransactionData();
      router.refresh();
    } catch (err: any) {
      console.error('Save email error:', err);
      toast.error(err?.message || 'Failed to update client email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handleSaveVendorEmail = async () => {
    if (!transaction?.id) return;

    try {
      setSavingVendorEmail(true);

      const { error } = await supabase
        .from('transactions')
        .update({ vendor_solicitor_email: vendorEmail || null })
        .eq('id', transaction.id);

      if (error) throw error;

      toast.success('Vendor solicitor email updated');
      await loadTransactionData();
      router.refresh();
    } catch (err: any) {
      console.error('Save vendor email error:', err);
      toast.error(err?.message || 'Failed to update vendor solicitor email');
    } finally {
      setSavingVendorEmail(false);
    }
  };

  const handleSaveLawyerEmailOnly = async () => {
    if (!transaction?.id) return;

    try {
      setSavingLawyerEmail(true);

      const { error } = await supabase
        .from('transactions')
        .update({ lawyer_email: lawyerEmail || null })
        .eq('id', transaction.id);

      if (error) throw error;

      toast.success('Lawyer email updated');
      await loadTransactionData();
      router.refresh();
    } catch (err: any) {
      console.error('Save lawyer email error:', err);
      toast.error(err?.message || 'Failed to update lawyer email');
    } finally {
      setSavingLawyerEmail(false);
    }
  };

  const handleSendForApproval = async () => {
    if (!transaction?.id) return;

    if (!lawyerEmail) {
      toast.error('Please enter lawyer email first');
      return;
    }
    if (!transaction.requisition_letter_draft && !transaction.requisition_letter_draft_html) {
      toast.error('Generate the requisition draft first');
      return;
    }

    try {
      setSendingApproval(true);

      // Save lawyer email first (so the system has it)
      const { error: saveErr } = await supabase
        .from('transactions')
        .update({ lawyer_email: lawyerEmail || null })
        .eq('id', transaction.id);
      if (saveErr) throw saveErr;

       const token = randomToken();
          const tokenHash = sha256(token);
          const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(); // 24h
      
          await supabase.from('approval_links').insert({
            transaction_id: transactionId,
            token_hash: tokenHash,
            expires_at: expiresAt,
          });
          
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      // If your approve route expects token, we’ll implement token generation server-side next.
      const approveLink = origin
        ? `${origin}/lawyer/approve/${transaction.id}?token=${token}`
        : `/lawyer/approve/${transaction.id}?token=${token}`;

      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionId: transaction.id,
          kind: 'LAWYER_APPROVAL',
          to: lawyerEmail,
          subject: `Approval Required - Requisition Letter (${transaction.file_number})`,
          html: `
            <p>Please review the requisition letter draft and approve:</p>
            <p><a href="${approveLink}" target="_blank" rel="noopener noreferrer">Open approval page</a></p>
          `,
        }),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Email failed: ${res.status} ${text}`);
      }

      toast.success('Approval email sent to lawyer');
      await loadTransactionData();
      router.refresh();
    } catch (err: any) {
      console.error('Send for approval error:', err);
      toast.error(err?.message || 'Failed to send approval email');
    } finally {
      setSendingApproval(false);
    }
  };

  // Helpers: intake key normalization
  const intake = transaction?.client_intake_data || null;
  const intakeClientName =
    intake?.client_name ?? intake?.clientName ?? transaction?.client_name ?? '—';
  const intakeEmail = intake?.email ?? transaction?.client_email ?? '—';
  const intakePhone = intake?.phone ?? '—';
  const intakeCurrentAddress =
    intake?.current_address ?? intake?.currentAddress ?? '—';
  const intakeIdType = intake?.id_type ?? intake?.idType ?? '—';
  const intakeIdNumber = intake?.id_number ?? intake?.idNumber ?? '';
  const intakeNotes = intake?.notes ?? '';

  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded w-1/4" />
          <div className="h-32 bg-slate-200 rounded" />
        </div>
      </div>
    );
  }

  if (!transaction) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-slate-600">Transaction not found</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasExtractedAps = documents.some(
    (d) => d.type === 'APS' && d.status === 'EXTRACTED' && d.extracted_json
  );
  const intakeCompleted = !!transaction.client_intake_completed_at;
  const canGenerateReq = hasExtractedAps && intakeCompleted;

  const intakePath = `/intake/${transaction.id}`;
  const intakeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${intakePath}`
      : intakePath;

  const hasReqDraft =
    !!transaction.requisition_letter_draft ||
    !!transaction.requisition_letter_draft_html;

  return (
    <div className="p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>

        <div>
          <h1 className="text-3xl font-bold">Transaction Details</h1>
          <p className="text-slate-600 mt-1">
            {transaction.property_address || 'No address provided'}
          </p>
        </div>
      </div>

      {/* Top cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Property info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" />
              Property Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-slate-600">Address</p>
              <p className="font-medium">
                {transaction.property_address || 'Not provided'}
              </p>
            </div>

            {transaction.closing_date && (
              <div>
                <p className="text-sm text-slate-600">Closing Date</p>
                <p className="font-medium flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  {new Date(transaction.closing_date).toLocaleDateString()}
                </p>
                <Button
  variant="outline"
  size="sm"
  onClick={handleCloseFile}
  disabled={closingFile || transaction.status === 'CLOSED'}
>
  {transaction.status === 'CLOSED' ? 'Closed' : (closingFile ? 'Closing…' : 'Close File')}
</Button>

              </div>
              
            )}
          </CardContent>
        </Card>

        {/* Client / file info + intake link */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Client & File
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-slate-600">Client</p>
              <p className="font-medium">
                {transaction.client_name || 'Not provided'}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-600">Client Email</p>
              <div className="flex gap-2 items-center">
                <input
                  type="email"
                  value={editableEmail}
                  onChange={(e) => setEditableEmail(e.target.value)}
                  className="border rounded-md px-2 py-1 text-sm flex-1"
                  placeholder="client@example.com"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveEmail}
                  disabled={savingEmail}
                >
                  {savingEmail ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>

            <div>
              <p className="text-sm text-slate-600">Vendor Solicitor Email</p>
              <div className="flex gap-2 items-center">
                <input
                  type="email"
                  value={vendorEmail}
                  onChange={(e) => setVendorEmail(e.target.value)}
                  className="border rounded-md px-2 py-1 text-sm flex-1"
                  placeholder="vendorsolicitor@firm.com"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveVendorEmail}
                  disabled={savingVendorEmail}
                >
                  {savingVendorEmail ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>

            <div>
              <p className="text-sm text-slate-600">File Number</p>
              <p className="font-medium">
                {transaction.file_number || 'Not provided'}
              </p>
            </div>

            <div>
              <p className="text-sm text-slate-600">Client Intake Link</p>
              <div className="flex gap-2 items-center">
                <input
                  readOnly
                  value={intakeUrl}
                  className="w-full border rounded-md px-2 py-1 text-xs bg-slate-50"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(intakeUrl);
                      toast.success('Intake link copied');
                    } catch {
                      toast.error('Failed to copy link');
                    }
                  }}
                >
                  Copy
                </Button>
              </div>

              {!transaction.client_email && (
                <p className="text-xs text-amber-600 mt-1">
                  No client email on file. Copy this link into your own email to
                  send it to the client.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

 {/* Workflow */}
<Card>
  <CardHeader className="space-y-2">
    <CardTitle>Workflow</CardTitle>

    {(() => {
      const rows = deriveChecklist(transaction, documents);
      const stage = deriveStage(transaction, rows);
      const derivedWorkflow = deriveWorkflowStatusFromChecklist(rows);

      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{derivedWorkflow}</Badge>
          <Badge variant="outline">{stage}</Badge>

          {/* Optional: keep these helpful chips */}
          {transaction?.property_type && (
            <Badge variant="outline">Property: {transaction.property_type}</Badge>
          )}
          <Badge variant="outline">
            Status cert:{' '}
            {transaction?.requires_status_cert ? 'Required' : 'Not required'}
          </Badge>
        </div>
      );
    })()}
  </CardHeader>

  <CardContent className="space-y-3">
    {(() => {
      const rows = deriveChecklist(transaction, documents);

      return (
        <div className="space-y-2">
          {rows.map((r) => {
            const Icon =
              r.status === 'DONE'
                ? CheckCircle2
                : r.status === 'BLOCKED'
                ? AlertTriangle
                : Circle;

            return (
              <div
                key={r.key}
                className="flex items-start gap-2 rounded-md border p-2"
              >
                <Icon className="h-4 w-4 mt-0.5" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{r.label}</p>
                    <Badge
                      variant={
                        r.status === 'DONE'
                          ? 'secondary'
                          : r.status === 'BLOCKED'
                          ? 'destructive'
                          : 'outline'
                      }
                      className="text-xs"
                    >
                      {r.status}
                    </Badge>
                  </div>

                  {r.detail && (
                    <p className="text-xs text-slate-600 mt-1">{r.detail}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
    })()}
  </CardContent>
</Card>


      {/* Upload document */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Document</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleUpload}
            className="flex flex-col md:flex-row gap-3 items-start md:items-end"
          >
            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-600">Document Type</label>
              <select
                value={uploadType}
                onChange={(e) =>
                  setUploadType(e.target.value as 'APS' | 'STATUS_CERT' | 'OTHER')
                }
                className="border rounded-md px-2 py-1 text-sm"
              >
                <option value="APS">APS</option>
                <option value="STATUS_CERT">Status Certificate</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-sm text-slate-600">File</label>
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="text-sm"
              />
            </div>

            <Button type="submit" disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Documents with expand/collapse */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Documents ({documents.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <p className="text-slate-600 text-center py-8">
              No documents uploaded
            </p>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => {
                const aps = doc.extracted_json as any | null;
                const expanded = expandedDocs[doc.id];

                return (
                  <div
                    className="space-y-2 p-4 border rounded-lg hover:bg-slate-50 transition-colors"
                    key={doc.id}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleDoc(doc.id)}
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform ${
                              expanded ? 'rotate-180' : ''
                            }`}
                          />
                        </Button>
                        <FileText className="h-5 w-5 text-slate-600" />
                        <div>
                          <p className="font-medium">{doc.file_name}</p>
                          <p className="text-sm text-slate-600">
                            Uploaded{' '}
                            {new Date(doc.uploaded_at).toLocaleDateString()}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{doc.type}</Badge>

                        {doc.type === 'APS' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRunApsExtraction(doc.id)}
                            disabled={isExtracting}
                          >
                            {isExtracting ? 'Extracting…' : 'Run APS'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {expanded && doc.type === 'APS' && aps && (
                      <div className="mt-3 rounded-md bg-slate-50 p-3 text-sm space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <p className="text-slate-500 text-xs uppercase">
                              Purchasers
                            </p>
                            <p className="font-medium">
                              {aps.purchaser_names?.join(', ') || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase">
                              Vendor
                            </p>
                            <p className="font-medium">
                              {aps.vendor_names?.join(', ') || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase">
                              Property
                            </p>
                            <p className="font-medium">
                              {aps.property_address || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase">
                              Price / Deposit
                            </p>
                            <p className="font-medium">
                              {aps.purchase_price
                                ? `$${aps.purchase_price.toLocaleString()}`
                                : '—'}
                              {aps.deposit_amount
                                ? ` · Deposit $${aps.deposit_amount.toLocaleString()}`
                                : ''}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase">
                              Closing
                            </p>
                            <p className="font-medium">
                              {aps.completion_date || '—'}
                            </p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs uppercase">
                              Req / Irrev
                            </p>
                            <p className="font-medium">
                              Req: {aps.requisition_date || '—'} · Irrev:{' '}
                              {aps.irrevocability_date || '—'}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Client Intake Summary */}
      {transaction.client_intake_data && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Client Intake</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-slate-500 text-xs uppercase">Client Name</p>
                <p className="font-medium">{intakeClientName}</p>
              </div>

              <div>
                <p className="text-slate-500 text-xs uppercase">Email</p>
                <p className="font-medium">{intakeEmail}</p>
              </div>

              <div>
                <p className="text-slate-500 text-xs uppercase">Phone</p>
                <p className="font-medium">{intakePhone}</p>
              </div>

              <div>
                <p className="text-slate-500 text-xs uppercase">
                  Current Address
                </p>
                <p className="font-medium">{intakeCurrentAddress}</p>
              </div>

              <div>
                <p className="text-slate-500 text-xs uppercase">ID</p>
                <p className="font-medium">
                  {intakeIdType} {intakeIdNumber ? `· ${intakeIdNumber}` : ''}
                </p>
              </div>
            </div>

            {intakeNotes ? (
              <div>
                <p className="text-slate-500 text-xs uppercase mb-1">Notes</p>
                <p className="font-medium whitespace-pre-wrap">{intakeNotes}</p>
              </div>
            ) : null}

            {transaction.client_intake_completed_at && (
              <p className="text-xs text-slate-500">
                Intake completed:{' '}
                {new Date(transaction.client_intake_completed_at).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Requisition Letter */}
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle>Requisition Letter</CardTitle>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateRequisition}
              disabled={!canGenerateReq || isGeneratingReq}
            >
              {isGeneratingReq ? 'Generating…' : 'Generate Draft'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyRequisition}
              disabled={!transaction.requisition_letter_draft}
            >
              Copy
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!hasReqDraft ? (
            <p className="text-sm text-slate-600">
              No requisition letter draft generated yet.
              {canGenerateReq
                ? ' Click "Generate Draft" to create one using APS and client intake.'
                : ' APS extraction and client intake must be completed first.'}
            </p>
          ) : (
            <>
              {transaction.requisition_letter_generated_at && (
                <p className="text-xs text-slate-500">
                  Generated:{' '}
                  {new Date(
                    transaction.requisition_letter_generated_at
                  ).toLocaleString()}
                </p>
              )}

              {/* Lawyer approval controls (only show once draft exists) */}
              <div className="rounded-md border p-3 bg-slate-50 space-y-2">
                <p className="text-sm font-medium">Send to Lawyer for Approval</p>
                <div className="flex flex-col md:flex-row gap-2 md:items-center">
                  <input
                    className="border rounded-md px-2 py-2 text-sm flex-1 bg-white"
                    placeholder="lawyer@firm.com"
                    value={lawyerEmail}
                    onChange={(e) => setLawyerEmail(e.target.value)}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveLawyerEmailOnly}
                    disabled={savingLawyerEmail}
                  >
                    {savingLawyerEmail ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSendForApproval}
                    disabled={sendingApproval}
                  >
                    {sendingApproval ? 'Sending…' : 'Send for Approval'}
                  </Button>
                </div>
              </div>

              {/* Draft display */}
              {transaction.requisition_letter_draft_html ? (
                <div className="border rounded-md p-3 bg-white">
                  <div
                    className="prose max-w-none"
                    dangerouslySetInnerHTML={{
                      __html: transaction.requisition_letter_draft_html,
                    }}
                  />
                </div>
              ) : (
                <textarea
                  className="w-full border rounded-md p-3 text-sm h-80 leading-relaxed"
                  readOnly
                  value={transaction.requisition_letter_draft || ''}
                />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
