import { ValidationError } from "./errors";
import type { Money, PartyKind } from "./partyMaster";

/** Shared master-data types used by advanced Customer/Supplier features. */
export type PartyGroup = {
  id: string;
  businessId: string;
  name: string;
  code: string;
  parentId?: string;
  kind?: PartyKind | "both";
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PartyAddressType = "billing" | "shipping" | "registered" | "other";
export type PartyAddress = {
  id: string;
  label: string;
  type: PartyAddressType;
  line1: string;
  line2?: string;
  city: string;
  district?: string;
  state: string;
  pincode: string;
  country: string;
  gstin?: string;
  isDefault: boolean;
};

export type PartyContact = {
  id: string;
  name: string;
  designation?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  isPrimary: boolean;
  active: boolean;
};

export type PaymentTerms = {
  id: string;
  name: string;
  creditDays: number;
  earlyPaymentDiscountPercent?: number;
  earlyPaymentDiscountDays?: number;
  overdueInterestPercentPerMonth?: number;
  active: boolean;
};

export type PartyTaxConfiguration = {
  placeOfSupplyState?: string;
  defaultTaxRate?: number;
  taxInclusivePricing?: boolean;
  reverseCharge?: boolean;
  tdsApplicable?: boolean;
  tdsSection?: string;
  tdsRate?: number;
  tcsApplicable?: boolean;
  tcsSection?: string;
  tcsRate?: number;
};

export type PartyPriceLevel = {
  id: string;
  name: string;
  discountPercent?: number;
  active: boolean;
};

export type PartyFeatureProfile = {
  groupId?: string;
  paymentTermsId?: string;
  priceLevelId?: string;
  addresses?: PartyAddress[];
  contacts?: PartyContact[];
  tax?: PartyTaxConfiguration;
  notes?: string;
  tags?: string[];
};

export type BillReference = {
  voucherId: string;
  voucherNumber: string;
  partyId: string;
  date: string;
  dueDate: string;
  originalAmount: Money;
  allocatedAmount: Money;
  kind: "invoice" | "debit_note" | "credit_note" | "opening";
};

export type OutstandingBill = BillReference & {
  outstanding: Money;
  ageDays: number;
  overdueDays: number;
  bucket: "current" | "1-30" | "31-60" | "61-90" | "91-180" | "181-365" | "365+";
};

export type AgeingSummary = {
  asOfDate: string;
  current: Money;
  days1to30: Money;
  days31to60: Money;
  days61to90: Money;
  days91to180: Money;
  days181to365: Money;
  days365Plus: Money;
  total: Money;
};

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PINCODE = /^[1-9][0-9]{5}$/;

export function validatePaymentTerms(input: PaymentTerms): PaymentTerms {
  if (!input.name.trim()) throw new ValidationError("Payment terms name is required.");
  if (!Number.isInteger(input.creditDays) || input.creditDays < 0 || input.creditDays > 3650) throw new ValidationError("Credit days must be an integer between 0 and 3650.");
  if (input.earlyPaymentDiscountPercent !== undefined && (!Number.isFinite(input.earlyPaymentDiscountPercent) || input.earlyPaymentDiscountPercent < 0 || input.earlyPaymentDiscountPercent > 100)) throw new ValidationError("Early-payment discount must be between 0 and 100%.");
  if (input.earlyPaymentDiscountDays !== undefined && (!Number.isInteger(input.earlyPaymentDiscountDays) || input.earlyPaymentDiscountDays < 0 || input.earlyPaymentDiscountDays > input.creditDays)) throw new ValidationError("Early-payment discount days must not exceed credit days.");
  if (input.overdueInterestPercentPerMonth !== undefined && (!Number.isFinite(input.overdueInterestPercentPerMonth) || input.overdueInterestPercentPerMonth < 0 || input.overdueInterestPercentPerMonth > 100)) throw new ValidationError("Overdue interest rate must be between 0 and 100% per month.");
  return input;
}

export function validatePartyFeatureProfile(input: PartyFeatureProfile): PartyFeatureProfile {
  const addresses = input.addresses ?? [];
  if (addresses.length > 50) throw new ValidationError("A party can have at most 50 addresses.");
  const contacts = input.contacts ?? [];
  if (contacts.length > 50) throw new ValidationError("A party can have at most 50 contacts.");
  if (addresses.length && !addresses.some(a => a.isDefault)) throw new ValidationError("At least one party address must be the default address.");
  if (addresses.filter(a => a.isDefault).length > 1) throw new ValidationError("Only one party address can be the default address.");
  if (contacts.filter(c => c.isPrimary).length > 1) throw new ValidationError("Only one party contact can be primary.");
  for (const address of addresses) {
    if (!address.label.trim()) throw new ValidationError("Address label is required.");
    if (!address.city.trim() || !address.state.trim()) throw new ValidationError("Address city and state are required.");
    if (!PINCODE.test(address.pincode.trim())) throw new ValidationError("Address pincode must be a valid Indian pincode.");
    if (address.gstin && !GSTIN.test(address.gstin.trim().toUpperCase())) throw new ValidationError("Enter a valid GSTIN for the address.");
  }
  for (const contact of contacts) {
    if (!contact.name.trim()) throw new ValidationError("Contact name is required.");
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim())) throw new ValidationError("Enter a valid contact email.");
  }
  const tax = input.tax;
  if (tax?.defaultTaxRate !== undefined && (!Number.isFinite(tax.defaultTaxRate) || tax.defaultTaxRate < 0 || tax.defaultTaxRate > 100)) throw new ValidationError("Default tax rate must be between 0 and 100%.");
  if (tax?.tdsRate !== undefined && (!Number.isFinite(tax.tdsRate) || tax.tdsRate < 0 || tax.tdsRate > 100)) throw new ValidationError("TDS rate must be between 0 and 100%.");
  if (tax?.tcsRate !== undefined && (!Number.isFinite(tax.tcsRate) || tax.tcsRate < 0 || tax.tcsRate > 100)) throw new ValidationError("TCS rate must be between 0 and 100%.");
  if (tax?.tdsApplicable && !tax.tdsSection?.trim()) throw new ValidationError("TDS section is required when TDS is enabled.");
  if (tax?.tcsApplicable && !tax.tcsSection?.trim()) throw new ValidationError("TCS section is required when TCS is enabled.");
  return input;
}

function utcDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`Invalid date: ${value}`);
  return date;
}

export function addCreditDays(invoiceDate: string, creditDays: number): string {
  const date = utcDate(invoiceDate);
  date.setUTCDate(date.getUTCDate() + creditDays);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.max(0, Math.floor((utcDate(to).getTime() - utcDate(from).getTime()) / 86400000));
}

export function ageingBucket(ageDays: number): OutstandingBill["bucket"] {
  if (ageDays <= 0) return "current";
  if (ageDays <= 30) return "1-30";
  if (ageDays <= 60) return "31-60";
  if (ageDays <= 90) return "61-90";
  if (ageDays <= 180) return "91-180";
  if (ageDays <= 365) return "181-365";
  return "365+";
}

/** Apply bill-wise allocations without allowing over-allocation or negative outstanding. */
export function calculateBillWiseOutstanding(bills: BillReference[], asOfDate: string): OutstandingBill[] {
  return bills.filter(b => b.date <= asOfDate).map(bill => {
    if (!Number.isSafeInteger(bill.originalAmount) || bill.originalAmount < 0) throw new ValidationError("Bill amount must be a non-negative minor-unit integer.");
    if (!Number.isSafeInteger(bill.allocatedAmount) || bill.allocatedAmount < 0 || bill.allocatedAmount > bill.originalAmount) throw new ValidationError(`Invalid allocation for voucher ${bill.voucherNumber}.`);
    const outstanding = bill.originalAmount - bill.allocatedAmount;
    const ageDays = daysBetween(bill.dueDate, asOfDate);
    const overdueDays = ageDays;
    return { ...bill, outstanding, ageDays, overdueDays, bucket: ageingBucket(ageDays) };
  }).filter(bill => bill.outstanding > 0);
}

