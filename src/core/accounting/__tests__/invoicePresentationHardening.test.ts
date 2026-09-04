import { describe, expect, it } from "vitest";
import { buildAuthoritativeInvoicePresentation, invoiceChannelIntent } from "../invoicePresentation";
import type { Voucher, VoucherLine } from "../types";

const voucher: Voucher = {
  id: "v-sale-1", businessId: "biz-qa", financialYearId: "fy-2026-27", voucherType: "SALE", voucherNumber: "SI-0001",
  date: "2026-08-30", status: "posted", createdBy: "qa", createdAt: "2026-08-30T00:00:00Z", updatedAt: "2026-08-30T00:00:00Z",
  totalDebit: 11800, totalCredit: 11800,
};
const lines: VoucherLine[] = [
  { lineId: "1", voucherId: voucher.id, businessId: voucher.businessId, lineNo: 1, accountId: "acct-debtors", partyId: "party-1", debit: 11800, credit: 0 },
  { lineId: "2", voucherId: voucher.id, businessId: voucher.businessId, lineNo: 2, accountId: "acct-sales", debit: 0, credit: 10000 },
  { lineId: "3", voucherId: voucher.id, businessId: voucher.businessId, lineNo: 3, accountId: "acct-output-cgst", debit: 0, credit: 900 },
  { lineId: "4", voucherId: voucher.id, businessId: voucher.businessId, lineNo: 4, accountId: "acct-output-sgst", debit: 0, credit: 900 },
];
const map = { party: "acct-debtors", sales: "acct-sales", outputCgst: "acct-output-cgst", outputSgst: "acct-output-sgst" };

describe("authoritative invoice presentation", () => {
  it("uses stored transaction totals and accounting GST lines without recalculation", () => {
    const invoice = buildAuthoritativeInvoicePresentation(voucher, lines, { taxableValue: 10000, taxTotal: 1800, total: 11800, paidAmount: 0, outstandingAmount: 11800, partyId: "party-1" }, map);
    expect(invoice.taxableValue).toBe(10000);
    expect(invoice.taxTotal).toBe(1800);
    expect(invoice.total).toBe(11800);
    expect(invoice.taxLines.map((x) => x.amount)).toEqual([900, 900]);
  });

  it("fails closed when printed total differs from accounting debits", () => {
    expect(() => buildAuthoritativeInvoicePresentation(voucher, lines, { taxableValue: 10000, taxTotal: 1800, total: 11799, paidAmount: 0, outstandingAmount: 11799 }, map)).toThrow(/total does not reconcile/);
  });

  it("fails closed when stored GST total differs from posted GST lines", () => {
    expect(() => buildAuthoritativeInvoicePresentation(voucher, lines, { taxableValue: 10000, taxTotal: 1801, total: 11800, paidAmount: 0, outstandingAmount: 11800 }, map)).toThrow(/GST total does not reconcile/);
  });

  it("uses the same authoritative total for print, PDF, WhatsApp and email intents", () => {
    const invoice = buildAuthoritativeInvoicePresentation(voucher, lines, { taxableValue: 10000, taxTotal: 1800, total: 11800, paidAmount: 0, outstandingAmount: 11800 }, map);
    for (const channel of ["print", "pdf", "whatsapp", "email"] as const) expect(invoiceChannelIntent(channel, invoice).total).toBe(11800);
  });
});
