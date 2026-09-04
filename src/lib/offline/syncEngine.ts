// Sync Engine: durable queue, error classification, dependency ordering, exponential backoff, crash recovery.
// Writes everything into Dexie. Network calls go to existing API routes (per /src/app/api/**/route.ts).
import type { ErrorClass, SyncAggregate, SyncConflictMeta, SyncOperation, SyncStatus } from "@/types/offline";
import { ApplicationClock, createIds, generateIdempotencyKey, fingerprintPayload } from "@/core/accounting/idempotency";
import { closeOfflineDb, BusySoftOfflineDb, getOfflineDb } from "@/lib/offline/sqliteAccountingRepository";

const BACKOFF_BASE_MS = 2000;
const BACKOFF_CAP_MS = 30_000;
const MAX_RETRIES = 15;
const STALE_SYNCING_MS = 5 * 60 * 1000;

export const OFFLINE_ALLOWED_COMMANDS: ReadonlySet<string> = new Set([
  "SALE_CREATE", "PURCHASE_CREATE", "RETURN_CREATE",
  "RECEIPT_CREATE", "PAYMENT_CREATE", "CONTRA_CREATE",
  "JOURNAL_CREATE", "EXPENSE_CREATE",
  "MASTER_PARTY_UPSERT", "MASTER_ITEM_UPSERT", "MASTER_WAREHOUSE_UPSERT",
  "DOC_CANCEL", "DOC_REVERSE",
]);

export function classifyApplicationError(err: unknown): ErrorClass {
  if (!err) return "TRANSIENT";
  const code = String((err as any).code || (err as any).name || "").toLowerCase();
  const msg = String((err as any).message || err || "").toLowerCase();
  if (/permission|authorization|unauthorized|forbidden|401|403/.test(msg + code)) return "AUTHORIZATION";
  if (/validation|invalid|business|financial.?year|locked|mismatch|negative.?stock|409|422/.test(msg + code) || code === "validationerror") return "VALIDATION";
  if (/conflict|version|optimistic|already.?exists|409/.test(msg + code)) return "CONFLICT";
  if (/network|offline|timeout|cors|failed.?to.?fetch|econnreset|502|503|504|5\d\d/.test(msg + code)) return "TRANSIENT";
  return "PERMANENT";
}

const retryable: ErrorClass[] = ["TRANSIENT"];

export interface SyncWorkerOptions {
  userId: string;
  businessId: string;
  apiBase?: string;
  authTokenFetcher: () => Promise<string | null>;
  onStateChange?: (agg: SyncAggregate) => void;
  isServerReachable?: () => Promise<boolean>;
}

export class SyncWorker {
  private readonly opts: SyncWorkerOptions;
  private db: BusySoftOfflineDb;
  private flushTimer: any = null;
  private flushInProgress = false;
  private deviceId: string = "";
  private lastHeartbeat: string | null = null;
  private lastSuccessfulSyncAt: string | null = null;
  private lastSyncAttemptAt: string | null = null;
  private lastSyncError: string | null = null;
  private isOnline: "unknown" | "online" | "offline" | "server_unreachable" = "unknown";

  constructor(opts: SyncWorkerOptions, db?: BusySoftOfflineDb) {
    this.opts = opts;
    this.db = db ?? getOfflineDb(opts.userId, opts.businessId);
  }

