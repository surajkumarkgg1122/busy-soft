import type { AccountingRepository, Clock, IdGenerator, Money, PostingResult, VoucherLineInput } from "./types";
import { postVoucher, type VoucherEngineDeps } from "./voucher";
import { createStockMovement } from "./inventory";
import { calculateTax } from "./gst";
import { ValidationError } from "./errors";

export interface TransactionDeps { ids: IdGenerator; clock: Clock }
export interface BaseTransaction { businessId: string; financialYearId: string; date: string; userId: string; narration?: string; }
export interface AccountMap { party: string; sales?: string; purchases?: string; cash?: string; bank?: string; inputCgst?: string; inputSgst?: string; inputIgst?: string; outputCgst?: string; outputSgst?: string; outputIgst?: string; outputCess?: string; inputCess?: string; inventory?: string; cogs?: string; }
export interface LineAmount { accountId: string; amount: Money; partyId?: string; description?: string; }

const positive = (amount: number, name: string) => { if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError(`${name} must be a positive integer minor-unit amount.`); };
const debit = (accountId: string, amount: Money, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({ accountId, debit: amount, credit: 0, ...extra });
const credit = (accountId: string, amount: Money, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({ accountId, debit: 0, credit: amount, ...extra });

export async function postJournal(repo: AccountingRepository, base: BaseTransaction, lines: VoucherLineInput[], deps: TransactionDeps, voucherType = "JOURNAL", prefix = "JV"): Promise<PostingResult> {
  const engineDeps: VoucherEngineDeps = deps;
  return repo.runInTransaction(tx => postVoucher(tx, { businessId: base.businessId, financialYearId: base.financialYearId, voucherType, prefix, date: base.date, narration: base.narration, createdBy: base.userId, lines }, engineDeps));
}

export async function postReceipt(repo: AccountingRepository, base: BaseTransaction & { partyId: string; amount: Money; mode: "cash" | "bank"; accountMap: AccountMap }, deps: TransactionDeps): Promise<PostingResult> {
  positive(base.amount, "Receipt amount");
  const debitAccount = base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank;
  if (!debitAccount) throw new ValidationError(`Missing ${base.mode} account.`);
  return postJournal(repo, base, [debit(debitAccount, base.amount), credit(base.accountMap.party, base.amount, { partyId: base.partyId })], deps, "RECEIPT", "RC");
}

export async function postPayment(repo: AccountingRepository, base: BaseTransaction & { partyId?: string; amount: Money; mode: "cash" | "bank"; accountId: string; accountMap: AccountMap }, deps: TransactionDeps): Promise<PostingResult> {
  positive(base.amount, "Payment amount");
  const creditAccount = base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank;
  if (!creditAccount) throw new ValidationError(`Missing ${base.mode} account.`);
  return postJournal(repo, base, [debit(base.accountId, base.amount, { partyId: base.partyId }), credit(creditAccount, base.amount)], deps, "PAYMENT", "PY");
}

export async function postExpense(repo: AccountingRepository, base: BaseTransaction & { expenseAccountId: string; amount: Money; mode: "cash" | "bank"; accountMap: AccountMap }, deps: TransactionDeps): Promise<PostingResult> {
  positive(base.amount, "Expense amount");
  const creditAccount = base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank;
  if (!creditAccount) throw new ValidationError(`Missing ${base.mode} account.`);
  return postJournal(repo, base, [debit(base.expenseAccountId, base.amount), credit(creditAccount, base.amount)], deps, "EXPENSE", "EX");
}

export interface SalePostingInput extends BaseTransaction {
  customerId: string; taxableValue: Money; taxRate: number; intraState: boolean; cessRate?: number; mode: "credit" | "cash" | "bank";
  totalCost: Money; accountMap: AccountMap; itemMovements?: Array<{ itemId: string; quantity: number; unitCost: Money; warehouseId?: string }>;
}

export async function postSale(repo: AccountingRepository, input: SalePostingInput, deps: TransactionDeps): Promise<PostingResult> {
  positive(input.taxableValue, "Sale taxable value");
  const tax = calculateTax({ taxableValue: input.taxableValue, rate: input.taxRate, intraState: input.intraState, cessRate: input.cessRate });
  const receivable = input.mode === "credit" ? input.accountMap.party : input.mode === "cash" ? input.accountMap.cash : input.accountMap.bank;
  if (!receivable) throw new ValidationError("Missing sale settlement account.");
  const lines: VoucherLineInput[] = [debit(receivable, tax.total, input.mode === "credit" ? { partyId: input.customerId } : {}), credit(input.accountMap.sales!, input.taxableValue)];
  if (tax.cgst) lines.push(credit(input.accountMap.outputCgst!, tax.cgst));
  if (tax.sgst) lines.push(credit(input.accountMap.outputSgst!, tax.sgst));
  if (tax.igst) lines.push(credit(input.accountMap.outputIgst!, tax.igst));
  if (tax.cess) lines.push(credit(input.accountMap.outputCess!, tax.cess));
  if (input.totalCost > 0) { positive(input.totalCost, "Sale cost"); lines.push(debit(input.accountMap.cogs!, input.totalCost), credit(input.accountMap.inventory!, input.totalCost)); }
  const result = await postJournal(repo, input, lines, deps, "SALE", "SI");
  if (input.itemMovements?.length) {
    return repo.runInTransaction(async tx => {
      const movements = input.itemMovements!.map(m => createStockMovement({ businessId: input.businessId, financialYearId: input.financialYearId, date: input.date, itemId: m.itemId, warehouseId: m.warehouseId, direction: "out", quantity: m.quantity, unitCost: m.unitCost, sourceType: "sale", sourceId: result.voucher.id, createdBy: input.userId }, deps.ids, deps.clock.now()));
      await tx.saveStockMovements(movements);
      return { ...result, stockMovements: movements };
    });
  }
  return result;
}

export interface PurchasePostingInput extends BaseTransaction {
  supplierId: string; taxableValue: Money; taxRate: number; intraState: boolean; cessRate?: number; mode: "credit" | "cash" | "bank";
  accountMap: AccountMap; itemMovements?: Array<{ itemId: string; quantity: number; unitCost: Money; warehouseId?: string }>;
}

export async function postPurchase(repo: AccountingRepository, input: PurchasePostingInput, deps: TransactionDeps): Promise<PostingResult> {
  positive(input.taxableValue, "Purchase taxable value");
  const tax = calculateTax({ taxableValue: input.taxableValue, rate: input.taxRate, intraState: input.intraState, cessRate: input.cessRate });
  const payable = input.mode === "credit" ? input.accountMap.party : input.mode === "cash" ? input.accountMap.cash : input.accountMap.bank;
  if (!payable) throw new ValidationError("Missing purchase settlement account.");
  const lines: VoucherLineInput[] = [credit(payable, tax.total, input.mode === "credit" ? { partyId: input.supplierId } : {}), debit(input.accountMap.purchases!, input.taxableValue)];
  if (tax.cgst) lines.push(debit(input.accountMap.inputCgst!, tax.cgst));
  if (tax.sgst) lines.push(debit(input.accountMap.inputSgst!, tax.sgst));
  if (tax.igst) lines.push(debit(input.accountMap.inputIgst!, tax.igst));
  if (tax.cess) lines.push(debit(input.accountMap.inputCess!, tax.cess));
  return postJournal(repo, input, lines, deps, "PURCHASE", "PB");
}
