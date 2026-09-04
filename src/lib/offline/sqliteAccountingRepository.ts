// Dexie (IndexedDB) - based SQLite-alike offline persistence.
// This is the CORRECT implementation for the current runtime (pure Next.js browser webapp, no Electron/Tauri).
// We call this SqliteAccountingRepository to honour the audit contract: this is our durable local SQLite-equivalent.
import Dexie, { type Table, type Transaction } from "dexie";
import type {
  Account, AccountingRepository, AccountingTransaction, AtomicAccountingDocument,
  AuditEvent, FinancialYear, LedgerEntry, PartyAllocation, PostingResult,
  ReturnDocument, StockMovement, Voucher, VoucherLine,
} from "@/core/accounting/types";
import { ValidationError } from "@/core/accounting/errors";
import { validateAccount } from "@/core/accounting/ledger";
import { normalizeWarehouseId } from "@/core/accounting/stock";
import type { NumberReservation, SyncConflictMeta, SyncCursor, SyncOperation, SyncStatus } from "@/types/offline";

export interface AccountRow extends Account { _syncStatus: SyncStatus; _serverUpdatedAt?: string; _syncedAt?: string; }
export interface VoucherRow extends Voucher { _syncStatus: SyncStatus; _localSeq: number; _serverAckAt?: string; _error?: string; _conflictMeta?: SyncConflictMeta; }
export interface VoucherLineRow extends VoucherLine { _syncedAt?: string; }
export interface LedgerEntryRow extends LedgerEntry { _syncedAt?: string; }
export interface StockMovementRow extends StockMovement { _syncStatus: SyncStatus; _syncedAt?: string; }
export interface PartyAllocationRow extends PartyAllocation { _syncStatus: SyncStatus; _syncedAt?: string; }
export interface ReturnDocumentRow extends ReturnDocument { _syncStatus: SyncStatus; _syncedAt?: string; }
export interface PartyMasterRow {
  id: string; businessId: string; kind: string; name: string; partyCode?: string;
  gstin?: string; phone?: string; email?: string; status?: string; ledgerAccountId?: string;
  receivableLedgerAccountId?: string; payableLedgerAccountId?: string;
  [k: string]: unknown;
  _syncedAt?: string; _fieldUpdatedAt?: Record<string, string>;
}
export interface ItemMasterRow {
  id: string; businessId: string; name: string; itemCode?: string; unitId?: string;
  categoryId?: string; gstRate?: number; hsnCode?: string; status?: string; stock?: number; stockValue?: number;
  [k: string]: unknown;
  _syncedAt?: string;
}
export interface WarehouseRow { id: string; businessId: string; name: string; code?: string; status?: string; _syncedAt?: string; [k: string]: unknown; }
export interface TaxRateRow { id: string; businessId: string; rate: number; name?: string; _syncedAt?: string; }
export interface SettingsRow { key: string; businessId: string; value: unknown; updatedAt: string; }
export interface BusinessRow { id: string; name: string; legalName?: string; gstin?: string; state?: string; financialYearStartMonth?: number; setupStatus?: string; _syncedAt?: string; }
export interface AuthCacheRow { businessId: string; userId: string; role: string; permissionsStr: string; cachedAt: string; expiresAt: string; }
export interface DeviceIdRow { id: "singleton"; deviceId: string; createdAt: string; }

export class BusySoftOfflineDb extends Dexie {
  // mirror of domain types
  financialYears!: Table<FinancialYear & { _syncedAt?: string }, string>;
  accounts!: Table<AccountRow, string>;
  vouchers!: Table<VoucherRow, string>;
  voucherLines!: Table<VoucherLineRow, string>;
  ledgerEntries!: Table<LedgerEntryRow, string>;
  stockMovements!: Table<StockMovementRow, string>;
  partyAllocations!: Table<PartyAllocationRow, string>;
  returnDocuments!: Table<ReturnDocumentRow, string>;
  accountingDocuments!: Table<AtomicAccountingDocument, string>;
  auditLogs!: Table<AuditEvent & { _upstreamed?: boolean }, string>;
  businessDocuments!: Table<{ collection: string; businessId: string; docId: string; data: Record<string, unknown>; _syncedAt?: string; }, [string, string, string]>;

