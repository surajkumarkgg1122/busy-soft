import { ValidationError } from "./errors";
import type { VoucherLineInput } from "./types";

export interface IdempotencyPayload {
  businessId: string;
  financialYearId: string;
  voucherType: string;
  date: string;
  dueDate?: string;
  narration?: string;
  referenceType?: string;
  referenceId?: string;
  prefix?: string;
  createdBy: string;
  lines: readonly VoucherLineInput[];
}

export interface IdempotencyService {
  fingerprint(payload: IdempotencyPayload): Promise<string>;
  assertCompatible(existingFingerprint: string | undefined, requestedFingerprint: string): void;
}

export const accountingIdempotency: IdempotencyService = {
  async fingerprint(payload) {
    const normalized = {
      businessId: payload.businessId,
      financialYearId: payload.financialYearId,
      voucherType: payload.voucherType,
      date: payload.date,
      dueDate: payload.dueDate ?? null,
      narration: payload.narration ?? null,
      referenceType: payload.referenceType ?? null,
      referenceId: payload.referenceId ?? null,
      prefix: payload.prefix ?? null,
      createdBy: payload.createdBy,
      lines: payload.lines.map(line => ({
        accountId: line.accountId,
        partyId: line.partyId ?? null,
        description: line.description ?? null,
        debit: line.debit,
        credit: line.credit,
        costCenterId: line.costCenterId ?? null,
        itemId: line.itemId ?? null,
        warehouseId: line.warehouseId ?? null,
        taxCode: line.taxCode ?? null,
      })),
    };
    const bytes = new TextEncoder().encode(JSON.stringify(normalized));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  },
  assertCompatible(existingFingerprint, requestedFingerprint) {
    if (existingFingerprint !== requestedFingerprint) {
      throw new ValidationError("Idempotency key was already used for a different accounting payload.");
    }
  },
};
