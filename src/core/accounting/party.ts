import type { LedgerEntry, Money } from "./types";
import { ValidationError } from "./errors";

export interface PartyAllocation { id: string; businessId: string; partyId: string; fromVoucherId: string; toVoucherId: string; amount: Money; date: string; createdBy: string; createdAt: string; }
export interface OutstandingDocument { voucherId: string; voucherNumber: string; date: string; dueDate?: string; original: Money; allocated: Money; outstanding: Money; }

export function validateAllocation(input: Omit<PartyAllocation, "id">): void {
  if (!input.businessId || !input.partyId || !input.fromVoucherId || !input.toVoucherId || input.fromVoucherId === input.toVoucherId) throw new ValidationError("Invalid party allocation references.");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new ValidationError("Allocation amount must be a positive integer minor-unit amount.");
}

export function calculatePartyNet(entries: readonly Pick<LedgerEntry,"partyId"|"debit"|"credit">[], partyId: string): Money { return entries.filter(e=>e.partyId===partyId).reduce((s,e)=>s+e.debit-e.credit,0); }

export function allocateAgainstOutstanding(requested: Money, documents: readonly OutstandingDocument[]): { allocations: Array<{voucherId:string;amount:Money}>; unallocated: Money } {
  if (!Number.isSafeInteger(requested) || requested < 0) throw new ValidationError("Requested allocation must be non-negative.");
  let remaining = requested;
  const allocations: Array<{voucherId:string;amount:Money}> = [];
  for (const d of documents) { if (remaining <= 0) break; if (d.outstanding <= 0) continue; const amount=Math.min(remaining,d.outstanding); allocations.push({voucherId:d.voucherId,amount}); remaining-=amount; }
  return { allocations, unallocated: remaining };
}
