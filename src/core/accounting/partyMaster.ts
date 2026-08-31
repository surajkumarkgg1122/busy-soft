import type { AccountingRepository, LedgerEntry, Money, Voucher, VoucherLine } from "./types";
import { ValidationError } from "./errors";
import { validateVoucherLines } from "./ledger";

export type PartyKind = "customer" | "supplier";
export type PartyStatus = "active" | "inactive";
export type PartyRegistrationType = "regular" | "composition" | "unregistered" | "other";

export interface PartyMaster {
  id: string;
  businessId: string;
  partyCode: string;
  name: string;
  kind: PartyKind;
  phone: string;
  email: string;
  address: { line1: string; line2?: string; city: string; district?: string; state: string; pincode: string; country: string };
  gst: { type: PartyRegistrationType; gstin?: string };
  openingBalance: Money;
  openingBalanceType: "debit" | "credit";
  creditLimit: Money;
  status: PartyStatus;
  ledgerAccountId: string;
  openingVoucherId?: string;
  createdAt: string;
  updatedAt: string;
}

function normalizePartyInput(input: Partial<PartyMaster>, kind: PartyKind): Omit<PartyMaster, "id" | "createdAt" | "updatedAt"> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new ValidationError("Party name is required.");
  const partyCode = String(input.partyCode ?? "").trim();
  if (!/^[-A-Za-z0-9_]{3,40}$/.test(partyCode)) throw new ValidationError("Party code must be 3–40 characters using letters, numbers, hyphens or underscores.");
  const businessId = String(input.businessId ?? "").trim();
  if (!businessId) throw new ValidationError("Party business is required.");
  const ledgerAccountId = String(input.ledgerAccountId ?? "").trim();
  if (!ledgerAccountId) throw new ValidationError("Party ledger account is required.");
  const phone = String(input.phone ?? "").trim();
  if (phone && !/^\+?[0-9\s()-]{10,15}$/.test(phone)) throw new ValidationError("Enter a valid phone number.");
  const email = String(input.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  const address = input.address ?? { line1: "", city: "", state: "", pincode: "", country: "India" };
  if (!address.city?.trim() || !address.state?.trim()) throw new ValidationError("Party city and state are required.");
  if (!/^\d{6}$/.test(address.pincode ?? "")) throw new ValidationError("Party pincode must be a valid 6-digit Indian pincode.");
  const gst = input.gst ?? { type: "unregistered" as PartyRegistrationType };
  if (!["regular", "composition", "unregistered", "other"].includes(gst.type)) throw new ValidationError("Invalid GST registration type.");
  const gstType = gst.type;
  let gstin = gst.gstin?.trim().toUpperCase();
  if ((gstType === "regular" || gstType === "composition") && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin ?? "")) throw new ValidationError("Enter a valid GSTIN for a registered party.");
  if (gstType === "unregistered" || gstType === "other") gstin = undefined;
  const openingBalance = Number(input.openingBalance ?? 0);
  if (!Number.isSafeInteger(openingBalance) || openingBalance < 0) throw new ValidationError("Opening balance must be a non-negative integer minor-unit amount.");
  const creditLimit = Number(input.creditLimit ?? 0);
  if (!Number.isSafeInteger(creditLimit) || creditLimit < 0) throw new ValidationError("Credit limit must be a non-negative integer minor-unit amount.");
  const openingBalanceType = input.openingBalanceType ?? (kind === "customer" ? "debit" : "credit");
  if (openingBalanceType !== "debit" && openingBalanceType !== "credit") throw new ValidationError("Invalid opening balance type.");
  const status = input.status ?? "active";
  if (status !== "active" && status !== "inactive") throw new ValidationError("Invalid party status.");
  return { businessId, partyCode, name, kind, phone, email, address: { line1: address.line1?.trim() ?? "", line2: address.line2?.trim(), city: address.city.trim(), district: address.district?.trim(), state: address.state.trim(), pincode: address.pincode.trim(), country: address.country?.trim() || "India" }, gst: { type: gstType, ...(gstin ? { gstin } : {}) }, openingBalance, openingBalanceType, creditLimit, status, ledgerAccountId };
}

