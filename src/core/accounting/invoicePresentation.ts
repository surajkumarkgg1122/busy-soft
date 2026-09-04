import type { LedgerEntry, Money, Voucher, VoucherLine } from "./types";
import { ValidationError } from "./errors";

export type InvoicePaperSize = "A4" | "A5" | "THERMAL";
export type InvoiceChannel = "print" | "pdf" | "whatsapp" | "email";

export interface InvoicePresentationSettings {
  paperSize: InvoicePaperSize;
  logoUrl?: string;
  signatureUrl?: string;
  terms?: string[];
  bankDetails?: { name?: string; accountNumber?: string; ifsc?: string; branch?: string };
  upiId?: string;
  qrValue?: string;
  showBarcode?: boolean;
}

export interface InvoiceLinePresentation {
  itemId?: string;
  description: string;
  quantity?: number;
  unit?: string;
  rate?: Money;
  discount?: Money;
  taxableValue?: Money;
  taxRate?: number;
  amount?: Money;
}

export interface InvoiceTaxPresentation { accountId: string; label: "CGST" | "SGST" | "IGST" | "CESS"; amount: Money; }

export interface AuthoritativeInvoicePresentation {
  voucherId: string;
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  partyId?: string;
  status: Voucher["status"];
  taxableValue: Money;
  taxTotal: Money;
  total: Money;
  paidAmount: Money;
  outstandingAmount: Money;
  taxLines: InvoiceTaxPresentation[];
  lines: InvoiceLinePresentation[];
  settings: InvoicePresentationSettings;
}

function finiteMoney(value: unknown, name: string): Money {
  if (!Number.isSafeInteger(value as number) || (value as number) < 0) throw new ValidationError(`Stored invoice ${name} is invalid.`);
  return value as number;
}

function lineAmount(lines: readonly VoucherLine[], accountId: string | undefined, side: "debit" | "credit") {
  if (!accountId) return 0;
  return lines.filter((l) => l.accountId === accountId).reduce((sum, l) => sum + (side === "debit" ? l.debit : l.credit), 0);
}

/**
 * Builds the printable invoice from the posted accounting voucher and its stored
 * document payload. It deliberately performs no invoice-tax or total calculation.
 * Accounting/tax values are read from the authoritative posted transaction.
 */
export function buildAuthoritativeInvoicePresentation(
  voucher: Voucher,
  lines: readonly VoucherLine[],
  payload: Record<string, unknown>,
  accountMap: { party: string; cash?: string; bank?: string; sales: string; outputCgst?: string; outputSgst?: string; outputIgst?: string; outputCess?: string },
  settings: InvoicePresentationSettings = { paperSize: "A4" },
): AuthoritativeInvoicePresentation {
  if (voucher.status !== "posted" && voucher.status !== "cancelled") throw new ValidationError("Only posted or cancelled invoices can be presented.");
  const expectedTotal = lineAmount(lines, accountMap.party, "debit") + lineAmount(lines, accountMap.cash, "debit") + lineAmount(lines, accountMap.bank, "debit");
  const total = finiteMoney(payload.total, "total");
  if (expectedTotal !== total) throw new ValidationError("Stored invoice total does not reconcile with the accounting voucher.");

  const taxableValue = finiteMoney(payload.taxableValue, "taxable value");
  const taxTotal = finiteMoney(payload.taxTotal, "tax total");
  const taxLines: InvoiceTaxPresentation[] = [
    ["CGST", accountMap.outputCgst], ["SGST", accountMap.outputSgst], ["IGST", accountMap.outputIgst], ["CESS", accountMap.outputCess],
  ].flatMap(([label, accountId]) => accountId ? [{ label: label as InvoiceTaxPresentation["label"], accountId, amount: lineAmount(lines, accountId, "credit") }] : []);
  const renderedTaxTotal = taxLines.reduce((sum, tax) => sum + tax.amount, 0);
  if (renderedTaxTotal !== taxTotal) throw new ValidationError("Stored invoice GST total does not reconcile with accounting tax lines.");

  const rawItems = Array.isArray(payload.items) ? payload.items : [];
  const invoiceLines = rawItems.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      itemId: typeof item.itemId === "string" ? item.itemId : undefined,
      description: typeof item.description === "string" ? item.description : typeof item.name === "string" ? item.name : String(item.itemId ?? "Item"),
      quantity: typeof item.quantity === "number" ? item.quantity : undefined,
      unit: typeof item.unit === "string" ? item.unit : undefined,
      rate: typeof item.price === "number" ? item.price : undefined,
      discount: typeof item.discountAmount === "number" ? item.discountAmount : undefined,
      taxableValue: typeof item.taxableValue === "number" ? item.taxableValue : undefined,
      taxRate: typeof item.taxRate === "number" ? item.taxRate : undefined,
      amount: typeof item.amount === "number" ? item.amount : undefined,
    };
  });

  return {
    voucherId: voucher.id,
    invoiceNumber: voucher.voucherNumber,
    date: voucher.date,
    dueDate: voucher.dueDate,
    partyId: typeof payload.partyId === "string" ? payload.partyId : undefined,
    status: voucher.status,
    taxableValue,
    taxTotal,
    total,
    paidAmount: finiteMoney(payload.paidAmount ?? 0, "paid amount"),
    outstandingAmount: finiteMoney(payload.outstandingAmount ?? 0, "outstanding amount"),
    taxLines,
    lines: invoiceLines,
    settings,
  };
}

/** Print/PDF/export consumers should use this exact model; never recompute totals. */
export function invoiceChannelIntent(channel: InvoiceChannel, invoice: AuthoritativeInvoicePresentation) {
  return { channel, voucherId: invoice.voucherId, invoiceNumber: invoice.invoiceNumber, total: invoice.total, paperSize: invoice.settings.paperSize };
}
