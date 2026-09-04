import type { AccountingTransaction, PostingResult, VoucherLineInput } from "./types";
import { ValidationError } from "./errors";
import { postVoucher, type VoucherEngineDeps } from "./voucher";
import { accountingIdempotency } from "./idempotency";

export async function postIdempotentVoucher(
  tx: AccountingTransaction,
  input: { businessId: string; financialYearId: string; voucherType: string; date: string; narration?: string; referenceType?: string; referenceId?: string; prefix?: string; createdBy: string; lines: VoucherLineInput[]; idempotencyKey: string },
  deps: VoucherEngineDeps,
): Promise<PostingResult> {
  if (!input.idempotencyKey) throw new ValidationError("Idempotency key is required for an atomic business command.");
  const fingerprint = await accountingIdempotency.fingerprint(input);
  const existing = await tx.getVoucherByIdempotencyKey(input.businessId, input.financialYearId, input.idempotencyKey);
  if (existing) {
    if (existing.businessId !== input.businessId || existing.financialYearId !== input.financialYearId || existing.voucherType !== input.voucherType) {
      throw new ValidationError("Idempotency key is already used by a different accounting operation.");
    }
    // Older vouchers may not have a fingerprint. Refuse ambiguous replay instead of guessing.
    if (!existing.idempotencyFingerprint) throw new ValidationError("Existing idempotency record has no payload fingerprint; create a new idempotency key.");
    accountingIdempotency.assertCompatible(existing.idempotencyFingerprint, fingerprint);
    const lines = await tx.getVoucherLines(existing.id);
    return { voucher: existing, lines, ledgerEntries: lines.map(l => ({ ...l, financialYearId: existing.financialYearId, date: existing.date, voucherType: existing.voucherType, voucherNumber: existing.voucherNumber, createdAt: existing.createdAt })), stockMovements: await tx.getStockMovementsForSource(existing.id) };
  }
  const result = await postVoucher(tx, input, deps);
  result.voucher.idempotencyKey = input.idempotencyKey;
  result.voucher.idempotencyFingerprint = fingerprint;
  await tx.saveVoucher(result.voucher);
  return result;
}
