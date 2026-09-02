import type { AccountingRepository, AtomicAccountingDocument, Money, PostingResult, Voucher, VoucherLine, VoucherLineInput } from "./types";
import { postIdempotentVoucher } from "./atomic";
import { ValidationError } from "./errors";
import { validateVoucherLines } from "./ledger";

export interface CashBankDeps { ids: { next(prefix: string): string }; clock: { now(): string } }
export interface CashBankBase { businessId: string; financialYearId: string; date: string; userId: string; idempotencyKey: string; narration?: string; reference?: string; notes?: string }
export interface CashBankAccountInput { businessId: string; financialYearId: string; accountId: string; displayName: string; ledgerAccountId: string; kind: "cash" | "bank"; parentAccountId: string; openingBalance: Money; openingBalanceType: "debit" | "credit"; openingBalanceDate: string; createdBy: string; details?: Record<string, unknown> }
export interface CashBankEntryInput extends CashBankBase { accountId: string; ledgerAccountId: string; type: "deposit" | "withdrawal" | "cash_deposit" | "cash_withdrawal"; amount: Money; contraAccountId: string; partyId?: string }
export interface CashBankTransferInput extends CashBankBase { fromAccountId: string; fromLedgerAccountId: string; toAccountId: string; toLedgerAccountId: string; amount: Money }

