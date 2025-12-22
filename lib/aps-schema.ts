export interface APSData {
  purchaser_names: string[];
  vendor_names: string[];
  property_address: string | null;
  purchase_price: number | null;
  deposit_amount: number | null;
  completion_date: string | null;
  requisition_date: string | null;
  chattels_included: string[];
  fixtures_excluded: string[];
  rental_items: string[];
  hst_included: boolean | null;
  commission_percentage: number | null;
  closing_adjustments: string[];
  conditions: string[];
  irrevocability_date: string | null;
}

export function validateAPSData(data: any): APSData {
  return {
    purchaser_names: Array.isArray(data.purchaser_names) ? data.purchaser_names : [],
    vendor_names: Array.isArray(data.vendor_names) ? data.vendor_names : [],
    property_address: data.property_address || null,
    purchase_price: typeof data.purchase_price === 'number' ? data.purchase_price : null,
    deposit_amount: typeof data.deposit_amount === 'number' ? data.deposit_amount : null,
    completion_date: data.completion_date || null,
    requisition_date: data.requisition_date || null,
    chattels_included: Array.isArray(data.chattels_included) ? data.chattels_included : [],
    fixtures_excluded: Array.isArray(data.fixtures_excluded) ? data.fixtures_excluded : [],
    rental_items: Array.isArray(data.rental_items) ? data.rental_items : [],
    hst_included: typeof data.hst_included === 'boolean' ? data.hst_included : null,
    commission_percentage: typeof data.commission_percentage === 'number' ? data.commission_percentage : null,
    closing_adjustments: Array.isArray(data.closing_adjustments) ? data.closing_adjustments : [],
    conditions: Array.isArray(data.conditions) ? data.conditions : [],
    irrevocability_date: data.irrevocability_date || null,
  };
}
