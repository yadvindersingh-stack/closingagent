export type IncomingDocKey =
  | 'reply_to_requisition'
  | 'statement_of_adjustments'
  | 'closing_document'
  | 'hst'
  | 'stat_dec_residency'
  | 'stat_dec_spousal'
  | 'undertakings'
  | 'uff_warranty'
  | 'bill_of_sale'
  | 'doc_registration_agreement'
  | 'signature_required'
  | 'lawyers_undertaking_vendor_mortgage'
  | 'payout_statement_mortgage';

export const INCOMING_DOCS: { key: IncomingDocKey; label: string; keywords: string[] }[] = [
  { key: 'reply_to_requisition', label: 'Reply to Requisition Letter', keywords: ['reply to requisition', 're: requisition', 'requisitions replied'] },
  { key: 'statement_of_adjustments', label: 'Statement of Adjustments', keywords: ['statement of adjustments', 'soa', 'adjustments'] },
  { key: 'closing_document', label: 'Closing Documents', keywords: ['closing documents', 'closing package', 'closing docs'] },
  { key: 'hst', label: 'HST', keywords: ['hst'] },
  { key: 'stat_dec_residency', label: 'Stat Dec - Residency (Tax)', keywords: ['statutory declaration', 'resident of canada', 'non-resident', 'residency'] },
  { key: 'stat_dec_spousal', label: 'Stat Dec - Spousal Status', keywords: ['statutory declaration', 'spousal', 'marital status'] },
  { key: 'undertakings', label: 'Undertakings', keywords: ['undertaking', 'undertakings'] },
  { key: 'uff_warranty', label: 'UFF Warranty', keywords: ['uff warranty', 'uff'] },
  { key: 'bill_of_sale', label: 'Bill of Sale', keywords: ['bill of sale'] },
  { key: 'doc_registration_agreement', label: 'Document Registration Agreement', keywords: ['document registration agreement', 'registration agreement'] },
  { key: 'signature_required', label: 'Signature Required', keywords: ['signature required', 'please sign', 'execution'] },
  { key: 'lawyers_undertaking_vendor_mortgage', label: "Lawyer's Undertaking (Vendor Mortgage)", keywords: ['lawyer undertaking', 'vendor mortgage undertaking'] },
  { key: 'payout_statement_mortgage', label: 'Payout Statement (Mortgage)', keywords: ['payout statement', 'mortgage payout', 'discharge statement'] },
];
