import type { AccountingRepository, Money, PostingResult, VoucherLineInput } from "./types";
import { postVoucher } from "./voucher";
import { createStockMovement } from "./inventory";
import { calculateTax } from "./gst";
import { ValidationError } from "./errors";
import { assertQuantity, assertMoney } from "./money";

export interface TransactionDeps { ids: { next(prefix: string): string }; clock: { now(): string } }
export interface BaseTransaction { businessId: string; financialYearId: string; date: string; userId: string; narration?: string; }
export interface AccountMap { party: string; sales?: string; purchases?: string; cash?: string; bank?: string; inputCgst?: string; inputSgst?: string; inputIgst?: string; outputCgst?: string; outputSgst?: string; outputIgst?: string; outputCess?: string; inputCess?: string; inventory?: string; cogs?: string; }
const positive = (amount: number, name: string) => { if (!Number.isSafeInteger(amount) || amount <= 0) throw new ValidationError(`${name} must be a positive integer minor-unit amount.`); };
const nonNegative = (amount: number, name: string) => { if (!Number.isSafeInteger(amount) || amount < 0) throw new ValidationError(`${name} must be a non-negative integer minor-unit amount.`); };
const debit = (accountId: string, amount: Money, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({ accountId, debit: amount, credit: 0, ...extra });
const credit = (accountId: string, amount: Money, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({ accountId, debit: 0, credit: amount, ...extra });
const required = (value: string | undefined, name: string): string => { if (!value) throw new ValidationError(`Missing ${name} account.`); return value; };

function validateBase(base: BaseTransaction): void {
  if (!base.businessId || !base.financialYearId || !base.userId) throw new ValidationError("Business, financial year and user are required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base.date)) throw new ValidationError("Transaction date must be YYYY-MM-DD.");
}

interface StockCommand { itemId: string; quantity: number; unitCost: Money; warehouseId?: string; }
function validateStockCommands(items: readonly StockCommand[], direction: "in" | "out", expectedValue?: Money): void {
  if (!items.length) throw new ValidationError("At least one stock item is required for an inventory sale/purchase.");
  let value = 0;
  for (const item of items) {
    if (!item.itemId) throw new ValidationError("Stock item ID is required.");
    assertQuantity(item.quantity);
    assertMoney(item.unitCost, "Unit cost");
    const lineValue = Math.round(item.quantity * item.unitCost);
    if (!Number.isSafeInteger(lineValue)) throw new ValidationError("Stock line value exceeds safe integer range.");
    value += lineValue;
    if (!Number.isSafeInteger(value)) throw new ValidationError("Stock value exceeds safe integer range.");
  }
  if (expectedValue !== undefined && value !== expectedValue) throw new ValidationError(`Stock valuation mismatch: item cost is ${value}, expected ${expectedValue}.`);
  void direction;
}

export async function postJournal(repo: AccountingRepository, base: BaseTransaction, lines: VoucherLineInput[], deps: TransactionDeps, voucherType = "JOURNAL", prefix = "JV"): Promise<PostingResult> {
  validateBase(base);
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

export interface SalePostingInput extends BaseTransaction { customerId?: string; taxableValue: Money; taxRate: number; intraState: boolean; cessRate?: number; mode: "credit" | "cash" | "bank"; totalCost: Money; accountMap: AccountMap; itemMovements: StockCommand[]; }
export async function postSale(repo: AccountingRepository, input: SalePostingInput, deps: TransactionDeps): Promise<PostingResult> {
  validateBase(input);
  positive(input.taxableValue, "Sale taxable value");
  nonNegative(input.totalCost, "Sale cost");
  if (input.mode === "credit" && !input.customerId) throw new ValidationError("Customer is required for a credit sale.");
  if (input.mode !== "credit" && input.customerId) throw new ValidationError("Cash/bank sales cannot carry a party customer in the settlement line; use an explicit party allocation if required.");
  validateStockCommands(input.itemMovements, "out", input.totalCost);
  if (input.totalCost > 0) { required(input.accountMap.cogs, "COGS"); required(input.accountMap.inventory, "inventory"); }
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
    const movements = input.itemMovements.map(m => createStockMovement({ businessId: input.businessId, financialYearId: input.financialYearId, date: input.date, itemId: m.itemId, warehouseId: m.warehouseId, direction: "out", quantity: m.quantity, unitCost: m.unitCost, sourceType: "sale", sourceId: result.voucher.id, createdBy: input.userId }, deps.ids, deps.clock.now()));
    await tx.saveStockMovements(movements);
    return { ...result, stockMovements: movements };
  });
}

export interface PurchasePostingInput extends BaseTransaction { supplierId?: string; taxableValue: Money; taxRate: number; intraState: boolean; cessRate?: number; mode: "credit" | "cash" | "bank"; accountMap: AccountMap; itemMovements: StockCommand[]; }
export async function postPurchase(repo: AccountingRepository, input: PurchasePostingInput, deps: TransactionDeps): Promise<PostingResult> {
  validateBase(input);
  positive(input.taxableValue, "Purchase taxable value");
  if (input.mode === "credit" && !input.supplierId) throw new ValidationError("Supplier is required for a credit purchase.");
  if (input.mode !== "credit" && input.supplierId) throw new ValidationError("Cash/bank purchases cannot carry a supplier in the settlement line; use an explicit party allocation if required.");
  validateStockCommands(input.itemMovements, "in");
  const tax = calculateTax({ taxableValue: input.taxableValue, rate: input.taxRate, intraState: input.intraState, cessRate: input.cessRate });
  const settlement = required(input.mode === "credit" ? input.accountMap.party : input.mode === "cash" ? input.accountMap.cash : input.accountMap.bank, "purchase settlement");
  const inventoryAccount = required(input.accountMap.inventory, "inventory");
  const stockValue = input.itemMovements.reduce((s, m) => s + Math.round(m.quantity * m.unitCost), 0);
  if (!Number.isSafeInteger(stockValue) || stockValue <= 0) throw new ValidationError("Purchase inventory value must be positive.");
  const lines: VoucherLineInput[] = [credit(settlement, tax.total, input.mode === "credit" ? { partyId: input.supplierId } : {}), debit(inventoryAccount, stockValue)];
  if (tax.cgst) lines.push(debit(required(input.accountMap.inputCgst, "input CGST"), tax.cgst));
  if (tax.sgst) lines.push(debit(required(input.accountMap.inputSgst, "input SGST"), tax.sgst));
  if (tax.igst) lines.push(debit(required(input.accountMap.inputIgst, "input IGST"), tax.igst));
  if (tax.cess) lines.push(debit(required(input.accountMap.inputCess, "input cess"), tax.cess));
  const totalDocumentValue = stockValue + tax.total;
  if (totalDocumentValue <= 0) throw new ValidationError("Purchase total must be positive.");
  if (totalDocumentValue !== tax.total + stockValue) throw new ValidationError("Purchase total reconciliation failed.");
  return repo.runInTransaction(async tx => {
    const result = await postVoucher(tx, { businessId: input.businessId, financialYearId: input.financialYearId, voucherType: "PURCHASE", prefix: "PB", date: input.date, narration: input.narration, createdBy: input.userId, referenceType: "purchase", lines }, deps);
    const movements = input.itemMovements.map(m => createStockMovement({ businessId: input.businessId, financialYearId: input.financialYearId, date: input.date, itemId: m.itemId, warehouseId: m.warehouseId, direction: "in", quantity: m.quantity, unitCost: m.unitCost, value: Math.round(m.quantity * m.unitCost), sourceType: "purchase", sourceId: result.voucher.id, createdBy: input.userId }, deps.ids, deps.clock.now()));
    await tx.saveStockMovements(movements);
    return { ...result, stockMovements: movements };
  });
}
