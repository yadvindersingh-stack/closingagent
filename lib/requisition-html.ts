type BuildArgs = {
  transaction: any;
  profile: any | null;
  title: any;
  appended: string[]; // lawyer additions
};

function esc(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeList(items: any): string[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
}

export function buildRequisitionHtml({ transaction, profile, title, appended }: BuildArgs) {
  const firmName = profile?.firm_name || '';
  const firmLawyer = profile?.full_name || '';
  const firmEmail = profile?.email || '';
  const firmPhone = profile?.phone || '';
  const firmAddress = profile?.address_line || '';

  const fileNo = transaction?.file_number || '';
  const clientName = transaction?.client_name || '';
  const property = transaction?.property_address || '';
  const closing = transaction?.closing_date || '';

  const titleNotes = safeList(title?.notes);
  const lawyerFlags = safeList(title?.lawyer_flags);

  // Main requisitions list:
  // 1) Your standard “base” requisitions (minimal defaults, you can expand later)
  // 2) Then inject lawyer additions as normal numbered points
  // 3) Then add any title-search derived requisitions (if you want)
  const baseRequisitions: string[] = [
    'Please provide a draft transfer/deed for approval prior to registration.',
    'Please provide the statement of adjustments in advance of closing for review and approval.',
    'Please confirm the keys/fobs will be made available on completion.',
  ];

  const blended = [
    ...baseRequisitions,
    ...safeList(appended), // <- lawyer additions become MAIN points
  ];

  const flagsHtml =
    lawyerFlags.length > 0
      ? `
      <div style="margin-top:16px;padding:12px;border:1px solid #f0c36d;background:#fff7e6;">
        <div style="font-weight:700;margin-bottom:6px;">Items flagged for clerk review</div>
        <ul style="margin:0;padding-left:18px;">
          ${lawyerFlags.map((f) => `<li>${esc(f)}</li>`).join('')}
        </ul>
      </div>
    `
      : '';

  const titleSummaryHtml =
    titleNotes.length > 0
      ? `
      <div style="margin-top:14px;">
        <div style="font-weight:700;margin-bottom:6px;">Title Search Summary (from lawyer email)</div>
        <ul style="margin:0;padding-left:18px;">
          ${titleNotes.map((n) => `<li>${esc(n)}</li>`).join('')}
        </ul>
      </div>
    `
      : '';

  const requisitionsHtml = `
    <ol style="margin:0;padding-left:20px;">
      ${blended.map((r) => `<li style="margin:6px 0;">${esc(r)}</li>`).join('')}
    </ol>
  `;

  // Simple email-safe HTML (no external CSS)
  return `
  <div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#111; line-height:1.35;">
    <div style="font-weight:700;font-size:16px;margin-bottom:6px;">Requisition Letter</div>
    <div style="margin-bottom:14px;">
      <div><strong>File No:</strong> ${esc(fileNo)}</div>
      <div><strong>Client:</strong> ${esc(clientName)}</div>
      <div><strong>Property:</strong> ${esc(property)}</div>
      <div><strong>Closing Date:</strong> ${esc(closing)}</div>
    </div>

    <div style="margin-bottom:14px;">
      <div style="font-weight:700;margin-bottom:6px;">Requisitions</div>
      ${requisitionsHtml}
    </div>

    ${titleSummaryHtml}
    ${flagsHtml}

    <div style="margin-top:18px;">
      <div>Yours truly,</div>
      <div style="margin-top:10px;font-weight:700;">${esc(firmLawyer || firmName || 'Solicitor')}</div>
      ${firmName ? `<div>${esc(firmName)}</div>` : ''}
      ${firmAddress ? `<div>${esc(firmAddress)}</div>` : ''}
      ${firmPhone ? `<div>${esc(firmPhone)}</div>` : ''}
      ${firmEmail ? `<div>${esc(firmEmail)}</div>` : ''}
    </div>
  </div>
  `.trim();
}
