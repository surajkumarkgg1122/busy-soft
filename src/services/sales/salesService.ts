import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { SalePostingInput, TransactionDeps } from "../../core/accounting/transactions";
import type { AccountingPermission } from "../../core/accounting/authorization";
import type { AccountingRepository, Money, PostingResult, Account } from "../../core/accounting/types";
import { createFirestoreAccountingRepository } from "../../core/accounting/firestoreRepository";
import { createStockMovement } from "../../core/accounting/inventory";
import { reverseVoucher } from "../../core/accounting/voucher";
import { ValidationError } from "../../core/accounting/errors";

export interface SalesServiceDeps { accounting: AccountingRepository; transaction: TransactionDeps; }
export interface SaleItemCommand { itemId: string; quantity: number; unitCost?: Money; warehouseId?: string; }
export interface CreateSaleCommand { businessId: string; financialYearId: string; date: string; userId: string; customerId?: string; taxableValue: Money; taxRate: number; cessRate?: number; intraState: boolean; mode: "credit" | "cash" | "bank"; totalCost?: Money; accountMap: SalePostingInput["accountMap"]; items: SaleItemCommand[]; narration?: string; idempotencyKey: string; documentId?: string; documentPayload?: Record<string, unknown>; permissions: AccountingPermission[]; [key:string]: unknown; }

const money = (rupees: number): Money => { const value = Math.round((Number(rupees) || 0) * 100); if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError("Invalid money value."); return value; };

/** Browser entry point: all accounting mutations go through the trusted API. */
export async function postSalesInvoiceFromUi(input: {
  businessId: string; date: string; customerId?: string; grossValueRupees: number; discountPercent?: number; discountAmountRupees?: number;
  taxRate: number; cessRate?: number; intraState: boolean; mode: "Credit" | "Cash" | "Bank" | "UPI" | "Card"; paidAmountRupees?: number;
  bankAccountId?: string; items: SaleItemCommand[]; narration?: string; idempotencyKey?: string; documentId?: string; invoiceNumber?: string; documentPayload?: Record<string, unknown>;
}): Promise<PostingResult> {
  if (input.mode === "Card") throw new ValidationError("Card settlement is not yet mapped. Use Cash, Bank, UPI or Credit.");
  if (typeof window === "undefined") throw new ValidationError("Sales posting must be initiated from the application client.");
  const { getAuth } = await import("firebase/auth");
  const { getApps, getApp } = await import("firebase/app");
  if (!getApps().length) throw new ValidationError("Firebase client is not initialized.");
  const user = getAuth(getApp()).currentUser;
  if (!user) throw new ValidationError("Please sign in again before posting the sale.");
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch("/api/accounting/sales", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({
      businessId: input.businessId, date: input.date, customerId: input.customerId, grossValue: money(input.grossValueRupees), discountPercent: Number(input.discountPercent ?? 0),
      discountAmount: money(input.discountAmountRupees ?? 0), taxRate: input.taxRate, cessRate: input.cessRate ?? 0, intraState: input.intraState,
      paymentMode: input.mode === "Credit" ? "credit" : input.mode === "Cash" ? "cash" : "bank", paidAmount: money(input.paidAmountRupees ?? 0),
      bankAccountId: input.bankAccountId, itemMovements: input.items, narration: input.narration, idempotencyKey: input.idempotencyKey ?? `sale-ui-${crypto.randomUUID()}`,
      documentId: input.documentId, documentPayload: { ...(input.documentPayload ?? {}), invoiceNumber: input.invoiceNumber ?? null },
    }) });
  } catch (e) { throw new ValidationError(e instanceof Error ? `Sales API network error: ${e.message}` : "Sales API network error. Check that the Next.js server is running."); }
  let payload: any = null; try { payload = await response.json(); } catch { /* handled below */ }
  if (!response.ok || !payload?.success) throw new ValidationError(typeof payload?.error === "string" ? payload.error : `Sales API failed (${response.status}).`);
  return (payload.result?.value ?? payload.result) as PostingResult;
}