function openingVoucherIdempotencyKey(party: PartyMaster, key: string) { return `party-opening:${party.kind}:${party.id}:${key}`; }

export async function savePartyMaster(repo: AccountingRepository, deps: { ids: { next(prefix: string): string }; clock: { now(): string } }, input: Partial<PartyMaster>, kind: PartyKind, userId: string, financialYearId: string, idempotencyKey: string): Promise<PartyMaster> {
  return repo.runInTransaction(async (tx) => {
    const normalized = normalizePartyInput(input, kind);
    const existing = await tx.getBusinessDocument("parties", normalized.partyCode);
    if (existing) throw new ValidationError(`Party code already exists: ${normalized.partyCode}`);
    const fy = await tx.getFinancialYear(financialYearId);
    if (!fy || fy.businessId !== normalized.businessId || fy.locked) throw new ValidationError("Active financial year is required for party creation.");
    const ledger = await tx.getAccount(normalized.ledgerAccountId);
    if (!ledger || ledger.businessId !== normalized.businessId || !ledger.active) throw new ValidationError("Selected party ledger account is invalid.");
    const expectedType = kind === "customer" ? "asset" : "liability";
    if (ledger.type !== expectedType) throw new ValidationError(`Party ledger must be an active ${expectedType} account.`);
    const openingAccount = normalized.openingBalance > 0 ? await tx.getAccount("acct-opening-balance") : null;
    if (normalized.openingBalance > 0 && (!openingAccount || openingAccount.businessId !== normalized.businessId || !openingAccount.active || openingAccount.type !== "equity")) throw new ValidationError("Opening balance adjustment account is not configured.");
    const openingKey = openingVoucherIdempotencyKey({ ...normalized, id: normalized.partyCode } as PartyMaster, idempotencyKey);
    const existingOpening = normalized.openingBalance > 0 ? await tx.getVoucherByIdempotencyKey(normalized.businessId, financialYearId, openingKey) : null;
    const sequenceId = `${financialYearId}_OPENING`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sequence = normalized.openingBalance > 0 && !existingOpening ? await tx.getBusinessDocument("voucherSequences", sequenceId) : null;
    const now = deps.clock.now();
    const party: PartyMaster = { id: normalized.partyCode, ...normalized, createdAt: now, updatedAt: now };
    let openingVoucher: Voucher | null = null;
    let openingLines: VoucherLine[] = [];
    let openingLedgerEntries: LedgerEntry[] = [];
    if (normalized.openingBalance > 0) {
      const next = Number(sequence?.nextNumber ?? 1);
      if (!Number.isSafeInteger(next) || next < 1) throw new ValidationError("Invalid opening voucher sequence.");
      const voucherId = deps.ids.next("vch");
      const voucherNumber = `OB-${String(next).padStart(6, "0")}`;
      const debitParty = normalized.openingBalanceType === "debit";
      const inputLines = [
        { accountId: debitParty ? normalized.ledgerAccountId : "acct-opening-balance", partyId: normalized.partyCode, description: "Party opening balance", debit: normalized.openingBalance, credit: 0 },
        { accountId: debitParty ? "acct-opening-balance" : normalized.ledgerAccountId, partyId: normalized.partyCode, description: "Opening balance adjustment", debit: 0, credit: normalized.openingBalance },
      ];
      openingLines = inputLines.map((line, index) => ({ ...line, lineId: deps.ids.next("line"), voucherId, businessId: normalized.businessId, lineNo: index + 1 }));
      validateVoucherLines(openingLines);
      openingLedgerEntries = openingLines.map(line => ({ ...line, date: fy.startDate, voucherType: "OPENING", voucherNumber, createdAt: now }));
      openingVoucher = { id: voucherId, businessId: normalized.businessId, financialYearId, voucherType: "OPENING", voucherNumber, date: fy.startDate, status: "posted", referenceType: "party_opening", referenceId: normalized.partyCode, narration: `Opening balance for ${normalized.name}`, totalDebit: normalized.openingBalance, totalCredit: normalized.openingBalance, createdBy: userId, createdAt: now, updatedAt: now, idempotencyKey: openingKey };
      party.openingVoucherId = voucherId;
    }

    await tx.saveBusinessDocument("parties", party.id, party as unknown as Record<string, unknown>);
    if (openingVoucher) {
      await tx.saveVoucher(openingVoucher);
      await tx.saveVoucherLines(openingLines);
      await tx.saveLedgerEntries(openingLedgerEntries);
      await tx.saveAtomicDocument({ id: deps.ids.next("acctdoc"), businessId: normalized.businessId, financialYearId, type: "opening", voucherId: openingVoucher.id, idempotencyKey: openingKey, status: "posted", date: fy.startDate, createdBy: userId, createdAt: now, payload: { kind: "partyOpening", partyId: party.id, partyKind: kind, amount: normalized.openingBalance, balanceType: normalized.openingBalanceType } });
      await tx.saveBusinessDocument("voucherSequences", sequenceId, { businessId: normalized.businessId, financialYearId, voucherType: "OPENING", prefix: "OB", nextNumber: Number(sequence?.nextNumber ?? 1) + 1, updatedAt: now });
    }
    await tx.saveAuditEvent({ id: deps.ids.next("audit"), businessId: party.businessId, entityType: "party", entityId: party.id, action: "PARTY_CREATED", userId, timestamp: now, after: party as unknown as Record<string, unknown>, metadata: openingVoucher ? { openingVoucherId: openingVoucher.id } : undefined });
    return party;
  });
}

