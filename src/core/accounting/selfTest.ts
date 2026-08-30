import { calculatePartyBalance, calculateAccountBalance, validateVoucherLines } from "./ledger";
import { calculateTax } from "./gst";
import { calculateStockBalance } from "./inventory";
import { InMemoryAccountingRepository, fixedClock, testIds } from "./inMemoryRepository";
import { postJournal } from "./transactions";
import type { Account, FinancialYear } from "./types";

export async function runAccountingCoreSelfTest(): Promise<void> {
  const repo = new InMemoryAccountingRepository();
  const now = fixedClock();
  const ids = testIds("core");
  const deps = { ids, clock: now };
  const fy: FinancialYear = { id: "fy-2026", businessId: "biz-1", name: "FY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", locked: false };
  repo.financialYears.set(fy.id, fy);
  const accounts: Account[] = [
    { id: "cash", businessId: "biz-1", code: "1000", name: "Cash", type: "asset", systemAccount: true, active: true, openingDebit: 0, openingCredit: 0, createdAt: now.now(), updatedAt: now.now() },
    { id: "sales", businessId: "biz-1", code: "4000", name: "Sales", type: "income", systemAccount: true, active: true, openingDebit: 0, openingCredit: 0, createdAt: now.now(), updatedAt: now.now() },
  ];
  accounts.forEach(a => repo.accounts.set(a.id, a));

  const result = await postJournal(repo, { businessId: "biz-1", financialYearId: "fy-2026", date: "2026-08-30", userId: "user-1", narration: "Self test" }, [
    { accountId: "cash", debit: 11800, credit: 0 },
    { accountId: "sales", debit: 0, credit: 11800 },
  ], deps);
  if (result.voucher.totalDebit !== 11800 || result.voucher.totalCredit !== 11800) throw new Error("Voucher balance invariant failed.");
  validateVoucherLines(result.lines);
  if (calculatePartyBalance(result.ledgerEntries, "missing").net !== 0) throw new Error("Party balance invariant failed.");
  if (calculateAccountBalance(accounts[0], result.ledgerEntries.filter(e => e.accountId === "cash")) !== 11800) throw new Error("Account balance invariant failed.");
  if (calculateStockBalance([{ direction: "in", quantity: 10 }, { direction: "out", quantity: 3 }]) !== 7) throw new Error("Stock invariant failed.");
  const tax = calculateTax({ taxableValue: 10000, rate: 18, intraState: true });
  if (tax.cgst !== 900 || tax.sgst !== 900 || tax.total !== 11800) throw new Error("GST invariant failed.");
}