const assertDate = (value: string, name: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ValidationError(`${name} must be YYYY-MM-DD.`) };
const assertMoney = (value: Money) => { if (!Number.isSafeInteger(value) || value <= 0) throw new ValidationError("Amount must be a positive integer minor-unit amount.") };
const assertOpening = (value: Money) => { if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError("Opening balance must be a non-negative integer minor-unit amount.") };
const validateBase = (input: CashBankBase) => { if (!input.businessId || !input.financialYearId || !input.userId) throw new ValidationError("Business, financial year and user are required."); assertDate(input.date, "Transaction date"); if (input.idempotencyKey.length < 16 || input.idempotencyKey.length > 128) throw new ValidationError("A valid idempotency key is required.") };
const dr = (accountId: string, amount: Money, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({ accountId, debit: amount, credit: 0, ...extra });
const cr = (accountId: string, amount: Money, extra: Partial<VoucherLineInput> = {}): VoucherLineInput => ({ accountId, debit: 0, credit: amount, ...extra });
const atomic = (value: Omit<AtomicAccountingDocument, "status">): AtomicAccountingDocument => ({ ...value, status: "posted" });

export async function createCashBankAccount(repo: AccountingRepository, input: CashBankAccountInput, deps: CashBankDeps): Promise<{ accountId: string; ledgerAccountId: string; openingVoucherId?: string }> {
  if (!input.businessId || !input.financialYearId || !input.createdBy) throw new ValidationError("Business, financial year and user are required.");
  if (!input.displayName.trim()) throw new ValidationError("Account name is required.");
  assertOpening(input.openingBalance);
  assertDate(input.openingBalanceDate, "Opening balance date");
  if (!input.accountId || !input.ledgerAccountId || !input.parentAccountId) throw new ValidationError("Account identifiers are required.");

  return repo.runInTransaction(async tx => {
    const [existing, fy, parent, existingLedger] = await Promise.all([
      tx.getBusinessDocument("bankAccounts", input.accountId),
      tx.getFinancialYear(input.financialYearId),
      tx.getAccount(input.parentAccountId),
      tx.getAccount(input.ledgerAccountId),
    ]);
    if (existing) throw new ValidationError("Cash/bank account already exists.");
    if (!fy || fy.businessId !== input.businessId || fy.locked) throw new ValidationError("Active financial year is required for cash/bank account creation.");
    if (input.openingBalanceDate < fy.startDate || input.openingBalanceDate > fy.endDate) throw new ValidationError("Opening balance date is outside the financial year.");
    if (!parent || parent.businessId !== input.businessId || parent.type !== "asset" || !parent.active) throw new ValidationError("Cash/Bank parent account is not configured.");
    if (existingLedger) throw new ValidationError("Cash/bank ledger account already exists.");

    let openingVoucher: Voucher | undefined;
    let openingLines: VoucherLine[] = [];
    let openingLedgerEntries: VoucherLine[] = [];
    let openingVoucherId: string | undefined;
    const now = deps.clock.now();

    if (input.openingBalance > 0) {
      const openingAccount = await tx.getAccount("acct-opening-balance");
      if (!openingAccount || openingAccount.businessId !== input.businessId || openingAccount.type !== "equity" || !openingAccount.active) throw new ValidationError("Opening balance adjustment account is not configured.");
      const sequenceId = `${input.financialYearId}_OPENING`.replace(/[^a-zA-Z0-9_-]/g, "_");
      const sequence = await tx.getBusinessDocument("voucherSequences", sequenceId);
      const next = Number(sequence?.nextNumber ?? 1);
      if (!Number.isSafeInteger(next) || next < 1) throw new ValidationError("Invalid opening voucher sequence.");
      const voucherId = deps.ids.next("vch");
      const voucherNumber = `OB-${String(next).padStart(6, "0")}`;
      const rawLines = input.openingBalanceType === "debit"
        ? [dr(input.ledgerAccountId, input.openingBalance, { description: `Opening balance for ${input.displayName.trim()}` }), cr("acct-opening-balance", input.openingBalance, { description: "Opening balance adjustment" })]
        : [dr("acct-opening-balance", input.openingBalance, { description: "Opening balance adjustment" }), cr(input.ledgerAccountId, input.openingBalance, { description: `Opening balance for ${input.displayName.trim()}` })];
      openingLines = rawLines.map((line, index) => ({ ...line, lineId: deps.ids.next("line"), voucherId, businessId: input.businessId, lineNo: index + 1 }));
      validateVoucherLines(openingLines);
      openingLedgerEntries = openingLines.map(line => ({ ...line, date: input.openingBalanceDate, voucherType: "OPENING", voucherNumber, createdAt: now }));
      openingVoucher = { id: voucherId, businessId: input.businessId, financialYearId: input.financialYearId, voucherType: "OPENING", voucherNumber, date: input.openingBalanceDate, status: "posted", referenceType: "cash_bank_opening", referenceId: input.accountId, narration: `Opening balance for ${input.displayName.trim()}`, totalDebit: input.openingBalance, totalCredit: input.openingBalance, createdBy: input.createdBy, createdAt: now, updatedAt: now, idempotencyKey: `cashbank-opening:${input.accountId}:${input.openingBalanceDate}` };
      openingVoucherId = voucherId;
      await tx.saveBusinessDocument("voucherSequences", sequenceId, { businessId: input.businessId, financialYearId: input.financialYearId, voucherType: "OPENING", prefix: "OB", nextNumber: next + 1, updatedAt: now });
    }

    await tx.saveAccount({ id: input.ledgerAccountId, businessId: input.businessId, code: `CB-${input.accountId.slice(-12)}`, name: input.displayName.trim(), type: "asset", parentId: input.parentAccountId, systemAccount: false, active: true, openingDebit: 0, openingCredit: 0, createdAt: now, updatedAt: now });
    if (openingVoucher) {
      await tx.saveVoucher(openingVoucher);
      await tx.saveVoucherLines(openingLines);
      await tx.saveLedgerEntries(openingLedgerEntries as any);
      await tx.saveAtomicDocument(atomic({ id: `${openingVoucher.id}:cashbankopening`, businessId: input.businessId, financialYearId: input.financialYearId, type: "opening", voucherId: openingVoucher.id, idempotencyKey: openingVoucher.idempotencyKey!, date: input.openingBalanceDate, createdBy: input.createdBy, createdAt: now, payload: { operation: "cash_bank_opening", accountId: input.accountId, amount: input.openingBalance, balanceType: input.openingBalanceType } }));
    }
    await tx.saveBusinessDocument("bankAccounts", input.accountId, { businessId: input.businessId, accountId: input.accountId, displayName: input.displayName.trim(), kind: input.kind, ledgerAccountId: input.ledgerAccountId, openingBalance: input.openingBalance, openingBalanceType: input.openingBalanceType, openingBalanceDate: input.openingBalanceDate, currentBalance: input.openingBalanceType === "debit" ? input.openingBalance : -input.openingBalance, status: "active", ...(input.details ?? {}), createdBy: input.createdBy, createdAt: now, updatedAt: now, ...(openingVoucherId ? { openingVoucherId } : {}) });
    await tx.saveAuditEvent({ id: deps.ids.next("audit"), businessId: input.businessId, entityType: "cash_bank_account", entityId: input.accountId, action: "ACCOUNT_CREATED", userId: input.createdBy, timestamp: now, after: { accountId: input.accountId, ledgerAccountId: input.ledgerAccountId, displayName: input.displayName.trim(), kind: input.kind, status: "active", openingBalance: input.openingBalance, openingBalanceType: input.openingBalanceType, ...(openingVoucherId ? { openingVoucherId } : {}) } });
    return { accountId: input.accountId, ledgerAccountId: input.ledgerAccountId, ...(openingVoucherId ? { openingVoucherId } : {}) };
  });
}

async function scopedAccount(tx: any, accountId: string) {
  const account = await tx.getBusinessDocument("bankAccounts", accountId);
  if (!account) throw new ValidationError("Cash/bank account was not found in the active business.");
  if (account.status !== "active") throw new ValidationError("Cash/bank account is inactive.");
  return account;
}

export async function postCashBankEntry(repo: AccountingRepository, input: CashBankEntryInput, deps: CashBankDeps): Promise<PostingResult> {
  validateBase(input); assertMoney(input.amount);
  const incoming = input.type === "deposit" || input.type === "cash_deposit";
  return repo.runInTransaction(async tx => {
    const existing = await tx.getVoucherByIdempotencyKey(input.businessId, input.financialYearId, input.idempotencyKey);
    if (existing) return { voucher: existing } as PostingResult;
    const account = await scopedAccount(tx, input.accountId);
    if (String(account.ledgerAccountId) !== input.ledgerAccountId) throw new ValidationError("Cash/bank ledger account mismatch.");
    const contra = await tx.getAccount(input.contraAccountId);
    if (!contra || contra.businessId !== input.businessId || !contra.active) throw new ValidationError("Counter account is invalid or inactive.");
    if (input.partyId) {
      const party = await tx.getBusinessDocument("parties", input.partyId);
      if (!party || String(party.businessId ?? input.businessId) !== input.businessId) throw new ValidationError("Selected party was not found in the active business.");
      if (String(party.ledgerAccountId) !== input.contraAccountId) throw new ValidationError("Selected party is not linked to the selected counter account.");
    }
    const partyLine = input.partyId ? { partyId: input.partyId } : {};
    const lines = incoming
      ? [dr(input.ledgerAccountId, input.amount), cr(input.contraAccountId, input.amount, partyLine)]
      : [dr(input.contraAccountId, input.amount, partyLine), cr(input.ledgerAccountId, input.amount)];
    const result = await postIdempotentVoucher(tx, { businessId: input.businessId, financialYearId: input.financialYearId, voucherType: incoming ? "RECEIPT" : "PAYMENT", prefix: incoming ? "RC" : "PY", date: input.date, narration: input.narration, createdBy: input.userId, referenceType: "cash_bank", referenceId: input.accountId, lines, idempotencyKey: input.idempotencyKey }, deps);
    const oldBalance = Number(account.currentBalance ?? 0);
    const newBalance = oldBalance + (incoming ? input.amount : -input.amount);
    const now = deps.clock.now();
    await tx.saveBusinessDocument("bankAccounts", input.accountId, { businessId: input.businessId, accountId: input.accountId, currentBalance: newBalance, lastVoucherId: result.voucher.id, lastTransactionAt: input.date, updatedAt: now });
    await tx.saveAtomicDocument(atomic({ id: `${result.voucher.id}:cashbank`, businessId: input.businessId, financialYearId: input.financialYearId, type: "journal", voucherId: result.voucher.id, idempotencyKey: input.idempotencyKey, date: input.date, createdBy: input.userId, createdAt: now, payload: { operation: "cash_bank_entry", accountId: input.accountId, type: input.type, amount: input.amount, partyId: input.partyId ?? null, reference: input.reference ?? "", notes: input.notes ?? "" } }));
    return result;
  });
}

export async function postCashBankTransfer(repo: AccountingRepository, input: CashBankTransferInput, deps: CashBankDeps): Promise<PostingResult> {
  validateBase(input); assertMoney(input.amount);
  if (input.fromAccountId === input.toAccountId) throw new ValidationError("Source and destination accounts must be different.");
  return repo.runInTransaction(async tx => {
    const existing = await tx.getVoucherByIdempotencyKey(input.businessId, input.financialYearId, input.idempotencyKey);
    if (existing) return { voucher: existing } as PostingResult;
    const from = await scopedAccount(tx, input.fromAccountId);
    const to = await scopedAccount(tx, input.toAccountId);
    if (String(from.ledgerAccountId) !== input.fromLedgerAccountId || String(to.ledgerAccountId) !== input.toLedgerAccountId) throw new ValidationError("Cash/bank ledger account mismatch.");
    const lines = [cr(input.fromLedgerAccountId, input.amount, { description: `Transfer to ${String(to.displayName ?? input.toAccountId)}` }), dr(input.toLedgerAccountId, input.amount, { description: `Transfer from ${String(from.displayName ?? input.fromAccountId)}` })];
    const result = await postIdempotentVoucher(tx, { businessId: input.businessId, financialYearId: input.financialYearId, voucherType: "CONTRA", prefix: "CT", date: input.date, narration: input.narration ?? `Transfer ${String(from.displayName ?? input.fromAccountId)} to ${String(to.displayName ?? input.toAccountId)}`, createdBy: input.userId, referenceType: "cash_bank_transfer", referenceId: `${input.fromAccountId}:${input.toAccountId}`, lines, idempotencyKey: input.idempotencyKey }, deps);
    const now = deps.clock.now();
    await tx.saveBusinessDocument("bankAccounts", input.fromAccountId, { businessId: input.businessId, accountId: input.fromAccountId, currentBalance: Number(from.currentBalance ?? 0) - input.amount, lastVoucherId: result.voucher.id, lastTransactionAt: input.date, updatedAt: now });
    await tx.saveBusinessDocument("bankAccounts", input.toAccountId, { businessId: input.businessId, accountId: input.toAccountId, currentBalance: Number(to.currentBalance ?? 0) + input.amount, lastVoucherId: result.voucher.id, lastTransactionAt: input.date, updatedAt: now });
    await tx.saveAtomicDocument(atomic({ id: `${result.voucher.id}:cashbanktransfer`, businessId: input.businessId, financialYearId: input.financialYearId, type: "contra", voucherId: result.voucher.id, idempotencyKey: input.idempotencyKey, date: input.date, createdBy: input.userId, createdAt: now, payload: { operation: "cash_bank_transfer", fromAccountId: input.fromAccountId, toAccountId: input.toAccountId, amount: input.amount, reference: input.reference ?? "", notes: input.notes ?? "" } }));
    return result;
  });
}
