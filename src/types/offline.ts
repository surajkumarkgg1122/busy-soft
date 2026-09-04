// Offline / Sync types. Business status (DRAFT/POSTED/CANCELLED/REVERSED) lives in core/types.
// These are synchronization lifecycle metadata only; NEVER used to branch domain accounting logic.

export type SyncStatus = "LOCAL_ONLY" | "PENDING" | "SYNCING" | "SYNCED" | "FAILED" | "CONFLICT" | "BLOCKED";

export type NetState = "unknown" | "online" | "offline" | "server_unreachable";

export type ErrorClass = "TRANSIENT" | "AUTHORIZATION" | "VALIDATION" | "CONFLICT" | "PERMANENT";

export type AccountingCommandName =
  | "SALE_CREATE" | "PURCHASE_CREATE" | "RETURN_CREATE"
  | "RECEIPT_CREATE" | "PAYMENT_CREATE" | "CONTRA_CREATE"
  | "JOURNAL_CREATE" | "EXPENSE_CREATE"
  | "MASTER_PARTY_UPSERT" | "MASTER_ITEM_UPSERT"
  | "MASTER_WAREHOUSE_UPSERT" | "DOC_CANCEL" | "DOC_REVERSE";

export interface SyncConflictMeta {
  serverUpdatedAt: string;
  localUpdatedAt: string;
  entityType: string;
  entityId: string;
  serverDocJson?: string;
  localDocJson?: string;
  fieldMask?: string[];
}

export interface SyncOperation<TPayload = unknown> {
  id?: number;
  operationId: string;
  commandId: AccountingCommandName | string;
  businessId: string;
  financialYearId: string;
  deviceId: string;
  userId: string;
  entityType: string;
  entityId: string;
  operationType: "CREATE" | "UPDATE" | "DELETE" | "CANCEL" | "REVERSE";
  idempotencyKey: string;
  payloadFingerprint: string;
  payload: TPayload;
  localSequence: number;
  createdAt: string;
  syncedAt?: string;
  lastAttemptAt?: string;
  lastError?: string;
  lastErrorClass?: ErrorClass;
  serverAckHttp?: number;
  serverAckBody?: string;
  status: SyncStatus;
  retryCount: number;
  nextRetryAt?: string;
  dependsOnOperationIds: string[];
  conflictMeta?: SyncConflictMeta;
  reservedNumberInfo?: {
    voucherType: string;
    reservedBlockFirst?: string;
    reservedBlockLast?: string;
    reservedLocalNumber?: string;
  };
}

export interface SyncCursor {
  collection: string;
  businessId: string;
  lastDocId: string;
  checkpoint: string;
}

export interface SyncAggregate {
  net: NetState;
  heartbeat: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncAttemptAt: string | null;
  lastSyncError: string | null;
  counts: Record<Exclude<SyncStatus, never>, number> & { pending: number; syncing: number; failed: number; conflict: number; blocked: number; synced: number; localOnly: number; };
  flushInProgress: boolean;
  flushProgressPercent: number;
}

export interface NumberReservation {
  id?: number;
  businessId: string;
  financialYearId: string;
  voucherType: string;
  prefix: string;
  first: number;
  last: number;
  cursor: number;
  claimedAt: string;
  expiresAt: string;
  deviceId: string;
}
