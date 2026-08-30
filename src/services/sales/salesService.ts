import { collection, doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { SalePostingInput, TransactionDeps } from "../../core/accounting/transactions";
import { postSale } from "../../core/accounting/transactions";
import type { AccountingRepository, Money, PostingResult, Account } from "../../core/accounting/types";
import { createFirestoreAccountingRepository } from "../../core/accounting/firestoreRepository";
import { createStockMovement } from "../../core/accounting/inventory";
import { reverseVoucher } from "../../core/accounting/voucher";
import { ValidationError } from "../../core/accounting/errors";

export interface SalesServiceDeps { accounting: AccountingRepository; transaction: TransactionDeps; }
export interface SaleItemCommand { itemId: string; quantity: number; unitCost: Money; warehouseId?: string; }
export interface CreateSaleCommand {
  businessId: string; financialYearId: string; date: string; userId: string; customerId?: string;
  taxableValue: Money; taxRate: number; cessRate?: number; intraState: boolean;
  mode: "credit" | "cash" | "bank"; totalCost: Money; accountMap: SalePostingInput["accountMap"];
  items: SaleItemCommand[]; narration?: string;
}
export async function createSale(deps: SalesServiceDeps, command: CreateSaleCommand): Promise<PostingResult> {
  if (!command.businessId || !command.financialYearId) throw new ValidationError("Business and financial year are required.");
  if (command.mode === "credit" && !command.customerId) throw new ValidationError("Customer is required for a credit sale.");
  if (!command.items.length) throw new ValidationError("At least one sale item is required.");
  return postSale(deps.accounting, { ...command, customerId: command.customerId ?? "", accountMap: command.accountMap }, deps.transaction);
}

const money = (rupees: number): Money => { const value = Math.round((Number(rupees) || 0) * 100); if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError("Invalid money value."); return value; };
const fyFor = (date: string) => { const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const start = m >= 4 ? y : y - 1; return { id: `fy-${start}-${String(start + 1).slice(-2)}`, name: `FY ${start}-${String(start + 1).slice(-2)}`, startDate: `${start}-04-01`, endDate: `${start + 1}-03-31` }; };
const salesAccounts: Array<{ id: string; code: string; name: string; type: Account["type"] }> = [
  { id: "acct-cash", code: "1000", name: "Cash", type: "asset" }, { id: "acct-bank", code: "1010", name: "Bank", type: "asset" }, { id: "acct-debtors", code: "1200", name: "Sundry Debtors", type: "asset" },
  { id: "acct-sales", code: "4000", name: "Sales", type: "income" }, { id: "acct-output-cgst", code: "2101", name: "Output CGST", type: "liability" }, { id: "acct-output-sgst", code: "2102", name: "Output SGST", type: "liability" },
  { id: "acct-output-igst", code: "2103", name: "Output IGST", type: "liability" }, { id: "acct-output-cess", code: "2104", name: "Output Cess", type: "liability" }, { id: "acct-inventory", code: "1300", name: "Inventory", type: "asset" }, { id: "acct-cogs", code: "5000", name: "Cost of Goods Sold", type: "expense" },
];

async function ensureSalesSetup(db: Firestore, businessId: string, date: string) { const base = doc(db, "businesses", businessId); const fy = fyFor(date); const fyRef = doc(base, "financialYears", fy.id); if (!(await getDoc(fyRef)).exists()) await setDoc(fyRef, { id: fy.id, businessId, ...fy, locked: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now() }); const now = Timestamp.now(); await Promise.all(salesAccounts.map(async a => { const r = doc(base, "accounts", a.id); if (!(await getDoc(r)).exists()) await setDoc(r, { id: a.id, businessId, ...a, parentId: null, systemAccount: true, active: true, openingDebit: 0, openingCredit: 0, createdAt: now.toDate().toISOString(), updatedAt: now.toDate().toISOString() }); })); return fy.id; }

export async function postSalesInvoiceFromUi(db: Firestore, input: { businessId: string; userId: string; date: string; customerId?: string; taxableValueRupees: number; taxRate: number; cessRate?: number; intraState: boolean; mode: "Credit" | "Cash" | "Bank" | "UPI" | "Card"; totalCostRupees: number; items: SaleItemCommand[]; narration?: string; }): Promise<PostingResult> {
  if (input.mode === "Card") throw new ValidationError("Card settlement is not yet mapped. Use Cash, Bank, UPI or Credit.");
  const financialYearId = await ensureSalesSetup(db, input.businessId, input.date); const accounting = createFirestoreAccountingRepository(db, input.businessId); const transaction: TransactionDeps = { ids: { next: p => `${p}-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } };
  return createSale({ accounting, transaction }, { businessId: input.businessId, financialYearId, date: input.date, userId: input.userId, customerId: input.customerId, taxableValue: money(input.taxableValueRupees), taxRate: input.taxRate, cessRate: input.cessRate, intraState: input.intraState, mode: input.mode === "Credit" ? "credit" : input.mode === "Cash" ? "cash" : "bank", totalCost: money(input.totalCostRupees), items: input.items, accountMap: { party: "acct-debtors", sales: "acct-sales", cash: "acct-cash", bank: "acct-bank", outputCgst: "acct-output-cgst", outputSgst: "acct-output-sgst", outputIgst: "acct-output-igst", outputCess: "acct-output-cess", inventory: "acct-inventory", cogs: "acct-cogs" }, narration: input.narration });
}

export async function cancelSalesInvoiceFromUi(db: Firestore, input: { businessId: string; userId: string; saleId: string; accountingVoucherId: string; date: string; items: SaleItemCommand[] }): Promise<PostingResult> {
  const accounting = createFirestoreAccountingRepository(db, input.businessId); const deps: TransactionDeps = { ids: { next: p => `${p}-${crypto.randomUUID()}` }, clock: { now: () => `${input.date}T23:59:59.000Z` } };
  return accounting.runInTransaction(async tx => { const result = await reverseVoucher(tx, input.accountingVoucherId, input.userId, deps); const movements = input.items.map(m => createStockMovement({ businessId: input.businessId, financialYearId: result.voucher.financialYearId, date: input.date, itemId: m.itemId, warehouseId: m.warehouseId, direction: "in", quantity: m.quantity, unitCost: m.unitCost, sourceType: "sale_cancel", sourceId: input.saleId, createdBy: input.userId }, deps.ids, deps.clock.now())); if (movements.length) await tx.saveStockMovements(movements); return { ...result, stockMovements: movements }; });
}
