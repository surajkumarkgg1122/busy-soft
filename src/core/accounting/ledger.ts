import type { Account, LedgerEntry, Money, PartyBalance, VoucherLine } from "./types";
import { ValidationError } from "./errors";

export function sumDebit(lines: readonly { debit: Money }[]): Money {
  return lines.reduce((sum, line) => sum + line.debit, 0);
}

export function sumCredit(lines: readonly { credit: Money }[]): Money {
  return lines.reduce((sum, line) => sum + line.credit, 0);
}

export function assertBalanced(lines: readonly { debit: Money; credit: Money }[]): void {
  const debit = sumDebit(lines);
  const credit = sumCredit(lines);
  if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) throw new ValidationError("Accounting total exceeds safe integer range.");
  if (debit !== credit) throw new ValidationError(`Unbalanced voucher: debit ${debit} != credit ${credit}`);
}

export function validateLine(line: VoucherLine): void {
  if (!line.accountId) throw new ValidationError("Every voucher line requires an account.");
  if (!Number.isSafeInteger(line.debit) || !Number.isSafeInteger(line.credit) || line.debit < 0 || line.credit < 0) {
    throw new ValidationError("Debit and credit must be non-negative integer minor-unit amounts.");
  }
  if (line.debit > 0 && line.credit > 0) throw new ValidationError("A ledger line cannot contain both debit and credit.");
  if (line.debit === 0 && line.credit === 0) throw new ValidationError("A ledger line must have a debit or credit amount.");
}

export function validateVoucherLines(lines: readonly VoucherLine[]): void {
  if (lines.length < 2) throw new ValidationError("A voucher requires at least two ledger lines.");
  lines.forEach(validateLine);
  assertBalanced(lines);
}

export function accountNormalBalance(type: Account["type"]): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

export function calculatePartyBalance(entries: readonly Pick<LedgerEntry, "partyId" | "debit" | "credit">[], partyId: string): PartyBalance {
  const debit = entries.filter(e => e.partyId === partyId).reduce((s, e) => s + e.debit, 0);
  const credit = entries.filter(e => e.partyId === partyId).reduce((s, e) => s + e.credit, 0);
  const net = debit - credit;
  return { partyId, debit, credit, net, side: net > 0 ? "debit" : net < 0 ? "credit" : "zero" };
}

export function calculateAccountBalance(
  account: Pick<Account, "type" | "openingDebit" | "openingCredit">,
  entries: readonly Pick<LedgerEntry, "debit" | "credit">[]
): number {
  const debit = account.openingDebit + entries.reduce((s, e) => s + e.debit, 0);
  const credit = account.openingCredit + entries.reduce((s, e) => s + e.credit, 0);
  return accountNormalBalance(account.type) === "debit" ? debit - credit : credit - debit;
}
