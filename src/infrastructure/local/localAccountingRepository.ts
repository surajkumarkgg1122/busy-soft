import type {
  AccountingRepository,
  AccountingTransaction,
  Account,
  AtomicAccountingDocument,
  AuditEvent,
  FinancialYear,
  LedgerEntry,
  PartyAllocation,
  ReturnDocument,
  StockMovement,
  Voucher,
  VoucherLine,
} from "@/core/accounting/types";
import { ValidationError } from "@/core/accounting/errors";
import { normalizeWarehouseId } from "@/core/accounting/stock";
import { requireLocalDb, type LocalRow } from "./localDb";

const own = (value: unknown, businessId: string) => {
  if (typeof value !== "object" || value === null || String((value as Record<string, unknown>).businessId ?? "") !== businessId) {
    throw new ValidationError("Business mismatch in local persistence.");
  }
};
const row = <T extends Record<string, unknown>>(value: T): LocalRow => ({ ...value, id: String(value.id) });
const byId = async <T extends Record<string, unknown>>(table: { get(id: string): Promise<T | undefined> }, id: string, businessId: string): Promise<T | null> => {
  const value = await table.get(id);
  if (!value || String(value.businessId ?? "") !== businessId) return null;
  return value;
};

class LocalAccountingTransaction implements AccountingTransaction {
  constructor(private readonly businessId: string) {}

  getFinancialYear = (id: string) => byId(requireLocalDb().financialYears, id, this.businessId) as Promise<FinancialYear | null>;
  getAccount = (id: string) => byId(requireLocalDb().accounts, id, this.businessId) as Promise<Account | null>;
  getVoucher = (id: string) => byId(requireLocalDb().vouchers, id, this.businessId) as Promise<Voucher | null>;

  async getVoucherLines(voucherId: string) {
    return (await requireLocalDb().voucherLines.where("voucherId").equals(voucherId).toArray())
      .filter(v => String(v.businessId ?? "") === this.businessId).sort((a, b) => Number(a.lineNo ?? 0) - Number(b.lineNo ?? 0)) as unknown as VoucherLine[];
  }

  async getVouchersByReference(referenceType: string, referenceId: string) {
    return (await requireLocalDb().vouchers.toArray()).filter(v => String(v.businessId ?? "") === this.businessId && v.referenceType === referenceType && v.referenceId === referenceId && v.status === "posted") as unknown as Voucher[];
  }

  async getVoucherByIdempotencyKey(businessId: string, financialYearId: string, key: string) {
    if (businessId !== this.businessId) return null;
    const found = await requireLocalDb().vouchers.where("[businessId+financialYearId+idempotencyKey]").equals([businessId, financialYearId, key]).first();
    return (found ?? null) as unknown as Voucher | null;
  }

  async getAtomicDocumentByIdempotencyKey(businessId: string, financialYearId: string, key: string) {
    if (businessId !== this.businessId) return null;
    const found = await requireLocalDb().accountingDocuments.where("[businessId+financialYearId+idempotencyKey]").equals([businessId, financialYearId, key]).first();
    return (found ?? null) as unknown as AtomicAccountingDocument | null;
  }

  async getStockMovementsForSource(sourceId: string) {
    return (await requireLocalDb().stockMovements.where("sourceId").equals(sourceId).toArray()).filter(v => String(v.businessId ?? "") === this.businessId) as unknown as StockMovement[];
  }

  async getStockMovementsForItem(itemId: string, warehouseId?: string, throughDate?: string) {
    const wanted = warehouseId ? normalizeWarehouseId(warehouseId) : undefined;
    return (await requireLocalDb().stockMovements.where("itemId").equals(itemId).toArray())
      .filter(v => String(v.businessId ?? "") === this.businessId && (!wanted || normalizeWarehouseId(String(v.warehouseId ?? "")) === wanted) && (!throughDate || String(v.date ?? "") <= throughDate))
      .sort((a, b) => `${a.date}:${a.createdAt}:${a.id}`.localeCompare(`${b.date}:${b.createdAt}:${b.id}`)) as unknown as StockMovement[];
  }

