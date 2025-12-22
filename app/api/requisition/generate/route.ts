import { NextRequest, NextResponse } from 'next/server';

// Simple helper to safely join arrays
function joinList(values: any, fallback: string = 'N/A'): string {
  if (!values) return fallback;
  if (Array.isArray(values)) return values.join(', ') || fallback;
  return String(values);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { transactionId, transaction, aps, intake } = body || {};

    if (!transactionId) {
      return NextResponse.json(
        { message: 'transactionId is required' },
        { status: 400 }
      );
    }

    if (!aps) {
      return NextResponse.json(
        {
          message:
            'APS data is required to generate a requisition letter. Please run APS extraction first.',
        },
        { status: 400 }
      );
    }

    const tx = transaction || {};
    const intakeData = intake || {};

    const purchaserNames = joinList(aps.purchaser_names, 'Purchaser');
    const vendorNames = joinList(aps.vendor_names, 'Vendor');
    const propertyAddress = aps.property_address || tx.property_address || 'Property Address';
    const closingDate = aps.completion_date || tx.closing_date || 'Closing Date';
    const fileNumber = tx.file_number || 'Our File No. __________';

    const isCondo =
      (tx.property_type && String(tx.property_type).toLowerCase().includes('condo')) ||
      String(propertyAddress).toLowerCase().includes('unit');

    const clientName = intakeData.client_name || tx.client_name || purchaserNames;

    // Very simple, deterministic template for now – no OpenAI call
    const draft = `
${new Date().toLocaleDateString()}

WITHOUT PREJUDICE

Vendor's Solicitor
___________________________
___________________________

Re:  Purchase of ${propertyAddress}
     From: ${vendorNames}
     To:   ${purchaserNames}
     Closing: ${closingDate}
     Our File: ${fileNumber}

Dear Sirs/Mesdames:

We act for the Purchaser, ${clientName}, with respect to the above-noted transaction.

We acknowledge receipt of a copy of the Agreement of Purchase and Sale and, upon our review of same together with the results of the title and off-title searches, we make the following requisitions on title and on the Vendor, which are to be complied with on or before closing, unless otherwise specifically stated:

1. Good Title / Transfer

1.1 Please advise that on closing the Purchaser will be conveyed good and marketable title in fee simple to the property municipally known as ${propertyAddress}, free and clear of all encumbrances, save and except only for permitted encumbrances as set out in the Agreement of Purchase and Sale.

1.2 The Transfer/Deed is to be prepared in registrable form and shall be delivered to the Purchaser's solicitor in a form suitable for registration, together with all necessary authorizations, undertakings and supporting documentation.

2. Taxes and Adjustments

2.1 Please provide a copy of the most recent realty tax bill and confirmation that all taxes, local improvements and other charges levied against the property are paid up to the date of closing.

2.2 Realty taxes and any other appropriate items shall be adjusted between the parties as of 12:01 a.m. on the day of closing.

2.3 If applicable, please confirm the HST treatment as set out in the Agreement of Purchase and Sale and that HST, if payable, will be dealt with in accordance with the terms of the agreement.

3. Utilities and Accounts

3.1 Please confirm that all utilities (including but not limited to water, sewer, gas and electricity) will be paid in full to the date of closing and that any necessary final meter readings will be taken.

3.2 Any prepaid items or deposits held with utility providers shall be adjusted or assigned as between the parties as of the closing date where applicable.

4. Compliance and Use

4.1 Please confirm that the property and all buildings and improvements thereon comply with all applicable zoning by-laws, building by-laws and other municipal and governmental regulations and that there are no outstanding work orders, deficiency notices or other non-compliance matters affecting the property.

4.2 Please confirm that there are no outstanding agreements, options or rights of first refusal which affect the title or the Purchaser's intended use of the property.

4.3 Please confirm that all additions, renovations and improvements to the property, if any, have been completed with all required permits and final inspections.

5. Encumbrances, Mortgages and Executions

5.1 Please provide a statement of all mortgages, charges and other encumbrances registered against title to be paid out and discharged on or before closing, together with appropriate discharge undertakings and directions.

5.2 Please confirm that any executions or writs of seizure and sale filed against the Vendor will be fully addressed and removed so as not to affect the Purchaser or the title on or after closing.

6. Possession and Risk

6.1 Vacant possession of the property is to be given to the Purchaser on closing, subject only to such tenancies as may be specifically set out in the Agreement of Purchase and Sale or as otherwise agreed in writing.

6.2 Risk of loss or damage to the property shall remain with the Vendor until completion of the transaction in accordance with the Agreement of Purchase and Sale.

7. Chattels, Fixtures and Rental Items

7.1 Please confirm that all chattels included in the purchase price, including without limitation:

${joinList(aps.chattels_included, 'As per Agreement of Purchase and Sale')}

are owned by the Vendor and will be free and clear of all liens and encumbrances on closing.

7.2 Please provide details of all rental items and any equipment rental or service contracts affecting the property, including the hot water tank as referenced in the agreement, and confirm whether the Purchaser is to assume any such contracts.

${
  isCondo
    ? `
8. Condominium Matters

8.1 If the property forms part of a condominium plan, please confirm that common expenses are paid in full to the date of closing and provide details of the current monthly common expenses.

8.2 Please confirm that there are no special assessments pending or contemplated by the condominium corporation which will affect the unit after closing.

8.3 Please confirm that the status certificate, together with all accompanying documents, has been provided and that there have been no material changes since the date of the status certificate.

8.4 Please confirm that there are no outstanding or threatened claims, actions or proceedings involving the condominium corporation which may materially affect the unit or the common elements.
`
    : ''
}

9. Family Law Act and Other Confirmations

9.1 Where applicable, please provide such evidence, declarations or spousal consents as may be required to show compliance with the Family Law Act (Ontario).

9.2 Please provide any additional documentation customarily supplied in Ontario residential real estate transactions to ensure that good and marketable title is conveyed to the Purchaser, including, if required, statutory declarations, undertakings and directions.

10. General

10.1 These requisitions are made without prejudice to the right of the Purchaser to make further or other requisitions on title or otherwise, whether arising from the results of the title and off-title searches, survey or otherwise, and the Purchaser hereby specifically reserves such rights.

Kindly provide your written responses and undertakings to the above requisitions on or before the date required for title requisitions under the Agreement of Purchase and Sale, and in any event in sufficient time prior to closing to permit an orderly completion of the transaction.

Yours very truly,

______________________________
Purchaser's Solicitor
`.trim();

    return NextResponse.json({
      message: 'Requisition letter draft generated (template)',
      draft,
    });
  } catch (err: any) {
    console.error('Unexpected error in /api/requisition/generate:', err);
    return NextResponse.json(
      {
        message: 'Unexpected error while generating requisition letter',
        error: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
