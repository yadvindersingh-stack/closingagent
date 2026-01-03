// lib/requisition-text.ts

type BuildTextArgs = {
  transaction: any;
  profile: any | null;
  appended?: string[]; // title search notes + lawyer additions
};

function s(v: any) {
  return v == null ? '' : String(v);
}

function fmtDate(v: any) {
  // keep simple + robust (you can format nicer later)
  const str = s(v).trim();
  return str || '';
}

function safeLines(items: any): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim());
}

function wrapNumbered(lines: string[], startAt = 1) {
  let n = startAt;
  return lines
    .map((line) => `${n++}. ${line}`)
    .join('\n');
}

export function buildRequisitionText({
  transaction,
  profile,
  appended = [],
}: BuildTextArgs) {
  const firmName = s(profile?.firm_name).trim();
  const firmLawyer = s(profile?.full_name).trim();
  const firmEmail = s(profile?.email).trim();
  const firmPhone = s(profile?.phone).trim();
  const firmAddress = s(profile?.address_line).trim();

  const fileNo = s(transaction?.file_number).trim();
  const clientName = s(transaction?.client_name).trim();
  const property = s(transaction?.property_address).trim();
  const closing = fmtDate(transaction?.closing_date);

  // If you have vendor solicitor name/email later, plug it here
  // For now: generic "Vendor’s Solicitor"
  const vendorSolicitorLine = 'Vendor’s Solicitor';

  // ---- Base letter body (this is the part that must match your PDF) ----
  // I’m keeping it “letter-like” and not bullet-y. You can tune wording to match REQ (1).pdf exactly.
  const headerLines = [
    firmName ? firmName : 'Law Office',
    firmAddress ? firmAddress : '',
    firmPhone ? `Tel: ${firmPhone}` : '',
    firmEmail ? `Email: ${firmEmail}` : '',
  ].filter(Boolean);

  const today = new Date();
  const todayStr = today.toLocaleDateString('en-CA'); // YYYY-MM-DD-ish in CA locales

  const baseRequisitions: string[] = [
    'Please provide a draft Transfer/Deed for approval prior to registration.',
    'Please provide the Statement of Adjustments in advance of closing for review and approval.',
    'Please confirm keys/fobs will be made available on completion.',
  ];

  const extra = safeLines(appended);
  const allRequisitions = [...baseRequisitions, ...extra];

  const requisitionsBlock = allRequisitions.length
    ? wrapNumbered(allRequisitions, 1)
    : '';

  const signName = firmLawyer || firmName || 'Solicitor';

  // ---- Compose final text ----
  // This structure is what makes it look like a real requisition letter (not one-liners).
  return `
${headerLines.join('\n')}

${todayStr}

${vendorSolicitorLine}

Re: Purchase of ${property || '[PROPERTY ADDRESS]'}
Our Client: ${clientName || '[CLIENT NAME]'}
Closing Date: ${closing || '[CLOSING DATE]'}
File No.: ${fileNo || '[FILE NUMBER]'}

We enclose/attach our requisitions and request your replies within the applicable requisition period. Please govern yourself accordingly.

Requisitions:
${requisitionsBlock}

Yours truly,

${signName}
${firmName ? firmName : ''}
`.trim();
}
