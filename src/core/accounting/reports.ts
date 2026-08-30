import type { Account, LedgerEntry, Money } from "./types";
import { accountNormalBalance, calculateAccountBalance } from "./ledger";

export interface TrialBalanceRow { accountId: string; code: string; name: string; debit: Money; credit: Money; balance: Money; }
export interface TrialBalance { rows: TrialBalanceRow[]; totalDebit: Money; totalCredit: Money; }
export interface ProfitLoss { income: Money; expense: Money; profit: Money; }
export interface BalanceSheet { assets: Money; liabilities: Money; equity: Money; currentProfit: Money; totalLiabilitiesAndEquity: Money; difference: Money; }
export interface PartyStatementLine { date: string; voucherType: string; voucherNumber: string; description?: string; debit: Money; credit: Money; runningBalance: Money; voucherId: string; }

function entriesFor(entries: readonly LedgerEntry[], accountId: string): LedgerEntry[] { return entries.filter(e => e.accountId === accountId); }

export function buildTrialBalance(accounts: readonly Account[], entries: readonly LedgerEntry[]): TrialBalance {
  const rows = accounts.filter(a => a.active).map(account => {
    const own = entriesFor(entries, account.id);
    const debit = account.openingDebit + own.reduce((s, e) => s + e.debit, 0);
    const credit = account.openingCredit + own.reduce((s, e) => s + e.credit, 0);
    const balance = accountNormalBalance(account.type) === "debit" ? debit - credit : credit - debit;
    return { accountId: account.id, code: account.code, name: account.name, debit: Math.max(balance, 0), credit: Math.max(-balance, 0), balance };
  });
  return { rows, totalDebit: rows.reduce((s, r) => s + r.debit, 0), totalCredit: rows.reduce((s, r) => s + r.credit, 0) };
}

export function buildProfitLoss(accounts: readonly Account[], entries: readonly LedgerEntry[]): ProfitLoss {
  let income = 0;
  let expense = 0;
  for (const account of accounts) {
    if (account.type !== "income" && account.type !== "expense") continue;
    const balance = calculateAccountBalance(account, entriesFor(entries, account.id));
    if (account.type === "income") income += balance;
    else expense += balance;
  }
  return { income, expense, profit: income - expense };
}

export function buildBalanceSheet(accounts: readonly Account[], entries: readonly LedgerEntry[]): BalanceSheet {
  let assets = 0;
  let liabilities = 0;
  let equity = 0;
  for (const account of accounts) {
    const balance = calculateAccountBalance(account, entriesFor(entries, account.id));
    if (account.type === "asset") assets += balance;
    else if (account.type === "liability") liabilities += balance;
    else if (account.type === "equity") equity += balance;
  }
  const currentProfit = buildProfitLoss(accounts, entries).profit;
  const totalLiabilitiesAndEquity = liabilities + equity + currentProfit;
  return { assets, liabilities, equity, currentProfit, totalLiabilitiesAndEquity, difference: assets - totalLiabilitiesAndEquity };
}

/** Opening is calculated only from ledger entries before `fromDate`; it never uses a mutable party.balance field. */
export function buildPartyStatement(entries: readonly LedgerEntry[], partyId: string, fromDate: string, toDate: string): { opening: Money; lines: PartyStatementLine[]; closing: Money } {
  const partyEntries = entries.filter(e => e.partyId === partyId).sort((a, b) => `${a.date}:${a.lineNo}`.localeCompare(`${b.date}:${b.lineNo}`));
  const opening = partyEntries.filter(e => e.date < fromDate).reduce((s, e) => s + e.debit - e.credit, 0);
  let running = opening;
  const lines = partyEntries.filter(e => e.date >= fromDate && e.date <= toDate).map(e => {
    running += e.debit - e.credit;
    return { date: e.date, voucherType: e.voucherType, voucherNumber: e.voucherNumber, description: e.description, debit: e.debit, credit: e.credit, runningBalance: running, voucherId: e.voucherId };
  });
  return { opening, lines, closing: running };
}
