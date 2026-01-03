// lib/requisition-html.ts

type BuildArgs = {
  transaction: any;
  profile: any | null;
  title: any; // title_search_data
  appended: string[]; // extra requisitions (lawyer notes / additions) appended as MAIN points
};

function esc(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeList(items: any): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim());
}

function formatDateLong(d: Date) {
  // "September 8, 2025" like the PDF
  return d.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatClosingDate(d: any) {
  if (!d) return "";
  // supports date string "2025-09-15" or Date-like
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
}

function looksTorontoOrOttawa(address: string) {
  const a = (address || "").toLowerCase();
  return a.includes("toronto") || a.includes("ottawa");
}

function extractPin(title: any): string | null {
  // adapt these keys to whatever your inbound parsing stores
  const direct =
    (typeof title?.pin === "string" && title.pin.trim()) ||
    (typeof title?.pin_number === "string" && title.pin_number.trim()) ||
    (typeof title?.property_identifier_number === "string" && title.property_identifier_number.trim());

  if (direct) return String(direct).trim();

  // fallback: scan notes text for a PIN-like pattern "12345-6789"
  const notes = safeList(title?.notes);
  for (const n of notes) {
    const m = n.match(/\b\d{4,6}-\d{3,4}\b/);
    if (m?.[0]) return m[0];
  }
  return null;
}

export function buildRequisitionHtml({ transaction, profile, title, appended }: BuildArgs) {
  const firmName = profile?.firm_name || "";
  const lawyerName = profile?.full_name || "";
  const firmEmail = profile?.email || "";
  const firmPhone = profile?.phone || "";
  const firmAddress = profile?.address_line || "";

  const fileNo = transaction?.file_number || transaction?.file_number_text || transaction?.file_number_display || "";
  const clientName = transaction?.client_name || "";
  const property = transaction?.property_address || "";
  const closing = formatClosingDate(transaction?.closing_date);

  // Vendor solicitor block (you may not have these yet; keep blank safely)
  const vendorFirm = transaction?.vendor_solicitor_firm || "";
  const vendorAddress = transaction?.vendor_solicitor_address || "";
  const vendorAttention = transaction?.vendor_solicitor_name || ""; // or contact name
  const vendorEmail = transaction?.vendor_solicitor_email || "";

  // Re line: try to match "X purchase from Y" pattern if you have vendor name
  const vendorName = transaction?.vendor_name || transaction?.seller_name || "";
  const reLine = vendorName
    ? `${clientName || "Purchaser"} purchase from ${vendorName}`
    : `${clientName || "Purchaser"} purchase`;

  const today = formatDateLong(new Date());

  const titleNotes = safeList(title?.notes); // summary (optional display)
  const pin = extractPin(title);

  const requiresStatusCert = !!transaction?.requires_status_cert || String(transaction?.property_type || "").toUpperCase() === "CONDO";
  const needsVacantTax = looksTorontoOrOttawa(property);

  // --- Base requisitions (structured like your PDF) ---
  // NOTE: Some items in the PDF contain purchaser birthdates + “message transfer to clerk”.
  // We can’t reliably populate DOB unless you extract it. We keep a clean generic version.
  const base: string[] = [];

  // 1. Draft Transfer (PDF has DOB table; we keep names)
  base.push(
    `REQUIRED: Draft Transfer of Land, engrossed as follows:\n` +
      `${clientName ? clientName : "Purchaser name"} as registered owner.\n` +
      `PLEASE MESSAGE THE TRANSFER TO OUR OFFICE FOR REVIEW.`
  );

  // 2. Statement of Adjustments
  base.push(`REQUIRED: Statement of Adjustments and a recent property tax bill.`);

  // 3. Evidence of compliance with legislation (a–d)
  base.push(
    `REQUIRED: On or before closing, satisfactory evidence of compliance with the following legislation:\n` +
      `a) The Family Law Act, Ontario;\n` +
      `b) Section 116 of the Income Tax Act, Canada;\n` +
      `c) The Planning Act, Ontario, including completion of the Planning Act statements in the Transfer of Land;\n` +
      `d) The Construction Act, Ontario.`
  );

  // 4. No executions
  base.push(`REQUIRED: On or before closing, satisfactory evidence that there are no executions affecting title to the subject property.`);

  // 5. Buildings/possession consistent; no undisclosed encumbrances
  base.push(
    `REQUIRED: On or before closing, production and delivery of evidence that all buildings situate on the lands herein are located entirely within the limits thereof, that possession has been consistent with registered title to the property and that there are no encumbrances, liens, rights of way, easements, encroachments, restrictions, or agreements of any kind affecting the property which are not disclosed by the registered title.`
  );

  // 6. No work orders; by-law compliance
  base.push(
    `REQUIRED: On or before closing, evidence that there are no work orders outstanding and that the lands and premises and all structures erected thereon comply with all by-laws, standards and regulations enacted or passed by the municipality and any other governmental body or department having jurisdiction thereover.`
  );

  // 7. Taxes/utilities not in arrears
  base.push(
    `REQUIRED: On or before closing, evidence that:\n` +
      `a) there are no arrears of municipal taxes or other municipal charges or assessments, including penalties, and that taxes have been paid in accordance with the Statement of Adjustments;\n` +
      `b) payment of water, hydro, and gas are not in arrears and that each shall be paid to the date of closing.`
  );

  // 8. UFFI
  base.push(`REQUIRED: On or before closing, satisfactory evidence that the property has not been insulated with urea-formaldehyde foam insulation.`);

  // 9. Fixtures/chattels free of liens
  base.push(
    `REQUIRED: On or before closing, satisfactory evidence that the fixtures affixed to the lands and buildings, and the chattel property included in the purchase price are the property of the vendor and are not subject to any conditional sales contract, chattel mortgage or lien note and that the vendor is the absolute owner of all such fixtures and chattels, free of any encumbrances.`
  );

  // 10. Final inspection
  base.push(`REQUIRED: An opportunity for our client to perform a final inspection of the premises.`);

  // 11. Keys and vacant possession
  base.push(
    `REQUIRED: On closing, keys and vacant possession, subject to any tenancy which the purchaser has expressly agreed to assume pursuant to the Agreement of Purchase and Sale.`
  );

  // 12. PIN insertion
  if (pin) {
    base.push(`REQUIRED: Insertion of the PIN Number for the property, being ${pin}, into Box 3 of the Transfer.`);
  } else {
    base.push(`REQUIRED: Insertion of the PIN Number for the property into Box 3 of the Transfer.`);
  }

  // 13. HST not applicable (or evidence)
  base.push(`REQUIRED: On or before closing, evidence that this transaction is not subject to Harmonized Sales Tax.`);

  // 14. Vendor to execute and provide documents a–d
  base.push(
    `REQUIRED: That the vendor execute and provide the following documents to our office, in duplicate, on or before closing:\n` +
      `a) Vendor's undertakings;\n` +
      `b) Warranties/Bill of Sale;\n` +
      `c) Declaration of Possession;\n` +
      `d) Statutory declaration re HST.`
  );

  // 15. Condo/by-law compliance (kept generally; the PDF has a condo-focused item here)
  base.push(
    `REQUIRED: Evidence that the use of the unit and the property and the common elements are in compliance with all relevant municipal by-laws and that there are no outstanding building permits, work orders, correction orders or deficiency orders of any kind whatsoever against the unit or the common elements.`
  );

  // 16–21 Condo-only section (Status Certificate + corp proofs)
  if (requiresStatusCert) {
    base.push(
      `REQUIRED: Status Certificate in accordance with the Condominium Act, containing among other things, the following:\n` +
        `a) financial statements;\n` +
        `b) budget;\n` +
        `c) declaration;\n` +
        `d) management agreement; and\n` +
        `e) particulars of the blanket insurance policy.`
    );
    base.push(`REQUIRED: Copies of Condominium by-laws and regulations.`);
    base.push(`REQUIRED: Production on or before closing of satisfactory evidence as to the persons who are the directors and officers of the Condominium Corporation.`);
    base.push(`REQUIRED: Production on or before closing of satisfactory evidence as to the amount of any monies borrowed by the Condominium Corporation.`);
    base.push(
      `REQUIRED: On or before closing, production and delivery of satisfactory evidence that there are no unsatisfied judgments against the Condominium Corporation, nor any actions, suits or proceedings outstanding, pending, threatened against or otherwise affecting the Condominium Corporation.`
    );
    base.push(
      `REQUIRED: On or before closing, production and delivery of satisfactory evidence that the Condominium Corporation has not given notice convening a special or general meeting of the unit owners respecting matters that could materially affect the property.`
    );
  }

  // 22 Vacant Home Tax / Vacant Unit Tax (Toronto/Ottawa)
  if (needsVacantTax) {
    base.push(
      `REQUIRED: On or before closing, production and delivery of satisfactory evidence that the Vendor has complied with all obligations under the applicable Vacant Home Tax/Vacant Unit Tax, including a statutory declaration confirming the required declaration was filed and that all amounts owing have been paid in full (or will be paid with evidence provided before closing).`
    );
  }

  // Merge base + appended (lawyer additions as main points at the end)
  const appendedClean = safeList(appended);
  const blended = [...base, ...appendedClean];

  const requisitionsHtml = `
    <ol style="margin:0;padding-left:20px;">
      ${blended
        .map(
          (r) =>
            `<li style="margin:8px 0; white-space:pre-wrap;">${esc(r)}</li>`
        )
        .join("")}
    </ol>
  `;

  // Optional: show title email “summary” separately (like a clerk aid)
  const titleSummaryHtml =
    titleNotes.length > 0
      ? `
      <div style="margin-top:14px;">
        <div style="font-weight:700;margin-bottom:6px;">Title Search Summary (from lawyer email)</div>
        <ul style="margin:0;padding-left:18px;">
          ${titleNotes.map((n) => `<li>${esc(n)}</li>`).join("")}
        </ul>
      </div>
    `
      : "";

  return `
  <div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#111; line-height:1.35;">
    <div style="margin-bottom:14px;">${esc(today)}</div>

    <div style="margin-bottom:10px;">
      ${vendorFirm ? `<div>${esc(vendorFirm)}</div>` : ""}
      ${vendorAddress ? vendorAddress.split("\n").map((l: string) => `<div>${esc(l)}</div>`).join("") : ""}
      ${vendorAttention ? `<div>Attention: ${esc(vendorAttention)}</div>` : ""}
    </div>

    <div style="margin-bottom:10px;">
      <div>Dear Sir or Madam:</div>
    </div>

    <div style="margin-bottom:10px;">
      <div><strong>Re:</strong> ${esc(reLine)}</div>
      ${property ? `<div>${esc(property)}</div>` : ""}
      ${closing ? `<div><strong>Closing Date:</strong> ${esc(closing)}</div>` : ""}
      ${fileNo ? `<div><strong>Our File No.:</strong> ${esc(fileNo)}</div>` : ""}
    </div>

    <div style="margin-bottom:12px;">
      Without prejudice to the rights of our client under the Agreement of Purchase and Sale, and reserving the right to submit such further and other requisitions as may be deemed necessary from time to time as well as the right to waive any or all of them, we wish to raise the following requisitions:
    </div>

    <div style="margin-bottom:14px;">
      ${requisitionsHtml}
    </div>

    ${titleSummaryHtml}

    <div style="margin-top:18px;">
      <div style="margin-bottom:10px;">VIA E-MAIL</div>

      ${lawyerName ? `<div>Responsible Lawyer: ${esc(lawyerName)}</div>` : ""}
      ${firmEmail ? `<div>Email: ${esc(firmEmail)}</div>` : ""}
      ${firmPhone ? `<div>Phone: ${esc(firmPhone)}</div>` : ""}

      <div style="margin-top:14px;">Yours very truly,</div>
      ${firmName ? `<div style="font-weight:700;">${esc(firmName)}</div>` : ""}
      ${lawyerName ? `<div>Per: ${esc(lawyerName)}</div>` : ""}
      ${firmAddress ? `<div style="margin-top:8px;">${esc(firmAddress)}</div>` : ""}
      ${vendorEmail ? `<div style="margin-top:8px;">(Vendor Solicitor Email on file: ${esc(vendorEmail)})</div>` : ""}
    </div>
  </div>
  `.trim();
}
