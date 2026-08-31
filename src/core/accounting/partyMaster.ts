import type { AccountingRepository, Money } from "./types";
import { ValidationError } from "./errors";

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
  createdAt: string;
  updatedAt: string;
}

export function normalizePartyInput(input: Partial<PartyMaster>, kind: PartyKind): Omit<PartyMaster, "id" | "createdAt" | "updatedAt"> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new ValidationError("Party name is required.");
  const partyCode = String(input.partyCode ?? "").trim();
  if (!partyCode) throw new ValidationError("Party code is required.");
  const phone = String(input.phone ?? "").trim();
  if (phone && !/^\+?[0-9\s()-]{10,15}$/.test(phone)) throw new ValidationError("Enter a valid phone number.");
  const email = String(input.email ?? "").trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError("Enter a valid email address.");
  const address = input.address ?? { line1: "", city: "", state: "", pincode: "", country: "India" };
  if (!address.city?.trim() || !address.state?.trim()) throw new ValidationError("Party city and state are required.");
  if (!/^\d{6}$/.test(address.pincode ?? "")) throw new ValidationError("Party pincode must be 6 digits.");
  const gst = input.gst ?? { type: "unregistered" as PartyRegistrationType };
  const gstType = gst.type;
  let gstin = gst.gstin?.trim().toUpperCase();
  if ((gstType === "regular" || gstType === "composition") && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin ?? "")) throw new ValidationError("Enter a valid GSTIN for a registered party.");
  if (gstType === "unregistered" || gstType === "other") gstin = undefined;
  const openingBalance = Number(input.openingBalance ?? 0);
  if (!Number.isSafeInteger(openingBalance) || openingBalance < 0) throw new ValidationError("Opening balance must be a non-negative integer minor-unit amount.");
  const creditLimit = Number(input.creditLimit ?? 0);
  if (!Number.isSafeInteger(creditLimit) || creditLimit < 0) throw new ValidationError("Credit limit must be a non-negative integer minor-unit amount.");
  return {
    businessId: String(input.businessId ?? "").trim(),
    partyCode, name, kind, phone, email,
    address: { line1: address.line1?.trim() ?? "", line2: address.line2?.trim(), city: address.city.trim(), district: address.district?.trim(), state: address.state.trim(), pincode: address.pincode.trim(), country: address.country?.trim() || "India" },
    gst: { type: gstType, ...(gstin ? { gstin } : {}) },
    openingBalance, openingBalanceType: input.openingBalanceType ?? (kind === "customer" ? "debit" : "credit"), creditLimit,
    status: input.status ?? "active",
    ledgerAccountId: String(input.ledgerAccountId ?? "").trim(),
  };
}

export async function savePartyMaster(repo: AccountingRepository, deps: { ids: { next(prefix: string): string }; clock: { now(): string } }, input: Partial<PartyMaster>, kind: PartyKind): Promise<PartyMaster> {
  return repo.runInTransaction(async (tx) => {
    const normalized = normalizePartyInput(input, kind);
    if (!normalized.businessId || !normalized.ledgerAccountId) throw new ValidationError("Party business and ledger account are required.");
    const existing = await tx.getBusinessDocument("parties", normalized.partyCode);
    if (existing) throw new ValidationError(`Party code already exists: ${normalized.partyCode}`);
    const ledger = await tx.getAccount(normalized.ledgerAccountId);
    if (!ledger || ledger.businessId !== normalized.businessId || !ledger.active) throw new ValidationError("Selected party ledger account is invalid.");
    const expectedType = kind === "customer" ? "asset" : "liability";
    if (ledger.type !== expectedType) throw new ValidationError(`Party ledger must be an active ${expectedType} account.`);
    const now = deps.clock.now();
    const party: PartyMaster = { id: deps.ids.next(kind === "customer" ? "cust" : "supp"), ...normalized, createdAt: now, updatedAt: now };
    await tx.saveBusinessDocument("parties", party.id, party as unknown as Record<string, unknown>);
    await tx.saveAuditEvent({ id: deps.ids.next("audit"), businessId: party.businessId, entityType: "party", entityId: party.id, action: "PARTY_CREATED", userId: party.businessId, timestamp: now, after: party as unknown as Record<string, unknown> });
    return party;
  });
}
