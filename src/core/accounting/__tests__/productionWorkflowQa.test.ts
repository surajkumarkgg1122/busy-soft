import { describe, expect, it } from "vitest";
import { InMemoryAccountingRepository, fixedClock, testIds } from "../inMemoryRepository";
import { postSaleEntry } from "../saleEntry";
import { postPurchase, postExpenseEntry } from "../transactions";
import { cancelSalesDocument, cancelPurchaseDocument } from "../documentCancellation";
import { ValidationError } from "../errors";
import type { Account, FinancialYear, StockMovement } from "../types";

const BUSINESS = "biz-qa";
const OTHER_BUSINESS = "biz-other";
const USER = "qa-user";
const FY_ID = "fy-2026-27";
const DATE = "2026-08-30";
const NOW = "2026-08-30T12:00:00.000Z";

const fy: FinancialYear = {
  id: FY_ID,
  businessId: BUSINESS,
  name: "FY 2026-27",
  startDate: "2026-04-01",
  endDate: "2027-03-31",
  locked: false,
};

const account = (id: string, type: Account["type"], businessId = BUSINESS): Account => ({
  id,
  businessId,
  code: id,
  name: id,
  type,
  parentId: null,
  systemAccount: true,
  active: true,
  openingDebit: 0,
  openingCredit: 0,
  createdAt: NOW,
  updatedAt: NOW,
});

function seed(repo: InMemoryAccountingRepository) {
  repo.financialYears.set(FY_ID, fy);
  for (const [id, type] of [
    ["cash", "asset"], ["bank", "asset"], ["inventory", "asset"],
    ["sales", "income"], ["purchases", "expense"], ["cogs", "expense"],
    ["expense", "expense"], ["receivable", "asset"], ["payable", "liability"],
    ["out-cgst", "liability"], ["out-sgst", "liability"], ["out-igst", "liability"],
    ["out-cess", "liability"], ["in-cgst", "asset"], ["in-sgst", "asset"],
    ["in-igst", "asset"], ["in-cess", "asset"],
  ] as const) repo.accounts.set(id, account(id, type));

  repo.businessDocuments.set("parties/customer-1", {
    businessId: BUSINESS, kind: "customer", status: "active", ledgerAccountId: "receivable",
  });
  repo.businessDocuments.set("parties/supplier-1", {
    businessId: BUSINESS, kind: "supplier", status: "active", ledgerAccountId: "payable",
  });
}

const saleMap = {
  party: "receivable", sales: "sales", cash: "cash", bank: "bank",
  outputCgst: "out-cgst", outputSgst: "out-sgst", outputIgst: "out-igst", outputCess: "out-cess",
  inventory: "inventory", cogs: "cogs",
};

const purchaseMap = {
  party: "payable", purchases: "purchases", cash: "cash", bank: "bank",
  inputCgst: "in-cgst", inputSgst: "in-sgst", inputIgst: "in-igst", inputCess: "in-cess",
  inventory: "inventory", cogs: "cogs",
};

const deps = { ids: testIds("qa"), clock: fixedClock(NOW) };

function seedOpeningStock(repo: InMemoryAccountingRepository, quantity = 20, unitCost = 500) {
  const movement: StockMovement = {
    id: "opening-stock-1", businessId: BUSINESS, financialYearId: FY_ID, date: "2026-04-01",
    itemId: "item-1", direction: "in", quantity, unitCost, value: quantity * unitCost,
    sourceType: "opening", createdBy: USER, createdAt: NOW, warehouseId: "godown-1", sourceId: "opening-1",
  };
  repo.stockMovements.set(movement.id, movement);
}

function stockNet(repo: InMemoryAccountingRepository, itemId = "item-1") {
  return [...repo.stockMovements.values()]
    .filter((m) => m.businessId === BUSINESS && m.financialYearId === FY_ID && m.itemId === itemId)
    .reduce((n, m) => n + (m.direction === "in" ? m.quantity : -m.quantity), 0);
}

function expectBalanced(repo: InMemoryAccountingRepository) {
  const posted = [...repo.vouchers.values()].filter((v) => v.status === "posted");
  expect(posted.every((v) => v.totalDebit === v.totalCredit)).toBe(true);
  for (const voucher of posted) expect(voucher.totalDebit).toBe(voucher.totalCredit);
}