/** Compatibility entry point used by the current Sales page. In the browser it is API-backed; trusted server callers retain Core access. */
export async function createSale(deps: SalesServiceDeps, command: CreateSaleCommand): Promise<PostingResult> {
  if (!command.businessId || !command.financialYearId) throw new ValidationError("Business and financial year are required.");
  if (!command.idempotencyKey) throw new ValidationError("Idempotency key is required.");
  if (command.mode === "credit" && !command.customerId) throw new ValidationError("Customer is required for a credit sale.");
  if (!command.items.length) throw new ValidationError("At least one sale item is required.");

  if (typeof window !== "undefined") {
    const p = command as CreateSaleCommand & { grossValue?: number; discountPercent?: number; discountAmount?: number; paidAmount?: number; bankAccountId?: string };
    const result = await postSalesInvoiceFromUi({
      businessId: command.businessId, date: command.date, customerId: command.customerId, grossValueRupees: Number(p.grossValue ?? command.taxableValue) / 100,
      discountPercent: Number(p.discountPercent ?? 0), discountAmountRupees: Number(p.discountAmount ?? 0) / 100, taxRate: command.taxRate, cessRate: command.cessRate,
      intraState: command.intraState, mode: command.mode === "credit" ? "Credit" : command.mode === "cash" ? "Cash" : "Bank", paidAmountRupees: Number(p.paidAmount ?? 0) / 100,
      bankAccountId: p.bankAccountId, items: command.items, narration: command.narration, idempotencyKey: command.idempotencyKey, documentId: command.documentId,
      invoiceNumber: typeof command.documentPayload?.invoiceNumber === "string" ? command.documentPayload.invoiceNumber : undefined, documentPayload: command.documentPayload,
    });
    return result;
  }

  const { executeSale } = await import("../../application/core");
  const result = await executeSale(deps, { businessId:command.businessId, userId:command.userId, financialYearId:command.financialYearId, idempotencyKey:command.idempotencyKey, permissions:command.permissions }, command);
  return result.value as PostingResult;
}

const fyFor = (date: string) => { const y = Number(date.slice(0, 4)); const m = Number(date.slice(5, 7)); const start = m >= 4 ? y : y - 1; return { id: `fy-${start}-${String(start + 1).slice(-2)}`, name: `FY ${start}-${String(start + 1).slice(-2)}`, startDate: `${start}-04-01`, endDate: `${start + 1}-03-31` }; };
const salesAccounts: Array<{ id: string; code: string; name: string; type: Account["type"] }> = [ { id: "acct-cash", code: "1000", name: "Cash", type: "asset" }, { id: "acct-bank", code: "1010", name: "Bank", type: "asset" }, { id: "acct-debtors", code: "1200", name: "Sundry Debtors", type: "asset" }, { id: "acct-sales", code: "4000", name: "Sales", type: "income" }, { id: "acct-output-cgst", code: "2101", name: "Output CGST", type: "liability" }, { id: "acct-output-sgst", code: "2102", name: "Output SGST", type: "liability" }, { id: "acct-output-igst", code: "2103", name: "Output IGST", type: "liability" }, { id: "acct-output-cess", code: "2104", name: "Output Cess", type: "liability" }, { id: "acct-inventory", code: "1300", name: "Inventory", type: "asset" }, { id: "acct-cogs", code: "5000", name: "Cost of Goods Sold", type: "expense" } ];
async function ensureSalesSetup(db: Firestore, businessId: string, date: string) { const base = doc(db, "businesses", businessId); const fy = fyFor(date); const fyRef = doc(base, "financialYears", fy.id); if (!(await getDoc(fyRef)).exists()) await setDoc(fyRef, { id: fy.id, businessId, ...fy, locked: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now() }); const now = Timestamp.now(); await Promise.all(salesAccounts.map(async a => { const r = doc(base, "accounts", a.id); if (!(await getDoc(r)).exists()) await setDoc(r, { id: a.id, businessId, ...a, parentId: null, systemAccount: true, active: true, openingDebit: 0, openingCredit: 0, createdAt: now.toDate().toISOString(), updatedAt: now.toDate().toISOString() }); })); return fy.id; }

export async function cancelSalesInvoiceFromUi(db: Firestore, input: { businessId: string; userId: string; saleId: string; accountingVoucherId: string; date: string }): Promise<PostingResult> { const accounting = createFirestoreAccountingRepository(db, input.businessId); const deps: TransactionDeps = { ids: { next: p => `${p}-${crypto.randomUUID()}` }, clock: { now: () => `${input.date}T23:59:59.000Z` } }; return accounting.runInTransaction(async tx => { const original=await tx.getStockMovementsForSource(input.accountingVoucherId); const result=await reverseVoucher(tx,input.accountingVoucherId,input.userId,deps); const movements=original.map(m=>createStockMovement({businessId:input.businessId,financialYearId:result.voucher.financialYearId,date:input.date,itemId:m.itemId,warehouseId:m.warehouseId,direction:m.direction==="out"?"in":"out",quantity:m.quantity,unitCost:m.unitCost,value:m.value,sourceType:"sale_cancel",sourceId:input.saleId,createdBy:input.userId},deps.ids,deps.clock.now())); if(movements.length)await tx.saveStockMovements(movements); return {...result,stockMovements:movements}; }); }
