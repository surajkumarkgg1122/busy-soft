import { collection, doc, getDoc, getDocs, setDoc, Timestamp } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { SalePostingInput, TransactionDeps } from "../../core/accounting/transactions";
import { postSale } from "../../core/accounting/transactions";
import type { AccountingRepository, Money, PostingResult, Account } from "../../core/accounting/types";
import { createFirestoreAccountingRepository } from "../../core/accounting/firestoreRepository";
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
  if (!command.businessId) throw new ValidationError("businessId is required.");
  if (!command.financialYearId) throw new ValidationError("financialYearId is required.");
  if (command.mode === "credit" && !command.customerId) throw new ValidationError("Customer is required for a credit sale.");
  if (!command.items.length) throw new ValidationError("At least one sale item is required.");
  if (command.items.some(i => !i.itemId || !Number.isFinite(i.quantity) || i.quantity <= 0)) throw new ValidationError("Every sale item must have a valid quantity.");
  return postSale(deps.accounting, {
    businessId: command.businessId, financialYearId: command.financialYearId, date: command.date, userId: command.userId,
    customerId: command.customerId ?? "", taxableValue: command.taxableValue, taxRate: command.taxRate,
    cessRate: command.cessRate, intraState: command.intraState, mode: command.mode, totalCost: command.totalCost,
    accountMap: command.accountMap, itemMovements: command.items, narration: command.narration,
  }, deps.transaction);
}

const money = (rupees: number): Money => { const value = Math.round((Number(rupees) || 0) * 100); if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError("Invalid money value."); return value; };
const fyFor = (date: string) => { const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const start = m >= 4 ? y : y - 1; return { id: `fy-${start}-${String(start + 1).slice(-2)}`, name: `FY ${start}-${String(start + 1).slice(-2)}`, startDate: `${start}-04-01`, endDate: `${start + 1}-03-31` }; };

/** Transitional UI adapter. It creates only the minimum sales chart-of-accounts if this is a new business. */
export async function postSalesInvoiceFromUi(db: Firestore, input: { businessId: string; userId: string; date: string; customerId?: string; taxableValueRupees: number; taxRate: number; cessRate?: number; intraState: boolean; mode: "Credit" | "Cash" | "Bank" | "UPI" | "Card"; totalCostRupees: number; items: SaleItemCommand[]; narration?: string; }): Promise<PostingResult> {
  if (input.mode === "Card") throw new ValidationError("Card settlement is not yet mapped. Use Cash, Bank, UPI or Credit.");
  const fy = fyFor(input.date); const base = doc(db, "businesses", input.businessId); const fyRef = doc(base, "financialYears", fy.id); const fySnap = await getDoc(fyRef);
  if (!fySnap.exists()) await setDoc(fyRef, { id: fy.id, businessId: input.businessId, ...fy, locked: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  const defs: Array<{ id: string; code: string; name: string; type: Account["type"] }> = [
    { id: "acct-cash", code: "1000", name: "Cash", type: "asset" }, { id: "acct-bank", code: "1010", name: "Bank", type: "asset" },
    { id: "acct-debtors", code: "1200", name: "Sundry Debtors", type: "asset" }, { id: "acct-sales", code: "4000", name: "Sales", type: "income" },
    { id: "acct-output-cgst", code: "2101", name: "Output CGST", type: "liability" }, { id: "acct-output-sgst", code: "2102", name: "Output SGST", type: "liability" },
    { id: "acct-output-igst", code: "2103", name: "Output IGST", type: "liability" }, { id: "acct-output-cess", code: "2104", name: "Output Cess", type: "liability" },
    { id: "acct-inventory", code: "1300", name: "Inventory", type: "asset" }, { id: "acct-cogs", code: "5000", name: "Cost of Goods Sold", type: "expense" },
  ];
  const now = Timestamp.now(); const snaps = await Promise.all(defs.map(d => getDoc(doc(base, "accounts", d.id))));
  await Promise.all(defs.map((d, i) => snaps[i].exists() ? Promise.resolve() : setDoc(doc(base, "accounts", d.id), { id: d.id, businessId: input.businessId, code: d.code, name: d.name, type: d.type, parentId: null, systemAccount: true, active: true, openingDebit: 0, openingCredit: 0, createdAt: now.toDate().toISOString(), updatedAt: now.toDate().toISOString() })));
  const accounting = createFirestoreAccountingRepository(db, input.businessId);
  const transaction: TransactionDeps = { ids: { next: prefix => `${prefix}-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } };
  return createSale({ accounting, transaction }, {
    businessId: input.businessId, financialYearId: fy.id, date: input.date, userId: input.userId, customerId: input.customerId,
    taxableValue: money(input.taxableValueRupees), taxRate: input.taxRate, cessRate: input.cessRate, intraState: input.intraState,
    mode: input.mode === "Credit" ? "credit" : input.mode === "Cash" ? "cash" : "bank", totalCost: money(input.totalCostRupees), items: input.items,
    accountMap: { party: "acct-debtors", sales: "acct-sales", cash: "acct-cash", bank: "acct-bank", outputCgst: "acct-output-cgst", outputSgst: "acct-output-sgst", outputIgst: "acct-output-igst", outputCess: "acct-output-cess", inventory: "acct-inventory", cogs: "acct-cogs" },
  });
}