  async getPartyAllocationsForVoucher(voucherId: string) {
    const [from, to] = await Promise.all([
      requireLocalDb().partyAllocations.where("fromVoucherId").equals(voucherId).toArray(),
      requireLocalDb().partyAllocations.where("toVoucherId").equals(voucherId).toArray(),
    ]);
    const map = new Map<string, LocalRow>();
    [...from, ...to].filter(v => String(v.businessId ?? "") === this.businessId).forEach(v => map.set(v.id, v));
    return [...map.values()] as unknown as PartyAllocation[];
  }

  async getBusinessDocument(collectionName: string, id: string) {
    const db = requireLocalDb();
    const table = (db as unknown as Record<string, { get(id: string): Promise<LocalRow | undefined> }>)[collectionName];
    if (!table) throw new ValidationError(`Unsupported local business collection: ${collectionName}.`);
    const value = await table.get(id);
    if (!value || String(value.businessId ?? "") !== this.businessId) return null;
    if (collectionName !== "items") return value;
    const movements = await db.stockMovements.where("itemId").equals(id).toArray();
    const stock = movements.filter(v => String(v.businessId ?? "") === this.businessId).reduce((sum, v) => sum + (v.direction === "in" ? Number(v.quantity ?? 0) : -Number(v.quantity ?? 0)), 0);
    return { ...value, stock, stockReconciliationSource: "stockMovements" };
  }

  async saveAccount(value: Account) { own(value, this.businessId); await requireLocalDb().accounts.put(row(value)); }
  async saveVoucher(value: Voucher) { own(value, this.businessId); await requireLocalDb().vouchers.put(row(value)); }
  async saveVoucherLines(values: VoucherLine[]) { values.forEach(v => own(v, this.businessId)); await requireLocalDb().voucherLines.bulkPut(values.map(row)); }
  async saveLedgerEntries(values: LedgerEntry[]) { values.forEach(v => own(v, this.businessId)); await requireLocalDb().ledgerEntries.bulkPut(values.map(row)); }
  async saveStockMovements(values: StockMovement[]) { values.forEach(v => own(v, this.businessId)); await requireLocalDb().stockMovements.bulkPut(values.map(row)); }
  async savePartyAllocations(values: PartyAllocation[]) { values.forEach(v => own(v, this.businessId)); await requireLocalDb().partyAllocations.bulkPut(values.map(row)); }
  async saveReturnDocument(value: ReturnDocument) { own(value, this.businessId); await requireLocalDb().returnDocuments.put(row(value)); }
  async saveAtomicDocument(value: AtomicAccountingDocument) { own(value, this.businessId); await requireLocalDb().accountingDocuments.put(row(value)); }
  async saveBusinessDocument(collectionName: string, id: string, value: Record<string, unknown>) {
    own(value, this.businessId);
    const table = (requireLocalDb() as unknown as Record<string, { put(value: LocalRow): Promise<unknown> }>)[collectionName];
    if (!table) throw new ValidationError(`Unsupported local business collection: ${collectionName}.`);
    await table.put({ ...value, id });
  }
  async saveAuditEvent(value: AuditEvent) { own(value, this.businessId); await requireLocalDb().auditLogs.put(row(value)); }

  async allocateVoucherNumber(input: { businessId: string; financialYearId: string; voucherType: string; prefix?: string }) {
    if (input.businessId !== this.businessId) throw new ValidationError("Business mismatch while allocating local voucher number.");
    // Local numbers are explicitly provisional. The cloud repository allocates the authoritative number.
    return `DEV-${this.businessId.slice(0, 8)}-${input.voucherType.toUpperCase()}-${crypto.randomUUID().slice(0, 8)}`;
  }
}

export function createLocalAccountingRepository(businessId: string): AccountingRepository {
  if (!businessId.trim()) throw new ValidationError("Business ID is required.");
  return {
    runInTransaction: async <T>(work: (tx: AccountingTransaction) => Promise<T>) => {
      const db = requireLocalDb();
      return db.transaction("rw", [
        db.businesses, db.financialYears, db.accounts, db.parties, db.items, db.units, db.warehouses,
        db.taxConfigurations, db.vouchers, db.voucherLines, db.ledgerEntries, db.stockMovements,
        db.partyAllocations, db.returnDocuments, db.accountingDocuments, db.auditLogs, db.localTransactions,
        db.syncOperations, db.syncAttempts, db.conflicts, db.syncCheckpoints, db.projections,
      ], () => work(new LocalAccountingTransaction(businessId)));
    },
  };
}
