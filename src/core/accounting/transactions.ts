import type { AccountingRepository, Money, PostingResult, VoucherLineInput } from "./types";
import { postVoucher } from "./voucher";
import { createStockMovement } from "./inventory";
import { calculateTax } from "./gst";
import { ValidationError } from "./errors";

export interface TransactionDeps { ids: { next(prefix: string): string }; clock: { now(): string } }
export interface BaseTransaction { businessId: string; financialYearId: string; date: string; userId: string; narration?: string; }
export interface AccountMap { party: string; sales?: string; purchases?: string; cash?: string; bank?: string; inputCgst?: string; inputSgst?: string; inputIgst?: string; outputCgst?: string; outputSgst?: string; outputIgst?: string; outputCess?: string; inputCess?: string; inventory?: string; cogs?: string; }
const positive = (amount: number, name: string) => { if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError(`${name} must be a positive integer minor-unit amount.`); };
const debit = (accountId: string, amount: Money, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({ accountId, debit: amount, credit: 0, ...extra });
const credit = (accountId: string, amount: Money, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({ accountId, debit: 0, credit: amount, ...extra });
const required = (value: string | undefined, name: string): string => { if (!value) throw new ValidationError(`Missing ${name} account.`); return value; };

export async function postJournal(repo: AccountingRepository, base: BaseTransaction, lines: VoucherLineInput[], deps: TransactionDeps, voucherType = "JOURNAL", prefix = "JV"): Promise<PostingResult> {
  return repo.runInTransaction(tx => postVoucher(tx, { businessId: base.businessId, financialYearId: base.financialYearId, voucherType, prefix, date: base.date, narration: base.narration, createdBy: base.userId, lines }, deps));
}

export async function postReceipt(repo: AccountingRepository, base: BaseTransaction & { partyId: string; amount: Money; mode: "cash" | "bank"; accountMap: AccountMap }, deps: TransactionDeps): Promise<PostingResult> {
  positive(base.amount, "Receipt amount");
  const debitAccount = required(base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank, `${base.mode} account`);
  return postJournal(repo, base, [debit(debitAccount, base.amount), credit(base.accountMap.party, base.amount, { partyId: base.partyId })], deps, "RECEIPT", "RC");
}

export async function postPayment(repo: AccountingRepository, base: BaseTransaction & { partyId?: string; amount: Money; mode: "cash" | "bank"; accountId: string; accountMap: AccountMap }, deps: TransactionDeps): Promise<PostingResult> {
  positive(base.amount, "Payment amount");
  const creditAccount = required(base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank, `${base.mode} account`);
  return postJournal(repo, base, [debit(base.accountId, base.amount, { partyId: base.partyId }), credit(creditAccount, base.amount)], deps, "PAYMENT", "PY");
}

export async function postContra(repo: AccountingRepository, base: BaseTransaction & { fromAccountId: string; toAccountId: string; amount: Money }, deps: TransactionDeps): Promise<PostingResult> {
  positive(base.amount, "Contra amount");
  if (base.fromAccountId === base.toAccountId) throw new ValidationError("Contra accounts must be different.");
  return postJournal(repo, base, [debit(base.toAccountId, base.amount), credit(base.fromAccountId, base.amount)], deps, "CONTRA", "CT");
}

/** Posts an opening balance as a normal double-entry voucher. The offset is normally Opening Balance Equity. */
export async function postOpeningBalance(repo: AccountingRepository, base: BaseTransaction & { debitLines: LineAmount[]; creditLines: LineAmount[] }, deps: TransactionDeps): Promise<PostingResult> {
  const lines = [...base.debitLines.map(x => debit(x.accountId, x.amount, { partyId: x.partyId, description: x.description })), ...base.creditLines.map(x => credit(x.accountId, x.amount, { partyId: x.partyId, description: x.description }))];
  if (lines.length < 2) throw new ValidationError("Opening balance requires debit and credit lines.");
  return postJournal(repo, base, lines, deps, "OPENING", "OB");
}

export interface LineAmount { accountId: string; amount: Money; partyId?: string; description?: string; }
export async function postExpense(repo: AccountingRepository, base: BaseTransaction & { expenseAccountId: string; amount: Money; mode: "cash" | "bank"; accountMap: AccountMap }, deps: TransactionDeps): Promise<PostingResult> {
  positive(base.amount, "Expense amount");
  const creditAccount = required(base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank, `${base.mode} account`);
  return postJournal(repo, base, [debit(base.expenseAccountId, base.amount), credit(creditAccount, base.amount)], deps, "EXPENSE", "EX");
}

export interface SalePostingInput extends BaseTransaction { customerId: string; taxableValue: Money; taxRate: number; intraState: boolean; cessRate?: number; mode: "credit" | "cash" | "bank"; totalCost: Money; accountMap: AccountMap; itemMovements?: Array<{ itemId: string; quantity: number; unitCost: Money; warehouseId?: string }>; }
export async function postSale(repo: AccountingRepository, input: SalePostingInput, deps: TransactionDeps): Promise<PostingResult> {
  positive(input.taxableValue, "Sale taxable value");
  if (!Number.isSafeInteger(input.totalCost) || input.totalCost < 0) throw new ValidationError("Sale cost must be a non-negative integer.");
  const tax = calculateTax({ taxableValue: input.taxableValue, rate: input.taxRate, intraState: input.intraState, cessRate: input.cessRate });
  const settlement = required(input.mode === "credit" ? input.accountMap.party : input.mode === "cash" ? input.accountMap.cash : input.accountMap.bank, "sale settlement");
  const lines: VoucherLineInput[] = [debit(settlement, tax.total, input.mode === "credit" ? { partyId: input.customerId } : {}), credit(required(input.accountMap.sales, "sales"), input.taxableValue)];
  if (tax.cgst) lines.push(credit(required(input.accountMap.outputCgst, "output CGST"), tax.cgst));
  if (tax.sgst) lines.push(credit(required(input.accountMap.outputSgst, "output SGST"), tax.sgst));
  if (tax.igst) lines.push(credit(required(input.accountMap.outputIgst, "output IGST"), tax.igst));
  if (tax.cess) lines.push(credit(required(input.accountMap.outputCess, "output cess"), tax.cess));
  if (input.totalCost > 0) lines.push(debit(required(input.accountMap.cogs, "COGS"), input.totalCost), credit(required(input.accountMap.inventory, "inventory"), input.totalCost));
  return repo.runInTransaction(async tx => {
    const result = await postVoucher(tx, { businessId: input.businessId, financialYearId: input.financialYearId, voucherType: "SALE", prefix: "SI", date: input.date, narration: input.narration, createdBy: input.userId, referenceType: "sale", lines }, deps);
    const movements = (input.itemMovements ?? []).map(m => createStockMovement({ businessId: input.businessId, financialYearId: input.financialYearId, date: input.date, itemId: m.itemId, warehouseId: m.warehouseId, direction: "out", quantity: m.quantity, unitCost: m.unitCost, sourceType: "sale", sourceId: result.voucher.id, createdBy: input.userId }, deps.ids, deps.clock.now()));
    if (movements.length) await tx.saveStockMovements(movements);
    return { ...result, stockMovements: movements };
  });
}

export interface PurchasePostingInput extends BaseTransaction { supplierId: string; taxableValue: Money; taxRate: number; intraState: boolean; cessRate?: number; mode: "credit" | "cash" | "bank"; accountMap: AccountMap; itemMovements?: Array<{ itemId: string; quantity: number; unitCost: Money; warehouseId?: string }>; }
export async function postPurchase(repo: AccountingRepository, input: PurchasePostingInput, deps: TransactionDeps): Promise<PostingResult> {
  positive(input.taxableValue, "Purchase taxable value");
  const tax = calculateTax({ taxableValue: input.taxableValue, rate: input.taxRate, intraState: input.intraState, cessRate: input.cessRate });
  const settlement = required(input.mode === "credit" ? input.accountMap.party : input.mode === "cash" ? input.accountMap.cash : input.accountMap.bank, "purchase settlement");
  const lines: VoucherLineInput[] = [credit(settlement, tax.total, input.mode === "credit" ? { partyId: input.supplierId } : {}), debit(required(input.accountMap.purchases, "purchases"), input.taxableValue)];
  if (tax.cgst) lines.push(debit(required(input.accountMap.inputCgst, "input CGST"), tax.cgst));
  if (tax.sgst) lines.push(debit(required(input.accountMap.inputSgst, "input SGST"), tax.sgst));
  if (tax.igst) lines.push(debit(required(input.accountMap.inputIgst, "input IGST"), tax.igst));
  if (tax.cess) lines.push(debit(required(input.accountMap.inputCess, "input cess"), tax.cess));
  return repo.runInTransaction(async tx => {
    const result = await postVoucher(tx, { businessId: input.businessId, financialYearId: input.financialYearId, voucherType: "PURCHASE", prefix: "PB", date: input.date, narration: input.narration, createdBy: input.userId, referenceType: "purchase", lines }, deps);
    const movements = (input.itemMovements ?? []).map(m => createStockMovement({ businessId: input.businessId, financialYearId: input.financialYearId, date: input.date, itemId: m.itemId, warehouseId: m.warehouseId, direction: "in", quantity: m.quantity, unitCost: m.unitCost, sourceType: "purchase", sourceId: result.voucher.id, createdBy: input.userId }, deps.ids, deps.clock.now()));
    if (movements.length) await tx.saveStockMovements(movements);
    return { ...result, stockMovements: movements };
  });
}
