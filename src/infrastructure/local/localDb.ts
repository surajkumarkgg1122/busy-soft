import Dexie, { type Table } from "dexie";

export type LocalRow = Record<string, unknown> & { id: string; businessId?: string; financialYearId?: string };

export interface SyncOperationRow extends LocalRow {
  operationId: string;
  commandId: string;
  entityType: string;
  entityId?: string;
  commandType: string;
  payload: Record<string, unknown>;
  payloadFingerprint?: string;
  status: "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT" | "BLOCKED";
  retryCount: number;
  nextAttemptAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  errorClass?: "TRANSIENT" | "AUTHORIZATION" | "VALIDATION" | "CONFLICT" | "PERMANENT";
  createdAt: string;
  updatedAt: string;
  serverAcknowledgedAt?: string;
  serverResult?: Record<string, unknown>;
  dependencies?: string[];
  deviceId: string;
}

export interface SyncAttemptRow extends LocalRow {
  operationId: string;
  attemptNo: number;
  startedAt: string;
  finishedAt?: string;
  outcome: "SUCCESS" | "RETRY" | "FAILED" | "CONFLICT" | "BLOCKED";
  errorClass?: SyncOperationRow["errorClass"];
  errorMessage?: string;
  serverRequestId?: string;
}

export interface ConflictRow extends LocalRow {
  operationId: string;
  entityType: string;
  entityId?: string;
  localVersion?: string;
  serverVersion?: string;
  reason: string;
  localPayload?: Record<string, unknown>;
  serverPayload?: Record<string, unknown>;
  status: "OPEN" | "RESOLVED";
  createdAt: string;
  resolvedAt?: string;
}

export interface SyncCheckpointRow extends LocalRow {
  scope: string;
  cursor?: string;
  serverTimestamp?: string;
  updatedAt: string;
}

export interface LocalTransactionRow extends LocalRow {
  entityType: string;
  entityId: string;
  lifecycle: "DRAFT" | "POSTED" | "CANCELLED" | "REVERSED";
  syncStatus: "LOCAL_ONLY" | "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT";
  localUpdatedAt: string;
  serverUpdatedAt?: string;
}

export class BusySoftLocalDB extends Dexie {
  businesses!: Table<LocalRow, string>;
  financialYears!: Table<LocalRow, string>;
  users!: Table<LocalRow, string>;
  accounts!: Table<LocalRow, string>;
  parties!: Table<LocalRow, string>;
  items!: Table<LocalRow, string>;
  units!: Table<LocalRow, string>;
  warehouses!: Table<LocalRow, string>;
  taxConfigurations!: Table<LocalRow, string>;
  vouchers!: Table<LocalRow, string>;
  voucherLines!: Table<LocalRow, string>;
  ledgerEntries!: Table<LocalRow, string>;
  stockMovements!: Table<LocalRow, string>;
  partyAllocations!: Table<LocalRow, string>;
  returnDocuments!: Table<LocalRow, string>;
  accountingDocuments!: Table<LocalRow, string>;
  auditLogs!: Table<LocalRow, string>;
  localTransactions!: Table<LocalTransactionRow, string>;
  syncOperations!: Table<SyncOperationRow, string>;
  syncAttempts!: Table<SyncAttemptRow, string>;
  conflicts!: Table<ConflictRow, string>;
  syncCheckpoints!: Table<SyncCheckpointRow, string>;
  projections!: Table<LocalRow, string>;

  constructor() {
    super("busy-soft-local");
    this.version(1).stores({
      businesses: "id,businessId",
      financialYears: "id,businessId,financialYearId,[businessId+id]",
      users: "id,businessId",
      accounts: "id,businessId,code,[businessId+id]",
      parties: "id,businessId,[businessId+id]",
      items: "id,businessId,[businessId+id]",
      units: "id,businessId,[businessId+id]",
      warehouses: "id,businessId,[businessId+id]",
      taxConfigurations: "id,businessId,[businessId+id]",
      vouchers: "id,businessId,financialYearId,idempotencyKey,[businessId+financialYearId],[businessId+financialYearId+idempotencyKey]",
      voucherLines: "id,businessId,voucherId,[businessId+voucherId]",
      ledgerEntries: "id,businessId,financialYearId,voucherId,[businessId+financialYearId]",
      stockMovements: "id,businessId,financialYearId,sourceId,itemId,[businessId+itemId]",
      partyAllocations: "id,businessId,partyId,fromVoucherId,toVoucherId,[businessId+partyId]",
      returnDocuments: "id,businessId,financialYearId,voucherId,originalVoucherId,[businessId+financialYearId]",
      accountingDocuments: "id,businessId,financialYearId,idempotencyKey,[businessId+financialYearId+idempotencyKey]",
      auditLogs: "id,businessId,entityType,entityId,[businessId+entityType+entityId]",
      localTransactions: "id,businessId,financialYearId,entityType,entityId,syncStatus,[businessId+financialYearId]",
      syncOperations: "operationId,commandId,businessId,financialYearId,status,nextAttemptAt,createdAt,[businessId+financialYearId+status]",
      syncAttempts: "id,operationId,businessId,createdAt",
      conflicts: "id,operationId,businessId,status,createdAt,[businessId+status]",
      syncCheckpoints: "id,businessId,scope,[businessId+scope]",
      projections: "id,businessId,financialYearId,type,[businessId+financialYearId]",
    });
  }
}

export const localDb = typeof window === "undefined" ? null : new BusySoftLocalDB();

export function requireLocalDb(): BusySoftLocalDB {
  if (!localDb) throw new Error("Local persistence is only available in the browser runtime.");
  return localDb;
}