  // masters
  businesses!: Table<BusinessRow, string>;
  parties!: Table<PartyMasterRow, string>;
  items!: Table<ItemMasterRow, string>;
  warehouses!: Table<WarehouseRow, string>;
  taxRates!: Table<TaxRateRow, string>;
  settings!: Table<SettingsRow, [string, string]>;

  // sync
  syncOperations!: Table<SyncOperation, number>;
  syncCursors!: Table<SyncCursor, [string, string]>;
  numberReservations!: Table<NumberReservation, number>;
  syncHeartbeats!: Table<{ ts: string; state: string; err?: string }, number>;
  authCache!: Table<AuthCacheRow, [string, string]>;
  deviceId!: Table<DeviceIdRow, string>;
  sequences!: Table<{ businessId: string; financialYearId: string; voucherType: string; next: number; }, [string, string, string]>;

  constructor(dbName: string) {
    super(dbName);
    this.version(1).stores({
      financialYears: "id, businessId",
      accounts: "id, businessId, code, type",
      vouchers: "id, businessId, financialYearId, voucherType, voucherNumber, status, date, [businessId+financialYearId], idempotencyKey",
      voucherLines: "lineId, voucherId, businessId, accountId, partyId",
      ledgerEntries: "lineId, voucherId, businessId, accountId, partyId, financialYearId, date",
      stockMovements: "id, businessId, financialYearId, itemId, warehouseId, direction, sourceId, date",
      partyAllocations: "id, businessId, partyId, fromVoucherId, toVoucherId, idempotencyKey",
      returnDocuments: "id, businessId, financialYearId, voucherId, originalVoucherId, partyId, type",
      accountingDocuments: "id, businessId, financialYearId, type, voucherId, [businessId+financialYearId], idempotencyKey",
      auditLogs: "id, businessId, entityType, entityId, userId, timestamp",
      businessDocuments: "[collection+businessId+docId], collection, businessId",
      businesses: "id",
      parties: "id, businessId, kind, name, gstin, status",
      items: "id, businessId, name, gstRate, status",
      warehouses: "id, businessId, name",
      taxRates: "id, businessId, rate",
      settings: "[key+businessId], key, businessId",
      syncOperations: "++id, &operationId, businessId, financialYearId, deviceId, userId, entityType, entityId, operationType, idempotencyKey, status, retryCount, nextRetryAt, createdAt, [businessId+status]",
      syncCursors: "[collection+businessId], collection, businessId",
      numberReservations: "++id, businessId, financialYearId, voucherType, deviceId, expiresAt",
      syncHeartbeats: "++id, ts, state",
      authCache: "[businessId+userId], businessId, userId, expiresAt",
      deviceId: "", // singleton table (no primary index key; we use id="singleton")
      sequences: "[businessId+financialYearId+voucherType], businessId, financialYearId, voucherType",
    });
  }
}

let _db: BusySoftOfflineDb | null = null;
let _dbUser: string | null = null;
let _dbBusiness: string | null = null;

export function getOfflineDb(userId: string, businessId: string): BusySoftOfflineDb {
  if (!userId || !businessId) throw new ValidationError("User and business context required for offline DB.");
  if (_db && _dbUser === userId && _dbBusiness === businessId) return _db;
  if (_db) { try { _db.close(); } catch { /* ignore */ } _db = null; }
  const safeUid = userId.replace(/[^A-Za-z0-9_-]/g, "_");
  const safeBid = businessId.replace(/[^A-Za-z0-9_-]/g, "_");
  _db = new BusySoftOfflineDb(`busysoft_${safeUid}_${safeBid}`);
  _dbUser = userId;
  _dbBusiness = businessId;
  return _db;
}

export function closeOfflineDb(): void { if (_db) { try { _db.close(); } catch { /* ignore */ } _db = null; _dbUser = null; _dbBusiness = null; } }

/** Per-business, per-transaction. Offline allocate sequence LOCALLY ONLY for LOCAL_ONLY ordering; not authoritative.
 *  Authoritative numbers still come from server. Throws if caller tries to use this for final numbers.
 */
