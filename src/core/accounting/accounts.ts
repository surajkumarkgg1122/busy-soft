import type { Account, AccountType } from "./types";
import { ValidationError } from "./errors";

export function validateAccount(account: Account): void {
  if (!account.id || !account.businessId || !account.code || !account.name) throw new ValidationError("Account requires id, business, code and name.");
  if (!Number.isSafeInteger(account.openingDebit) || account.openingDebit < 0 || !Number.isSafeInteger(account.openingCredit) || account.openingCredit < 0) throw new ValidationError("Opening balances must be non-negative integer minor units.");
  if (account.openingDebit > 0 && account.openingCredit > 0) throw new ValidationError("An account cannot have both opening debit and credit.");
}

export function validateChartOfAccounts(accounts: readonly Account[], businessId: string): void {
  const codes = new Set<string>();
  const ids = new Set<string>();
  for (const account of accounts) {
    validateAccount(account);
    if (account.businessId !== businessId) throw new ValidationError("Chart contains an account from another business.");
    if (ids.has(account.id)) throw new ValidationError(`Duplicate account id: ${account.id}`);
    if (codes.has(account.code)) throw new ValidationError(`Duplicate account code: ${account.code}`);
    ids.add(account.id); codes.add(account.code);
    if (account.parentId && account.parentId === account.id) throw new ValidationError(`Account cannot be its own parent: ${account.name}`);
  }
  for (const account of accounts) if (account.parentId && !ids.has(account.parentId)) throw new ValidationError(`Parent account not found: ${account.parentId}`);
}

export function accountTypeNormalBalance(type: AccountType): "debit" | "credit" { return type === "asset" || type === "expense" ? "debit" : "credit"; }
