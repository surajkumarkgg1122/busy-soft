import type { AccountingRepository, Money, PostingResult, VoucherLineInput } from "./types";
import { createStockMovement } from "./inventory";
import { calculateTax } from "./gst";
import { postVoucher } from "./voucher";
import { ValidationError } from "./errors";

export interface ReturnDeps { ids: { next(prefix: string): string }; clock: { now(): string } }
export interface ReturnBase { businessId: string; financialYearId: string; date: string; userId: string; partyId: string; taxableValue: Money; taxRate: number; intraState: boolean; cessRate?: number; narration?: string; }
export interface ReturnAccounts { party: string; sales?: string; purchases?: string; cash?: string; bank?: string; inputCgst?: string; inputSgst?: string; inputIgst?: string; inputCess?: string; outputCgst?: string; outputSgst?: string; outputIgst?: string; outputCess?: string; }
const req = (v: string | undefined, n: string) => { if (!v) throw new ValidationError(`Missing ${n} account.`); return v; };
const dr = (accountId: string, amount: Money, partyId?: string): VoucherLineInput => ({ accountId, debit: amount, credit: 0, partyId });
const cr = (accountId: string, amount: Money, partyId?: string): VoucherLineInput => ({ accountId, debit: 0, credit: amount, partyId });

export async function postSaleReturn(repo: AccountingRepository, input: ReturnBase & { accountMap: ReturnAccounts; itemMovements?: Array<{ itemId: string; quantity: number; unitCost: Money; warehouseId?: string }> }, deps: ReturnDeps): Promise<PostingResult> {
  if (!Number.isSafeInteger(input.taxableValue) || input.taxableValue <= 0) throw new ValidationError("Return taxable value must be positive.");
  const tax = calculateTax({ taxableValue: input.taxableValue, rate: input.taxRate, intraState: input.intraState, cessRate: input.cessRate });
  const lines: VoucherLineInput[] = [dr(req(input.accountMap.sales, "sales return"), input.taxableValue), cr(input.accountMap.party, tax.total, input.partyId)];
  if (tax.cgst) lines.push(dr(req(input.accountMap.outputCgst, "output CGST"), tax.cgst));
  if (tax.sgst) lines.push(dr(req(input.accountMap.outputSgst, "output SGST"), tax.sgst));
  if (tax.igst) lines.push(dr(req(input.accountMap.outputIgst, "output IGST"), tax.igst));
  if (tax.cess) lines.push(dr(req(input.accountMap.outputCess, "output cess"), tax.cess));
  return repo.runInTransaction(async tx => {
    const result = await postVoucher(tx, { businessId: input.businessId, financialYearId: input.financialYearId, voucherType: "SALE_RETURN", prefix: "SR", date: input.date, narration: input.narration, createdBy: input.userId, referenceType: "sale_return", lines }, deps);
    const movements = (input.itemMovements ?? []).map(m => createStockMovement({ businessId: input.businessId, financialYearId: input.financialYearId, date: input.date, itemId: m.itemId, warehouseId: m.warehouseId, direction: "in", quantity: m.quantity, unitCost: m.unitCost, sourceType: "sale_return", sourceId: result.voucher.id, createdBy: input.userId }, deps.ids, deps.clock.now()));
    if (movements.length) await tx.saveStockMovements(movements);
    return { ...result, stockMovements: movements };
  });
}

export async function postPurchaseReturn(repo: AccountingRepository, input: ReturnBase & { accountMap: ReturnAccounts; itemMovements?: Array<{ itemId: string; quantity: number; unitCost: Money; warehouseId?: string }> }, deps: ReturnDeps): Promise<PostingResult> {
  if (!Number.isSafeInteger(input.taxableValue) || input.taxableValue <= 0) throw new ValidationError("Return taxable value must be positive.");
  const tax = calculateTax({ taxableValue: input.taxableValue, rate: input.taxRate, intraState: input.intraState, cessRate: input.cessRate });
  const lines: VoucherLineInput[] = [cr(req(input.accountMap.purchases, "purchase return"), input.taxableValue), dr(input.accountMap.party, tax.total, input.partyId)];
  if (tax.cgst) lines.push(cr(req(input.accountMap.inputCgst, "input CGST"), tax.cgst));
  if (tax.sgst) lines.push(cr(req(input.accountMap.inputSgst, "input SGST"), tax.sgst));
  if (tax.igst) lines.push(cr(req(input.accountMap.inputIgst, "input IGST"), tax.igst));
  if (tax.cess) lines.push(cr(req(input.accountMap.inputCess, "input cess"), tax.cess));
  return repo.runInTransaction(async tx => {
    const result = await postVoucher(tx, { businessId: input.businessId, financialYearId: input.financialYearId, voucherType: "PURCHASE_RETURN", prefix: "PR", date: input.date, narration: input.narration, createdBy: input.userId, referenceType: "purchase_return", lines }, deps);
    const movements = (input.itemMovements ?? []).map(m => createStockMovement({ businessId: input.businessId, financialYearId: input.financialYearId, date: input.date, itemId: m.itemId, warehouseId: m.warehouseId, direction: "out", quantity: m.quantity, unitCost: m.unitCost, sourceType: "purchase_return", sourceId: result.voucher.id, createdBy: input.userId }, deps.ids, deps.clock.now()));
    if (movements.length) await tx.saveStockMovements(movements);
    return { ...result, stockMovements: movements };
  });
}