describe("BUSY SOFT production workflow QA", () => {
  it("Sale integrates invoice + inventory + accounting + party + GST + partial payment + outstanding", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedOpeningStock(repo);
    const result = await postSaleEntry(repo, {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, customerId: "customer-1",
      grossValue: 10000, taxRate: 18, intraState: true, paymentMode: "cash", paidAmount: 5000,
      accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 5, warehouseId: "godown-1" }],
      idempotencyKey: "qa-sale-partial-0001", documentId: "sale-1",
    }, deps);

    expect(result.voucher.voucherType).toBe("SALE");
    expect(result.voucher.totalDebit).toBe(result.voucher.totalCredit);
    expect(result.stockMovements).toHaveLength(1);
    expect(stockNet(repo)).toBe(15);
    expect([...repo.ledgerEntries.values()].some((l) => l.accountId === "out-cgst")).toBe(true);
    expect([...repo.ledgerEntries.values()].some((l) => l.accountId === "out-sgst")).toBe(true);
    const document = repo.businessDocuments.get("sales/sale-1");
    expect(document?.total).toBe(11800);
    expect(document?.paidAmount).toBe(5000);
    expect(document?.outstandingAmount).toBe(6800);
    expectBalanced(repo);
  });

  it("Sale duplicate/retry is atomic and does not create a second invoice or stock movement", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedOpeningStock(repo);
    const input = {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, customerId: "customer-1",
      grossValue: 10000, taxRate: 18, intraState: true, paymentMode: "cash" as const, paidAmount: 11800,
      accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 2, warehouseId: "godown-1" }],
      idempotencyKey: "qa-sale-retry-000001", documentId: "sale-retry-1",
    };
    await postSaleEntry(repo, input, deps);
    const before = { vouchers: repo.vouchers.size, movements: repo.stockMovements.size };
    await expect(postSaleEntry(repo, input, deps)).rejects.toThrow(/already been posted|already exists/);
    expect(repo.vouchers.size).toBe(before.vouchers);
    expect(repo.stockMovements.size).toBe(before.movements);
    expect(stockNet(repo)).toBe(18);
  });

  it("Sale rejects invalid party, inactive settlement, wrong FY and locked period", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedOpeningStock(repo);
    const base = {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, grossValue: 10000,
      taxRate: 18, intraState: true, paymentMode: "credit" as const, accountMap: saleMap,
      itemMovements: [{ itemId: "item-1", quantity: 1, warehouseId: "godown-1" }], idempotencyKey: "qa-sale-fail-000001",
    };
    await expect(postSaleEntry(repo, { ...base, customerId: "missing" }, deps)).rejects.toThrow(/does not exist/);
    repo.businessDocuments.set("parties/inactive", { businessId: BUSINESS, kind: "customer", status: "inactive", ledgerAccountId: "receivable" });
    await expect(postSaleEntry(repo, { ...base, customerId: "inactive", idempotencyKey: "qa-sale-fail-000002" }, deps)).rejects.toThrow(/inactive/);
    repo.accounts.get("cash")!.active = false;
    await expect(postSaleEntry(repo, { ...base, customerId: "customer-1", paymentMode: "cash", paidAmount: 11800, idempotencyKey: "qa-sale-fail-000003" }, deps)).rejects.toThrow(/inactive/);
    repo.accounts.get("cash")!.active = true;
    await expect(postSaleEntry(repo, { ...base, customerId: "customer-1", financialYearId: "wrong-fy", idempotencyKey: "qa-sale-fail-000004" }, deps)).rejects.toThrow(/financial year|Financial year/);
    repo.financialYears.set(FY_ID, { ...fy, locked: true });
    await expect(postSaleEntry(repo, { ...base, customerId: "customer-1", idempotencyKey: "qa-sale-fail-000005" }, deps)).rejects.toThrow(/locked/);
  });

  it("Purchase integrates inventory + accounting + supplier + GST + payment + outstanding", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo);
    const result = await postPurchase(repo, {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, supplierId: "supplier-1",
      taxableValue: 10000, grossValue: 10000, taxRate: 18, intraState: true, mode: "cash", paidAmount: 11800,
      supplierInvoiceNumber: "SUP-001", accountMap: purchaseMap,
      itemMovements: [{ itemId: "item-1", quantity: 20, unitCost: 500, warehouseId: "godown-1" }],
      idempotencyKey: "qa-purchase-000001", documentId: "purchase-1",
    }, deps);
    expect(result.voucher.voucherType).toBe("PURCHASE");
    expect(result.voucher.totalDebit).toBe(result.voucher.totalCredit);
    expect(result.stockMovements).toHaveLength(1);
    expect(stockNet(repo)).toBe(20);
    expect(repo.businessDocuments.get("purchaseSupplierInvoices/supplier-1:SUP-001")).toBeTruthy();
    const document = repo.businessDocuments.get("purchases/purchase-1");
    expect(document?.total).toBe(11800);
    expect(document?.paidAmount).toBe(11800);
    expect(document?.outstandingAmount).toBe(0);
    expect([...repo.ledgerEntries.values()].some((l) => l.accountId === "in-cgst")).toBe(true);
    expect([...repo.ledgerEntries.values()].some((l) => l.accountId === "in-sgst")).toBe(true);
    expectBalanced(repo);
  });

  it("Purchase rejects duplicate supplier invoice, insufficient stock cancellation and cross-business party", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo);
    const input = {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, supplierId: "supplier-1",
      taxableValue: 10000, grossValue: 10000, taxRate: 18, intraState: true, mode: "credit" as const,
      supplierInvoiceNumber: "SUP-002", accountMap: purchaseMap,
      itemMovements: [{ itemId: "item-1", quantity: 20, unitCost: 500, warehouseId: "godown-1" }],
      idempotencyKey: "qa-purchase-000002", documentId: "purchase-2",
    };
    await postPurchase(repo, input, deps);
    await expect(postPurchase(repo, { ...input, idempotencyKey: "qa-purchase-000003", documentId: "purchase-3" }, deps)).rejects.toThrow(/already recorded/);
    repo.businessDocuments.set("parties/foreign-supplier", { businessId: OTHER_BUSINESS, kind: "supplier", status: "active", ledgerAccountId: "payable" });
    await expect(postPurchase(repo, { ...input, supplierId: "foreign-supplier", supplierInvoiceNumber: "SUP-003", idempotencyKey: "qa-purchase-000004", documentId: "purchase-4" }, deps)).rejects.toThrow(/another business/);
    // Consume all purchased stock before cancellation; cancellation must refuse to manufacture negative stock.
    repo.stockMovements.set("later-sale", { id: "later-sale", businessId: BUSINESS, financialYearId: FY_ID, date: DATE, itemId: "item-1", warehouseId: "godown-1", direction: "out", quantity: 20, unitCost: 500, value: 10000, sourceType: "sale", createdBy: USER, createdAt: NOW, sourceId: "later" });
    await expect(cancelPurchaseDocument(repo, { businessId: BUSINESS, voucherId: (await repo.getVouchersByReference("purchase", "purchase-2"))[0].id, userId: USER, idempotencyKey: "qa-cancel-purchase-000001" }, deps)).rejects.toThrow(/only .* units available/);
  });

  it("Expense integrates expense account + cash/bank + accounting + P&L source", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo);
    const result = await postExpenseEntry(repo, {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE,
      expenseAccountId: "expense", amount: 2500, mode: "cash", cashAccountId: "cash",
      idempotencyKey: "qa-expense-000001", documentId: "expense-1", narration: "QA expense",
    }, deps);
    expect(result.voucher.voucherType).toBe("EXPENSE");
    expect(result.voucher.totalDebit).toBe(2500);
    expect(result.voucher.totalCredit).toBe(2500);
    expect(repo.businessDocuments.get("expenses/expense-1")?.amountMinor).toBe(2500);
    expect([...repo.ledgerEntries.values()].some((l) => l.accountId === "expense" && l.debit === 2500)).toBe(true);
    expect([...repo.ledgerEntries.values()].some((l) => l.accountId === "cash" && l.credit === 2500)).toBe(true);
    expect(repo.auditLogs.size).toBe(1);
  });

  it("Sale reversal restores stock and accounting state without deleting the original invoice", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedOpeningStock(repo);
    const sale = await postSaleEntry(repo, {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE,
      grossValue: 10000, taxRate: 18, intraState: true, paymentMode: "cash", paidAmount: 11800,
      accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 5, warehouseId: "godown-1" }],
      idempotencyKey: "qa-sale-reverse-000001", documentId: "sale-reverse-1",
    }, deps);
    expect(stockNet(repo)).toBe(15);
    const reversal = await cancelSalesDocument(repo, {
      businessId: BUSINESS, voucherId: sale.voucher.id, userId: USER, date: DATE,
      idempotencyKey: "qa-sale-reverse-000002",
    }, deps);
    expect(reversal.voucher.reversalOfVoucherId).toBe(sale.voucher.id);
    expect((await repo.getVoucher(sale.voucher.id))?.status).toBe("cancelled");
    expect(stockNet(repo)).toBe(20);
    expect(reversal.stockMovements).toHaveLength(1);
    expect(repo.businessDocuments.get("saleCancellations/sale-reverse-1")).toBeTruthy();
    expect([...repo.vouchers.values()].filter((v) => v.businessId === BUSINESS)).toHaveLength(2);
    expectBalanced(repo);
    await expect(cancelSalesDocument(repo, { businessId: BUSINESS, voucherId: sale.voucher.id, userId: USER, date: DATE, idempotencyKey: "qa-sale-reverse-000003" }, deps)).rejects.toThrow(/posted sale/);
  });

  it("Failure/rollback never leaves half a transaction after a forced downstream failure", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo);
    await expect(repo.runInTransaction(async (tx) => {
      await tx.saveBusinessDocument("sales", "rollback-sale", { businessId: BUSINESS, status: "draft" });
      await tx.saveAuditEvent({ id: "rollback-audit", businessId: BUSINESS, entityType: "sale", entityId: "rollback-sale", action: "CREATE", userId: USER, timestamp: NOW });
      throw new Error("simulated timeout after accounting preparation");
    })).rejects.toThrow("simulated timeout");
    expect(repo.businessDocuments.has("sales/rollback-sale")).toBe(false);
    expect(repo.auditLogs.has("rollback-audit")).toBe(false);
    expect(repo.vouchers.size).toBe(0);
  });

  it("concurrent submissions serialize numbering and never duplicate the accounting sequence", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo);
    const numbers = await Promise.all(Array.from({ length: 50 }, (_, i) => repo.runInTransaction((tx) => tx.allocateVoucherNumber({ businessId: BUSINESS, financialYearId: FY_ID, voucherType: "SALE", prefix: "SI" }))));
    expect(new Set(numbers).size).toBe(50);
    expect(numbers).toContain("SI-000001");
    expect(numbers).toContain("SI-000050");
  });

  it("rejects invalid tax and insufficient inventory before financial mutation", async () => {
    const repo = new InMemoryAccountingRepository(); seed(repo); seedOpeningStock(repo, 2, 500);
    const before = { vouchers: repo.vouchers.size, movements: repo.stockMovements.size };
    await expect(postSaleEntry(repo, {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, customerId: "customer-1",
      grossValue: 10000, taxRate: 101, intraState: true, paymentMode: "cash", paidAmount: 11800,
      accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 1, warehouseId: "godown-1" }],
      idempotencyKey: "qa-tax-invalid-000001", documentId: "bad-tax-1",
    }, deps)).rejects.toThrow(/tax rate|Tax rate|rate/);
    expect(repo.vouchers.size).toBe(before.vouchers);
    await expect(postSaleEntry(repo, {
      businessId: BUSINESS, financialYearId: FY_ID, userId: USER, date: DATE, customerId: "customer-1",
      grossValue: 10000, taxRate: 18, intraState: true, paymentMode: "cash", paidAmount: 11800,
      accountMap: saleMap, itemMovements: [{ itemId: "item-1", quantity: 3, warehouseId: "godown-1" }],
      idempotencyKey: "qa-stock-invalid-000001", documentId: "bad-stock-1",
    }, deps)).rejects.toThrow();
    expect(repo.vouchers.size).toBe(before.vouchers);
    expect(repo.stockMovements.size).toBe(before.movements);
  });
});

void ValidationError;