export class SqliteAccountingRepository implements AccountingRepository {
  constructor(private readonly db: BusySoftOfflineDb, private readonly businessId: string) {
    if (!businessId) throw new ValidationError("Business ID required.");
  }
  async runInTransaction<T>(work: (tx: AccountingTransaction) => Promise<T>): Promise<T> {
    const tables: Array<keyof BusySoftOfflineDb> = [
      "financialYears", "accounts", "vouchers", "voucherLines", "ledgerEntries",
      "stockMovements", "partyAllocations", "returnDocuments", "accountingDocuments",
      "auditLogs", "businessDocuments", "sequences", "parties", "items", "accountingDocuments",
    ];
    return this.db.transaction("rw", tables as any, async (dexieTx: Transaction) => {
      const adapter = new SqliteAccountingTransaction(this.db, dexieTx, this.businessId);
      return work(adapter);
    });
  }
}

const assertBiz = (entity: { businessId: string }, businessId: string, name: string) => {
  if (entity.businessId !== businessId) throw new ValidationError(`${name} business mismatch.`);
};

class SqliteAccountingTransaction implements AccountingTransaction {
  constructor(private readonly db: BusySoftOfflineDb, private readonly tx: Transaction, private readonly businessId: string) {}

  private table<T>(name: keyof BusySoftOfflineDb): Table<T, any> { return (this.tx.table as any)(name) as Table<T, any>; }

  async getFinancialYear(id: string) { const r = await this.table<FinancialYear>("financialYears").get(id); return r ?? null; }
  async getAccount(id: string) { const r = await this.table<AccountRow>("accounts").get(id); return r ?? null; }
  async getVoucher(id: string) { const r = await this.table<VoucherRow>("vouchers").get(id); return r ?? null; }
  async getVoucherLines(voucherId: string) {
    const rows = await this.table<VoucherLineRow>("voucherLines").where("voucherId").equals(voucherId).toArray();
    return rows.sort((a, b) => a.lineNo - b.lineNo);
  }
  async getVouchersByReference(referenceType: string, referenceId: string) {
    const rows = await this.table<Voucher>("vouchers")
      .where("[businessId+financialYearId]").anyOf([this.businessId].map(b => [b, ""])).toArray()
      .then(() => this.table<Voucher>("vouchers").toArray());
    return rows.filter(v => v.referenceType === referenceType && v.referenceId === referenceId && v.status === "posted" && v.businessId === this.businessId);
  }
  async getVoucherByIdempotencyKey(businessId: string, financialYearId: string, key: string) {
    if (businessId !== this.businessId) return null;
    const rows = await this.table<VoucherRow>("vouchers").where("idempotencyKey").equals(key).toArray();
    return rows.find(v => v.financialYearId === financialYearId && v.businessId === businessId) ?? null;
  }
  async getAtomicDocumentByIdempotencyKey(businessId: string, financialYearId: string, key: string) {
    if (businessId !== this.businessId) return null;
    const rows = await this.table<AtomicAccountingDocument>("accountingDocuments").where("idempotencyKey").equals(key).toArray();
    return rows.find(d => d.financialYearId === financialYearId && d.businessId === businessId) ?? null;
  }
  async getStockMovementsForSource(sourceId: string) {
    return this.table<StockMovementRow>("stockMovements").where("sourceId").equals(sourceId).toArray();
  }
  async getStockMovementsForItem(itemId: string, warehouseId?: string, throughDate?: string) {
    let rows = await this.table<StockMovementRow>("stockMovements").where("itemId").equals(itemId).toArray();
    const wanted = warehouseId ? normalizeWarehouseId(warehouseId) : undefined;
    return rows
      .filter(m => m.businessId === this.businessId)
      .filter(m => !wanted || normalizeWarehouseId(m.warehouseId) === wanted)
      .filter(m => !throughDate || m.date <= throughDate)
      .sort((a, b) => `${a.date}:${a.createdAt}:${a.id}`.localeCompare(`${b.date}:${b.createdAt}:${b.id}`));
  }
  async getPartyAllocationsForVoucher(voucherId: string) {
    const a = await this.table<PartyAllocationRow>("partyAllocations").where("fromVoucherId").equals(voucherId).toArray();
    const b = await this.table<PartyAllocationRow>("partyAllocations").where("toVoucherId").equals(voucherId).toArray();
    const m = new Map<string, PartyAllocationRow>();
    for (const x of [...a, ...b]) m.set(x.id, x);
    return [...m.values()];
  }
  async getBusinessDocument(name: string, id: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new ValidationError("Invalid business document collection.");
    const row = await this.table<any>("businessDocuments").get([name, this.businessId, id]);
    if (!row) return null;
    const data = row.data || {};
    if (name !== "items") return data;
    let stock = 0; let stockValue = 0;
    const ms = await this.table<StockMovementRow>("stockMovements").where("itemId").equals(id).toArray();
    for (const m of ms) if (m.businessId === this.businessId) {
      const sign = m.direction === "in" ? 1 : -1;
      stock += sign * m.quantity;
      stockValue += sign * (m.value ?? 0);
    }
    return { ...data, stock, stockValue, stockReconciliationSource: "stockMovements" };
  }