export async function updatePartyMaster(repo: AccountingRepository, deps: { ids: { next(prefix: string): string }; clock: { now(): string } }, input: Partial<PartyMaster>, kind: PartyKind, userId: string): Promise<PartyMaster> {
  return repo.runInTransaction(async (tx) => {
    const partyId = String(input.id ?? "").trim();
    if (!partyId) throw new ValidationError("Party ID is required.");
    const existingRaw = await tx.getBusinessDocument("parties", partyId);
    if (!existingRaw) throw new ValidationError("Party not found.");
    const existing = existingRaw as unknown as PartyMaster;
    if (existing.businessId !== input.businessId || existing.kind !== kind) throw new ValidationError("Party business or type mismatch.");
    const normalized = normalizePartyInput({ ...existing, ...input, id: partyId }, kind);
    if (normalized.partyCode !== existing.partyCode) {
      const codeConflict = await tx.getBusinessDocument("parties", normalized.partyCode);
      if (codeConflict && (codeConflict as { id?: string }).id !== partyId) throw new ValidationError(`Party code already exists: ${normalized.partyCode}`);
      throw new ValidationError("Party code cannot be changed after creation.");
    }
    if (normalized.ledgerAccountId !== existing.ledgerAccountId) throw new ValidationError("Party ledger account cannot be changed after creation.");
    if (normalized.openingBalance !== existing.openingBalance || normalized.openingBalanceType !== existing.openingBalanceType) throw new ValidationError("Opening balance cannot be changed from Party Master after creation; use an accounting voucher.");
    const now = deps.clock.now();
    const party: PartyMaster = { id: partyId, ...normalized, createdAt: existing.createdAt, updatedAt: now, ...(existing.openingVoucherId ? { openingVoucherId: existing.openingVoucherId } : {}) };
    await tx.saveBusinessDocument("parties", party.id, party as unknown as Record<string, unknown>);
    await tx.saveAuditEvent({ id: deps.ids.next("audit"), businessId: party.businessId, entityType: "party", entityId: party.id, action: "PARTY_UPDATED", userId, timestamp: now, before: existingRaw, after: party as unknown as Record<string, unknown> });
    return party;
  });
}
