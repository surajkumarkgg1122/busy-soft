import type { AccountingRepository, AccountingTransaction, Account, AuditEvent, FinancialYear, LedgerEntry, StockMovement, Voucher, VoucherLine } from "./types";
import { ValidationError } from "./errors";

export class InMemoryAccountingRepository implements AccountingRepository {
  readonly financialYears = new Map<string, FinancialYear>();
  readonly accounts = new Map<string, Account>();
  readonly vouchers = new Map<string, Voucher>();
  readonly voucherLines = new Map<string, VoucherLine>();
  readonly ledgerEntries = new Map<string, LedgerEntry>();
  readonly stockMovements = new Map<string, StockMovement>();
  readonly auditLogs = new Map<string, AuditEvent>();
  private readonly sequences = new Map<string, number>();

  async runInTransaction<T>(work: (tx: AccountingTransaction) => Promise<T>): Promise<T> {
    // This adapter is intentionally simple and is only for unit tests/domain development.
    return work(this);
  }
  async getFinancialYear(id: string): Promise<FinancialYear | null> { return this.financialYears.get(id) ?? null; }
  async getAccount(id: string): Promise<Account | null> { return this.accounts.get(id) ?? null; }
  async getVoucher(id: string): Promise<Voucher | null> { return this.vouchers.get(id) ?? null; }
  async getVoucherLines(voucherId: string): Promise<VoucherLine[]> { return [...this.voucherLines.values()].filter(v => v.voucherId === voucherId).sort((a, b) => a.lineNo - b.lineNo); }
  async saveVoucher(voucher: Voucher): Promise<void> { this.vouchers.set(voucher.id, voucher); }
  async saveVoucherLines(lines: VoucherLine[]): Promise<void> { for (const line of lines) this.voucherLines.set(line.lineId, line); }
  async saveLedgerEntries(entries: LedgerEntry[]): Promise<void> { for (const entry of entries) this.ledgerEntries.set(entry.lineId, entry); }
  async saveStockMovements(movements: StockMovement[]): Promise<void> { for (const movement of movements) this.stockMovements.set(movement.id, movement); }
  async saveAuditEvent(event: AuditEvent): Promise<void> { this.auditLogs.set(event.id, event); }
  async allocateVoucherNumber(input: { businessId: string; financialYearId: string; voucherType: string; prefix?: string }): Promise<string> {
    const key = `${input.businessId}:${input.financialYearId}:${input.voucherType}`;
    const next = this.sequences.get(key) ?? 1;
    if (!Number.isSafeInteger(next) || next < 1) throw new ValidationError("Invalid test sequence.");
    this.sequences.set(key, next + 1);
    return `${input.prefix ?? input.voucherType.toUpperCase()}-${String(next).padStart(6, "0")}`;
  }
}

export const testIds = (prefix = "id") => {
  let n = 0;
  return { next: (p: string) => `${p}-${prefix}-${++n}` };
};
export const fixedClock = (value = "2026-08-30T12:00:00.000Z") => ({ now: () => value });
