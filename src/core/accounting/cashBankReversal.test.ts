import { describe, expect, it } from "vitest";
import { InMemoryAccountingRepository, fixedClock, testIds } from "./inMemoryRepository";
import { postCashBankEntry, postCashBankTransfer } from "./cashBank";
import { reversePostedVoucher } from "./voucherReversal";

function setup() {
  const repo = new InMemoryAccountingRepository();
  const clock = fixedClock("2026-09-01T12:00:00.000Z");
  const ids = testIds("reverse");
  const businessId = "biz-1", financialYearId = "fy-2026-27";
  repo.financialYears.set(financialYearId, { id: financialYearId, businessId, name: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", locked: false });
  for (const [id, type] of [["acct-bank", "asset"], ["acct-opening-balance", "equity"], ["bank-a", "asset"], ["bank-b", "asset"], ["expense", "expense"]] as const) {
    repo.accounts.set(id, { id, businessId, code: id, name: id, type, parentId: null, systemAccount: id.startsWith("acct-"), active: true, openingDebit: 0, openingCredit: 0, createdAt: clock.now(), updatedAt: clock.now() });
  }
  repo.businessDocuments.set("bankAccounts/bank-a", { accountId: "bank-a", businessId, displayName: "Bank A", kind: "bank", ledgerAccountId: "bank-a", status: "active", openingBalance: 100000, currentBalance: 100000 });
  repo.businessDocuments.set("bankAccounts/bank-b", { accountId: "bank-b", businessId, displayName: "Bank B", kind: "bank", ledgerAccountId: "bank-b", status: "active", openingBalance: 50000, currentBalance: 50000 });
  return { repo, clock, ids, businessId, financialYearId };
}

const deps = (s: ReturnType<typeof setup>) => ({ ids: s.ids, clock: s.clock });

describe("cash bank reversal hardening", () => {
  it("is idempotent on retry and restores the persisted entry balance", async () => {
    const s = setup();
    const posted = await postCashBankEntry(s.repo, { businessId: s.businessId, financialYearId: s.financialYearId, date: "2026-09-01", userId: "u1", idempotencyKey: "original-entry-123456", accountId: "bank-a", ledgerAccountId: "bank-a", type: "deposit", amount: 10000, contraAccountId: "expense" }, deps(s));
    expect(s.repo.businessDocuments.get("bankAccounts/bank-a")?.currentBalance).toBe(110000);

    const first = await reversePostedVoucher(s.repo, { businessId: s.businessId, financialYearId: s.financialYearId, voucherId: posted.voucher.id, userId: "u2", idempotencyKey: "reversal-entry-123456", date: "2026-09-02" }, deps(s));
    const second = await reversePostedVoucher(s.repo, { businessId: s.businessId, financialYearId: s.financialYearId, voucherId: posted.voucher.id, userId: "u2", idempotencyKey: "reversal-entry-123456", date: "2026-09-02" }, deps(s));

    expect(second.voucher.id).toBe(first.voucher.id);
    expect(s.repo.businessDocuments.get("bankAccounts/bank-a")?.currentBalance).toBe(100000);
    expect(s.repo.vouchers.get(posted.voucher.id)?.status).toBe("cancelled");
  });

  it("restores both balances after reversing a cash/bank transfer", async () => {
    const s = setup();
    const posted = await postCashBankTransfer(s.repo, { businessId: s.businessId, financialYearId: s.financialYearId, date: "2026-09-01", userId: "u1", idempotencyKey: "original-transfer-123456", fromAccountId: "bank-a", fromLedgerAccountId: "bank-a", toAccountId: "bank-b", toLedgerAccountId: "bank-b", amount: 2500 }, deps(s));
    expect(s.repo.businessDocuments.get("bankAccounts/bank-a")?.currentBalance).toBe(97500);
    expect(s.repo.businessDocuments.get("bankAccounts/bank-b")?.currentBalance).toBe(52500);

    await reversePostedVoucher(s.repo, { businessId: s.businessId, financialYearId: s.financialYearId, voucherId: posted.voucher.id, userId: "u2", idempotencyKey: "reversal-transfer-123456", date: "2026-09-02" }, deps(s));

    expect(s.repo.businessDocuments.get("bankAccounts/bank-a")?.currentBalance).toBe(100000);
    expect(s.repo.businessDocuments.get("bankAccounts/bank-b")?.currentBalance).toBe(50000);
  });
});
