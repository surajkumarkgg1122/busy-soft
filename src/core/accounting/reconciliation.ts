import type { Account, LedgerEntry, Money } from "./types";
import { ValidationError } from "./errors";
import { buildBalanceSheet, buildProfitLoss, buildTrialBalance } from "./reports";

export interface ReconciliationResult { trialBalanceDifference: Money; balanceSheetDifference: Money; balanced: boolean; }
export function reconcile(accounts: readonly Account[], entries: readonly LedgerEntry[]): ReconciliationResult {
  const tb=buildTrialBalance(accounts,entries); const pl=buildProfitLoss(accounts,entries); const bs=buildBalanceSheet(accounts,entries);
  const trialBalanceDifference=tb.totalDebit-tb.totalCredit;
  const balanceSheetDifference=bs.difference;
  if (!Number.isSafeInteger(trialBalanceDifference) || !Number.isSafeInteger(balanceSheetDifference)) throw new ValidationError("Reconciliation exceeds safe integer range.");
  return {trialBalanceDifference,balanceSheetDifference,balanced:trialBalanceDifference===0&&balanceSheetDifference===0};
}
