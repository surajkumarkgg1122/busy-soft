import { describe, expect, it } from "vitest";
import { InMemoryAccountingRepository, fixedClock, testIds } from "../inMemoryRepository";
import { postSaleEntry } from "../saleEntry";
import { postPurchase } from "../transactions";
import { postExpenseEntry } from "../expenseEntry";
import { cancelSalesDocument, cancelPurchaseDocument } from "../documentCancellation";
import type { Account, FinancialYear, StockMovement } from "../types";

const BUSINESS = "biz-qa"; const USER = "qa-user"; const FY_ID = "fy-2026-27"; const DATE = "2026-08-30"; const NOW = "2026-08-30T12:00:00.000Z";
const fy: FinancialYear = { id: FY_ID, businessId: BUSINESS, name: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", locked: false };
const account = (id: string, type: Account["type"]): Account => ({ id, businessId: BUSINESS, code: id, name: id, type, parentId: null, systemAccount: true, active: true, openingDebit: 0, openingCredit: 0, createdAt: NOW, updatedAt: NOW });
const deps = { ids: testIds("qa"), clock: fixedClock(NOW) };

function seed(repo: InMemoryAccountingRepository) {
  repo.financialYears.set(FY_ID, fy);
  for (const [id, type] of [["cash", "asset"], ["bank", "asset"], ["inventory", "asset"], ["sales", "income"], ["cogs", "expense"], ["expense", "expense"], ["receivable", "asset"], ["payable", "liability"], ["out-cgst", "liability"], ["out-sgst", "liability"], ["out-igst", "liability"], ["out-cess", "liability"], ["in-cgst", "asset"], ["in-sgst", "asset"], ["in-igst", "asset"], ["in-cess", "asset"]] as const) repo.accounts.set(id, account(id, type));
  repo.businessDocuments.set("parties/customer-1", { businessId: BUSINESS, kind: "customer", status: "active", ledgerAccountId: "receivable" });
  repo.businessDocuments.set("parties/supplier-1", { businessId: BUSINESS, kind: "supplier", status: "active", ledgerAccountId: "payable" });
}
function seedStock(repo: InMemoryAccountingRepository, quantity = 20) { repo.stockMovements.set("opening-1", { id: "opening-1", businessId: BUSINESS, financialYearId: FY_ID, date: "2026-04-01", itemId: "item-1", warehouseId: "godown-1", direction: "in", quantity, unitCost: 500, value: quantity * 500, sourceType: "opening", createdBy: USER, createdAt: NOW, sourceId: "opening-1" }); }
function stockNet(repo: InMemoryAccountingRepository) { return [...repo.stockMovements.values()].filter(m => m.businessId === BUSINESS && m.financialYearId === FY_ID && m.itemId === "item-1").reduce((n, m) => n + (m.direction === "in" ? m.quantity : -m.quantity), 0); }
function expectBalanced(repo: InMemoryAccountingRepository) { for (const v of repo.vouchers.values()) expect(v.totalDebit).toBe(v.totalCredit); }
const saleMap = { party: "receivable", sales: "sales", cash: "cash", bank: "bank", outputCgst: "out-cgst", outputSgst: "out-sgst", outputIgst: "out-igst", outputCess: "out-cess", inventory: "inventory", cogs: "cogs" };
const purchaseMap = { party: "payable", cash: "cash", bank: "bank", inputCgst: "in-cgst", inputSgst: "in-sgst", inputIgst: "in-igst", inputCess: "in-cess", inventory: "inventory", cogs: "cogs" };

describe("BUSY SOFT production workflow QA", () => {
  it("Sale integrates invoice, stock, accounting, party, GST, payment and outstanding", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedStock(repo);
    const r = await postSaleEntry(repo, { businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, customerId: "customer-1", grossValue: 10000, taxRate: 18, intraState: true, paymentMode: "cash", paidAmount: 5000, accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 5, warehouseId: "godown-1" }], idempotencyKey: "qa-sale-partial-000001", documentId: "sale-1" }, deps);
    expect(r.voucher.voucherType).toBe("SALE"); expect(r.voucher.totalDebit).toBe(r.voucher.totalCredit); expect(stockNet(repo)).toBe(15); const d = repo.businessDocuments.get("sales/sale-1")!; expect(d.total).toBe(11800); expect(d.paidAmount).toBe(5000); expect(d.outstandingAmount).toBe(6800); expect([...repo.ledgerEntries.values()].some(x => x.accountId === "out-cgst")).toBe(true); expect([...repo.ledgerEntries.values()].some(x => x.accountId === "out-sgst")).toBe(true); expectBalanced(repo);
  });
  it("Sale retry/duplicate click creates no second invoice or stock movement", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedStock(repo); const input = { businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, customerId: "customer-1", grossValue: 10000, taxRate: 18, intraState: true, paymentMode: "cash" as const, paidAmount: 11800, accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 2, warehouseId: "godown-1" }], idempotencyKey: "qa-sale-retry-000001", documentId: "sale-retry-1" };
    await postSaleEntry(repo, input, deps); const before = { v: repo.vouchers.size, m: repo.stockMovements.size }; await expect(postSaleEntry(repo, input, deps)).rejects.toThrow(/already been posted|already exists/); expect(repo.vouchers.size).toBe(before.v); expect(repo.stockMovements.size).toBe(before.m); expect(stockNet(repo)).toBe(18);
  });
  it("Sale rejects invalid party, inactive account, wrong FY, locked period and insufficient stock", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedStock(repo, 2); const base = { businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, customerId: "customer-1", grossValue: 10000, taxRate: 18, intraState: true, paymentMode: "cash" as const, paidAmount: 11800, accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 1, warehouseId: "godown-1" }], idempotencyKey: "qa-sale-fail-000001", documentId: "sale-fail-1" };
    await expect(postSaleEntry(repo, { ...base, customerId: "missing" }, deps)).rejects.toThrow(/does not exist/); repo.accounts.get("cash")!.active = false; await expect(postSaleEntry(repo, { ...base, idempotencyKey: "qa-sale-fail-000002" }, deps)).rejects.toThrow(/inactive/); repo.accounts.get("cash")!.active = true; await expect(postSaleEntry(repo, { ...base, financialYearId: "wrong-fy", idempotencyKey: "qa-sale-fail-000003" }, deps)).rejects.toThrow(/financial year|Financial year/); repo.financialYears.set(FY_ID, { ...fy, locked: true }); await expect(postSaleEntry(repo, { ...base, idempotencyKey: "qa-sale-fail-000004" }, deps)).rejects.toThrow(/locked/); repo.financialYears.set(FY_ID, fy); const before = repo.vouchers.size; await expect(postSaleEntry(repo, { ...base, idempotencyKey: "qa-sale-fail-000005", itemMovements: [{ itemId: "item-1", quantity: 3, warehouseId: "godown-1" }] }, deps)).rejects.toThrow(); expect(repo.vouchers.size).toBe(before);
  });
  it("Purchase integrates stock, accounting, supplier, GST, payment and outstanding", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); const r = await postPurchase(repo, { businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, supplierId: "supplier-1", taxableValue: 10000, grossValue: 10000, taxRate: 18, intraState: true, mode: "cash", paidAmount: 11800, supplierInvoiceNumber: "SUP-001", accountMap: purchaseMap, itemMovements: [{ itemId: "item-1", quantity: 20, unitCost: 500, warehouseId: "godown-1" }], idempotencyKey: "qa-purchase-000001", documentId: "purchase-1" }, deps);
    expect(r.voucher.voucherType).toBe("PURCHASE"); expect(r.voucher.totalDebit).toBe(r.voucher.totalCredit); expect(stockNet(repo)).toBe(20); expect(repo.businessDocuments.get("purchaseSupplierInvoices/supplier-1:SUP-001")).toBeTruthy(); expect(repo.businessDocuments.get("purchases/purchase-1")?.outstandingAmount).toBe(0); expect([...repo.ledgerEntries.values()].some(x => x.accountId === "in-cgst")).toBe(true); expectBalanced(repo); await expect(postPurchase(repo, { ...({} as typeof r), idempotencyKey: "qa-purchase-000002", documentId: "bad" } as never, deps)).rejects.toThrow();
  });
  it("Purchase cancellation refuses to create negative stock after later consumption", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); const p = await postPurchase(repo, { businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, supplierId: "supplier-1", taxableValue: 10000, grossValue: 10000, taxRate: 18, intraState: true, mode: "credit", supplierInvoiceNumber: "SUP-002", accountMap: purchaseMap, itemMovements: [{ itemId: "item-1", quantity: 20, unitCost: 500, warehouseId: "godown-1" }], idempotencyKey: "qa-purchase-000003", documentId: "purchase-2" }, deps);
    repo.stockMovements.set("later-out", { id: "later-out", businessId: BUSINESS, financialYearId: FY_ID, date: DATE, itemId: "item-1", warehouseId: "godown-1", direction: "out", quantity: 20, unitCost: 500, value: 10000, sourceType: "sale", createdBy: USER, createdAt: NOW, sourceId: "later-sale" });
    await expect(cancelPurchaseDocument(repo, { businessId: BUSINESS, voucherId: p.voucher.id, userId: USER, idempotencyKey: "qa-purchase-cancel-0001" }, deps)).rejects.toThrow(/only .* units available/);
  });
  it("Expense posts cash settlement and a P&L expense ledger line", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); const r = await postExpenseEntry(repo, { businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, expenseAccountId: "expense", amount: 2500, mode: "cash", cashAccountId: "cash", idempotencyKey: "qa-expense-000001", documentId: "expense-1" }, deps);
    expect(r.voucher.totalDebit).toBe(2500); expect(r.voucher.totalCredit).toBe(2500); expect([...repo.ledgerEntries.values()].some(x => x.accountId === "expense" && x.debit === 2500)).toBe(true); expect([...repo.ledgerEntries.values()].some(x => x.accountId === "cash" && x.credit === 2500)).toBe(true); expect(repo.auditLogs.size).toBe(1);
  });
  it("Sale reversal restores stock and preserves the original posted invoice as cancelled history", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedStock(repo); const sale = await postSaleEntry(repo, { businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, grossValue: 10000, taxRate: 18, intraState: true, paymentMode: "cash", paidAmount: 11800, accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 5, warehouseId: "godown-1" }], idempotencyKey: "qa-sale-reverse-000001", documentId: "sale-reverse-1" }, deps);
    await cancelSalesDocument(repo, { businessId: BUSINESS, voucherId: sale.voucher.id, userId: USER, date: DATE, idempotencyKey: "qa-sale-reverse-000002" }, deps); expect((await repo.getVoucher(sale.voucher.id))?.status).toBe("cancelled"); expect(stockNet(repo)).toBe(20); expect(repo.vouchers.size).toBe(2); expect(repo.businessDocuments.has("saleCancellations/sale-reverse-1")).toBe(true); expectBalanced(repo); await expect(cancelSalesDocument(repo, { businessId: BUSINESS, voucherId: sale.voucher.id, userId: USER, idempotencyKey: "qa-sale-reverse-000003" }, deps)).rejects.toThrow(/posted sale/);
  });
  it("Concurrent sequence allocation is unique and transaction rollback leaves no partial state", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); const numbers = await Promise.all(Array.from({ length: 50 }, () => repo.runInTransaction(tx => tx.allocateVoucherNumber({ businessId: BUSINESS, financialYearId: FY_ID, voucherType: "SALE", prefix: "SI" })))); expect(new Set(numbers).size).toBe(50); expect(numbers).toContain("SI-000001"); expect(numbers).toContain("SI-000050");
    await expect(repo.runInTransaction(async tx => { await tx.saveBusinessDocument("sales", "rollback", { businessId: BUSINESS }); await tx.saveAuditEvent({ id: "rollback-audit", businessId: BUSINESS, entityType: "sale", entityId: "rollback", action: "CREATE", userId: USER, timestamp: NOW }); throw new Error("simulated timeout"); })).rejects.toThrow("simulated timeout"); expect(repo.businessDocuments.has("sales/rollback")).toBe(false); expect(repo.auditLogs.has("rollback-audit")).toBe(false);
  });
});