export function summarizeAgeing(bills: OutstandingBill[], asOfDate: string): AgeingSummary {
  const summary: AgeingSummary = { asOfDate, current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days91to180: 0, days181to365: 0, days365Plus: 0, total: 0 };
  for (const bill of bills) {
    summary.total += bill.outstanding;
    if (bill.bucket === "current") summary.current += bill.outstanding;
    else if (bill.bucket === "1-30") summary.days1to30 += bill.outstanding;
    else if (bill.bucket === "31-60") summary.days31to60 += bill.outstanding;
    else if (bill.bucket === "61-90") summary.days61to90 += bill.outstanding;
    else if (bill.bucket === "91-180") summary.days91to180 += bill.outstanding;
    else if (bill.bucket === "181-365") summary.days181to365 += bill.outstanding;
    else summary.days365Plus += bill.outstanding;
  }
  return summary;
}

export type PartyDuplicateCandidate = { partyId: string; name: string; phone?: string; email?: string; gstin?: string; score: number; reasons: string[] };

/** Conservative duplicate detector. It reports candidates; it never merges automatically. */
export function findPotentialDuplicates(target: { name: string; phone?: string; email?: string; gstin?: string }, parties: Array<{ id: string; name: string; phone?: string; email?: string; gstin?: string }>): PartyDuplicateCandidate[] {
  const normalize = (value?: string) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const targetName = normalize(target.name), targetPhone = normalize(target.phone), targetEmail = normalize(target.email), targetGstin = normalize(target.gstin);
  return parties.filter(p => p.id).map(p => {
    const reasons: string[] = []; let score = 0;
    if (targetGstin && targetGstin === normalize(p.gstin)) { score += 100; reasons.push("same GSTIN"); }
    if (targetPhone && targetPhone === normalize(p.phone)) { score += 70; reasons.push("same phone"); }
    if (targetEmail && targetEmail === normalize(p.email)) { score += 60; reasons.push("same email"); }
    if (targetName && targetName === normalize(p.name)) { score += 40; reasons.push("same name"); }
    return { partyId: p.id, name: p.name, phone: p.phone, email: p.email, gstin: p.gstin, score, reasons };
  }).filter(p => p.score >= 40).sort((a, b) => b.score - a.score);
}

export type PartyImportRow = { name: string; phone?: string; email?: string; gstin?: string; state?: string; city?: string; pincode?: string; creditLimit?: string; creditDays?: string; groupCode?: string };

export function validatePartyImportRow(row: PartyImportRow, rowNumber: number): PartyImportRow {
  if (!row.name?.trim()) throw new ValidationError(`Import row ${rowNumber}: party name is required.`);
  if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) throw new ValidationError(`Import row ${rowNumber}: invalid email.`);
  if (row.gstin && !GSTIN.test(row.gstin.trim().toUpperCase())) throw new ValidationError(`Import row ${rowNumber}: invalid GSTIN.`);
  if (row.pincode && !PINCODE.test(row.pincode.trim())) throw new ValidationError(`Import row ${rowNumber}: invalid pincode.`);
  if (row.creditLimit !== undefined && (!/^\d+(\.\d{1,2})?$/.test(row.creditLimit.trim()) || Number(row.creditLimit) < 0)) throw new ValidationError(`Import row ${rowNumber}: invalid credit limit.`);
  if (row.creditDays !== undefined && (!/^\d+$/.test(row.creditDays.trim()) || Number(row.creditDays) > 3650)) throw new ValidationError(`Import row ${rowNumber}: invalid credit days.`);
  return row;
}