  async init(): Promise<void> {
    const row = await this.db.deviceId.get("singleton");
    this.deviceId = row?.deviceId ?? `DEV-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    if (!row) {
      await this.db.deviceId.add({ id: "singleton", deviceId: this.deviceId, createdAt: new Date().toISOString() });
    }
    await this.crashRecoveryReset();
  }

  getDb(): BusySoftOfflineDb { return this.db; }
  getDeviceId(): string { return this.deviceId; }

  async enqueue<TPayload>(input: {
    commandId: string;
    entityType: string;
    entityId: string;
    operationType: SyncOperation["operationType"];
    payload: TPayload;
    idempotencyKey?: string;
    financialYearId: string;
    dependsOnOperationIds?: string[];
    reservedNumberInfo?: SyncOperation["reservedNumberInfo"];
  }): Promise<SyncOperation<TPayload>> {
    if (!OFFLINE_ALLOWED_COMMANDS.has(input.commandId)) {
      throw new Error(`Command ${input.commandId} cannot be created offline. Security policy: this command must execute online.`);
    }
    const fingerprint = await fingerprintPayload(input.payload);
    const idem = input.idempotencyKey ?? generateIdempotencyKey(`${input.commandId}:${input.entityId}:${fingerprint.slice(0, 12)}`, ApplicationClock.now());
    const operationId = `${this.opts.businessId}:${this.opts.userId}:${this.deviceId}:${ApplicationClock.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [maxSeq] = await Promise.all([
      this.db.syncOperations
        .where("businessId").equals(this.opts.businessId)
        .sortBy("localSequence")
        .then(arr => arr.length > 0 ? arr[arr.length - 1].localSequence : 0),
    ]);
    const op: SyncOperation<TPayload> = {
      operationId,
      commandId: input.commandId,
      businessId: this.opts.businessId,
      financialYearId: input.financialYearId,
      deviceId: this.deviceId,
      userId: this.opts.userId,
      entityType: input.entityType,
      entityId: input.entityId,
      operationType: input.operationType,
      idempotencyKey: idem,
      payloadFingerprint: fingerprint,
      payload: input.payload,
      localSequence: maxSeq + 1,
      createdAt: new Date().toISOString(),
      status: "PENDING",
      retryCount: 0,
      dependsOnOperationIds: input.dependsOnOperationIds ?? [],
      reservedNumberInfo: input.reservedNumberInfo,
    };
    const id = await this.db.syncOperations.add(op as any);
    op.id = id as number;
    this.scheduleFlush(100);
    this.emitChange();
    return op;
  }

  scheduleFlush(delayMs = BACKOFF_BASE_MS): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush().catch(() => {}), delayMs);
  }

  async crashRecoveryReset(): Promise<void> {
    // Any operation stuck in SYNCING for > STALE_SYNCING_MS → reset to PENDING (idempotency-safe replay)
    const now = Date.now();
    const stale = await this.db.syncOperations
      .where("status").equals("SYNCING")
      .filter(o => !o.lastAttemptAt || (now - new Date(o.lastAttemptAt).getTime()) > STALE_SYNCING_MS)
      .toArray();
    for (const o of stale) {
      await this.db.syncOperations.update(o.id!, { status: "PENDING", lastError: undefined, lastErrorClass: undefined, serverAckBody: undefined, serverAckHttp: undefined, nextRetryAt: undefined, retryCount: o.retryCount, lastAttemptAt: new Date().toISOString() });
    }
    this.emitChange();
  }

  private commandEndpoint(commandId: string, entityId?: string): string {
    const id = entityId || "new";
    switch (commandId) {
      case "SALE_CREATE": return "/api/accounting/sales";
      case "PURCHASE_CREATE": return "/api/accounting/purchases";
      case "EXPENSE_CREATE": return "/api/accounting/expenses";
      case "RECEIPT_CREATE": return "/api/accounting/receipts";
      case "PAYMENT_CREATE": return "/api/accounting/payments";
      case "JOURNAL_CREATE": return "/api/accounting/journals";
      case "CONTRA_CREATE": return "/api/accounting/contras";
      case "RETURN_CREATE": return "/api/accounting/returns";
      case "DOC_CANCEL": return `/api/accounting/vouchers/${id}/cancel`;
      case "DOC_REVERSE": return `/api/accounting/vouchers/${id}/reverse`;
      case "MASTER_PARTY_UPSERT": return "/api/parties";
      case "MASTER_ITEM_UPSERT": return "/api/item-masters";
      case "MASTER_WAREHOUSE_UPSERT": return "/api/warehouses";
      default:
        throw new Error(`Unknown sync command: ${commandId}`);
    }
  }

  private async fetchJson(method: string, endpoint: string, body?: unknown): Promise<{ ok: boolean; status: number; body: any }> {
    const token = await this.opts.authTokenFetcher();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const base = this.opts.apiBase ?? "";
    let res: Response;
    try {
      res = await fetch(base + endpoint, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
    } catch (e) {
      return { ok: false, status: 0, body: { message: String((e as Error).message || e), name: "NetworkError" } };
    }
    let parsed: any;
    try { parsed = await res.json(); } catch { parsed = { message: await res.text() }; }
    return { ok: res.ok, status: res.status, body: parsed };
  }

  private async runSingle(op: SyncOperation): Promise<void> {
    if (!this.db.isOpen()) return;
    try {
      await this.db.syncOperations.update(op.id!, { status: "SYNCING", lastAttemptAt: new Date().toISOString(), retryCount: op.retryCount + 1 });
      const endpoint = this.commandEndpoint(op.commandId, op.entityId);
      const method = (op.commandId === "DOC_CANCEL" || op.commandId === "DOC_REVERSE") ? "POST"
        : (op.operationType === "UPDATE" ? "PUT" : op.operationType === "DELETE" ? "DELETE" : "POST");
      const body: any = typeof op.payload === "string" ? JSON.parse(op.payload as any) : op.payload;
      // Attach idempotency header so server replays safely if duplicate.
      body.idempotencyKey = op.idempotencyKey;
      body._syncOperationId = op.operationId;
      body._deviceId = this.deviceId;
      const r = await this.fetchJson(method, endpoint, body);
      const now = new Date().toISOString();
      if (r.ok) {
        await this.db.syncOperations.update(op.id!, {
          status: "SYNCED", syncedAt: now, serverAckHttp: r.status, serverAckBody: typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}).slice(0, 4000), lastError: undefined, lastErrorClass: undefined, nextRetryAt: undefined,
        });
        this.lastSuccessfulSyncAt = now;
        return;
      }
      const errClass = classifyApplicationError(r.body ?? { status: r.status, message: `HTTP ${r.status}` });
      const message = r.body?.error || r.body?.message || r.body?.title || `HTTP ${r.status}`;
      if (errClass === "AUTHORIZATION" || errClass === "VALIDATION" || errClass === "CONFLICT" || errClass === "PERMANENT") {
        const status: SyncStatus = errClass === "CONFLICT" ? "CONFLICT" : "BLOCKED";
        const conflictMeta: SyncConflictMeta | undefined = errClass === "CONFLICT" ? {
          serverUpdatedAt: now, localUpdatedAt: op.createdAt, entityType: op.entityType, entityId: op.entityId, serverDocJson: typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}).slice(0, 4000),
        } : undefined;
        await this.db.syncOperations.update(op.id!, {
          status, lastError: message.slice(0, 1000), lastErrorClass: errClass, serverAckHttp: r.status, serverAckBody: typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {}).slice(0, 4000), conflictMeta,
        });
        return;
      }
      // TRANSIENT (default fallback)
      if (op.retryCount + 1 >= MAX_RETRIES) {
        await this.db.syncOperations.update(op.id!, { status: "FAILED", lastError: `${message} (${op.retryCount + 1} retries)`.slice(0, 1000), lastErrorClass: errClass });
        return;
      }
      const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, op.retryCount));
      const next = new Date(Date.now() + backoff).toISOString();
      await this.db.syncOperations.update(op.id!, {
        status: "PENDING", lastError: message.slice(0, 1000), lastErrorClass: errClass, nextRetryAt: next,
      });
    } catch (e) {
      const errClass = classifyApplicationError(e);
      if (!retryable.includes(errClass) || op.retryCount + 1 >= MAX_RETRIES) {
        await this.db.syncOperations.update(op.id!, {
          status: errClass === "CONFLICT" ? "CONFLICT" : (retryable.includes(errClass) ? "FAILED" : "BLOCKED"),
          lastError: String((e as Error).message || e).slice(0, 1000), lastErrorClass: errClass,
        });
        return;
      }
      const backoff = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * Math.pow(2, op.retryCount));
      await this.db.syncOperations.update(op.id!, {
        status: "PENDING", nextRetryAt: new Date(Date.now() + backoff).toISOString(), lastError: String((e as Error).message || e).slice(0, 1000), lastErrorClass: errClass,
      });
    }
  }

  async flush(force = false): Promise<SyncAggregate> {
    if (this.flushInProgress) return this.currentAggregate();
    this.flushInProgress = true;
    this.lastSyncAttemptAt = new Date().toISOString();
    try {
      // Reachability: quick heartbeat
      const reachable = this.opts.isServerReachable ? await this.opts.isServerReachable() : await this.pingHeartbeat();
      this.isOnline = reachable ? "online" : "server_unreachable";
      if (!reachable && !force) return this.currentAggregate();

      // Fetch pending whose dependencies are done.
      const all = await this.db.syncOperations.where("businessId").equals(this.opts.businessId).toArray();
      const syncedIds = new Set(all.filter(o => o.status === "SYNCED").map(o => o.operationId));
      const nowIso = new Date().toISOString();
      const runnable = all.filter(o => {
        if (o.status !== "PENDING" && !(o.status === "FAILED" && retryable.includes(o.lastErrorClass || "TRANSIENT"))) return false;
        if (o.nextRetryAt && o.nextRetryAt > nowIso && !force) return false;
        for (const dep of o.dependsOnOperationIds) if (!syncedIds.has(dep) && dep !== o.operationId) return false;
        return true;
      });
      runnable.sort((a, b) => (a.localSequence - b.localSequence) || a.createdAt.localeCompare(b.createdAt));
      if (runnable.length === 0) return this.emitChange();
      // Sequential within same entity, independent across non-conflicting. To keep correctness, process in FIFO single-file per business.
      for (const op of runnable) { await this.runSingle(op); syncedIds.add(op.operationId); this.lastSyncError = null; }
      return this.emitChange();
    } catch (e) {
      this.lastSyncError = String((e as Error).message || e).slice(0, 500);
      this.isOnline = "server_unreachable";
      return this.emitChange();
    } finally {
      this.flushInProgress = false;
    }
  }

  private async pingHeartbeat(): Promise<boolean> {
    try {
      const r = await this.fetchJson("GET", "/api/heartbeat");
      if (r.ok) { this.lastHeartbeat = new Date().toISOString(); return true; }
      return false;
    } catch { return false; }
  }

  async manualRetry(operationIds: string[]): Promise<void> {
    const now = new Date().toISOString();
    for (const oid of operationIds) {
      const op = await this.db.syncOperations.where("operationId").equals(oid).first();
      if (!op) continue;
      await this.db.syncOperations.update(op.id!, {
        status: "PENDING", nextRetryAt: now, lastError: undefined, lastErrorClass: undefined, retryCount: 0,
      });
    }
    this.scheduleFlush(50);
    this.emitChange();
  }

  currentAggregate(): SyncAggregate {
    // Returned via emitChange; counts populated by caller-query
    return {
      net: this.isOnline,
      heartbeat: this.lastHeartbeat,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      lastSyncAttemptAt: this.lastSyncAttemptAt,
      lastSyncError: this.lastSyncError,
      counts: { pending: 0, syncing: 0, failed: 0, conflict: 0, blocked: 0, synced: 0, localOnly: 0, LOCAL_ONLY: 0, PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0, BLOCKED: 0, },
      flushInProgress: this.flushInProgress,
      flushProgressPercent: 0,
    };
  }

  private async emitChange(): Promise<SyncAggregate> {
    const rows = await this.db.syncOperations.where("businessId").equals(this.opts.businessId).toArray();
    const counts = { pending: 0, syncing: 0, failed: 0, conflict: 0, blocked: 0, synced: 0, localOnly: 0, LOCAL_ONLY: 0, PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0, BLOCKED: 0 };
    for (const r of rows) {
      switch (r.status) {
        case "LOCAL_ONLY": counts.localOnly++; counts.LOCAL_ONLY++; break;
        case "PENDING": counts.pending++; counts.PENDING++; break;
        case "SYNCING": counts.syncing++; counts.SYNCING++; break;
        case "SYNCED": counts.synced++; counts.SYNCED++; break;
        case "FAILED": counts.failed++; counts.FAILED++; break;
        case "CONFLICT": counts.conflict++; counts.CONFLICT++; break;
        case "BLOCKED": counts.blocked++; counts.BLOCKED++; break;
      }
    }
    const agg: SyncAggregate = {
      net: this.isOnline,
      heartbeat: this.lastHeartbeat,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      lastSyncAttemptAt: this.lastSyncAttemptAt,
      lastSyncError: this.lastSyncError,
      counts,
      flushInProgress: this.flushInProgress,
      flushProgressPercent: (counts.pending + counts.syncing) === 0 ? 100 : Math.max(0, Math.min(100, Math.round((counts.synced / (counts.synced + counts.pending + counts.syncing + counts.failed + counts.conflict + counts.blocked || 1)) * 100))),
    };
    this.opts.onStateChange?.(agg);
    return agg;
  }

  async markConflictResolved(operationId: string, resolution: "keep-server" | "keep-local" | "retry-after-edit", localPayload?: any): Promise<void> {
    const op = await this.db.syncOperations.where("operationId").equals(operationId).first();
    if (!op) return;
    if (resolution === "keep-server") {
      await this.db.syncOperations.update(op.id!, { status: "SYNCED", syncedAt: new Date().toISOString(), lastError: "Resolved: keep server", conflictMeta: undefined });
    } else if (resolution === "keep-local" && localPayload !== undefined) {
      const fp = await fingerprintPayload(localPayload);
      await this.db.syncOperations.update(op.id!, {
        status: "PENDING", retryCount: 0, lastError: undefined, conflictMeta: undefined, nextRetryAt: new Date().toISOString(), payload: localPayload, payloadFingerprint: fp,
      });
    } else {
      await this.db.syncOperations.update(op.id!, { status: "PENDING", retryCount: 0, nextRetryAt: new Date().toISOString(), conflictMeta: undefined, lastError: undefined });
    }
    this.scheduleFlush(50);
    this.emitChange();
  }

  dispose() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    closeOfflineDb();
  }
}

export function nextLocalPendingNumber(voucherType: string, localSeq: number, deviceId: string): string {
  // §10: Device-local pending numbers, clearly distinguishable from final authoritative numbers.
  // Final server format: {TYPE}/{FY}/{N} . Offline format: P-{DEV_SHORT}-{seq}. Clearly PENDING.
  const short = deviceId.replace(/^DEV-/, "").slice(0, 4);
  return `P-${short}-${localSeq.toString().padStart(5, "0")} [${voucherType.toUpperCase()} PENDING]`;
}

export const Ids = { create: createIds };