  async saveAccount(account: Account) { assertBiz(account, this.businessId, "Account"); validateAccount(account); await this.table<AccountRow>("accounts").put(account as AccountRow); }
  async saveVoucher(voucher: Voucher) { assertBiz(voucher, this.businessId, "Voucher"); await this.table<VoucherRow>("vouchers").put(voucher as VoucherRow); }
  async saveVoucherLines(lines: VoucherLine[]) { for (const l of lines) { assertBiz(l, this.businessId, "VoucherLine"); await this.table<VoucherLineRow>("voucherLines").put(l as VoucherLineRow); } }
  async saveLedgerEntries(entries: LedgerEntry[]) { for (const l of entries) { assertBiz(l, this.businessId, "LedgerEntry"); await this.table<LedgerEntryRow>("ledgerEntries").put(l as LedgerEntryRow); } }
  async saveStockMovements(lines: StockMovement[]) { for (const l of lines) { assertBiz(l, this.businessId, "StockMovement"); await this.table<StockMovementRow>("stockMovements").put(l as StockMovementRow); } }
  async savePartyAllocations(lines: PartyAllocation[]) { for (const l of lines) { assertBiz(l, this.businessId, "PartyAllocation"); await this.table<PartyAllocationRow>("partyAllocations").put(l as PartyAllocationRow); } }
  async saveReturnDocument(v: ReturnDocument) { assertBiz(v, this.businessId, "ReturnDocument"); await this.table<ReturnDocumentRow>("returnDocuments").put(v as ReturnDocumentRow); }
  async saveAtomicDocument(v: AtomicAccountingDocument) { assertBiz(v, this.businessId, "AtomicAccountingDocument"); await this.table<AtomicAccountingDocument>("accountingDocuments").put(v); }
  async saveBusinessDocument(name: string, id: string, data: Record<string, unknown>) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(name) || !id) throw new ValidationError("Invalid business document reference.");
    if (String(data.businessId ?? "") !== this.businessId) throw new ValidationError("Business document business mismatch.");
    await this.table<any>("businessDocuments").put({ collection: name, businessId: this.businessId, docId: id, data, _syncedAt: new Date().toISOString() });
  }
  async saveAuditEvent(v: AuditEvent) { assertBiz(v, this.businessId, "AuditEvent"); await this.table<AuditEvent>("auditLogs").put(v); }
  async allocateVoucherNumber(_input: { businessId: string; financialYearId: string; voucherType: string; prefix?: string }) {
    // OFFLINE AUDIT RULE T.8: NEVER allocate authoritative numbers client-side.
    // Instead, return a PENDING display number. Authoritative number comes from server.
    // Caller can then display `PREFIX-PENDING-{localSeq}` in UI until synced.
    throw new ValidationError("Authoritative voucher numbers are server-controlled. Use reserve-voucher-numbers API when online, or PENDING display numbers locally.");
  }
}
