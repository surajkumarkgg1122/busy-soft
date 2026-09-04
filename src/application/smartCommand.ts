"use client";
import { ApplicationClock } from "@/core/accounting/idempotency";
import type { SyncOperation } from "@/types/offline";
import { useSync, OFFLINE_ALLOWED_COMMANDS } from "@/context/SyncContext";
import { useBusiness } from "@/context/BusinessContext";
import { nextLocalPendingNumber } from "@/lib/offline/syncEngine";
import type { CommandResult } from "@/application/core";
import type { SaleEntryInput, PurchaseEntryInput, ExpenseEntryInput, PaymentInput, ReceiptInput, JournalEntryInput, ReturnEntryInput } from "@/core/accounting/types";

type InputPayload =
  | SaleEntryInput | PurchaseEntryInput | ExpenseEntryInput
  | PaymentInput | ReceiptInput | JournalEntryInput | ReturnEntryInput
  | Record<string, any>;

export interface SmartCommandArgs {
  commandId:
    | "SALE_CREATE" | "PURCHASE_CREATE" | "RETURN_CREATE"
    | "RECEIPT_CREATE" | "PAYMENT_CREATE" | "CONTRA_CREATE"
    | "JOURNAL_CREATE" | "EXPENSE_CREATE"
    | "MASTER_PARTY_UPSERT" | "MASTER_ITEM_UPSERT" | "MASTER_WAREHOUSE_UPSERT"
    | "DOC_CANCEL" | "DOC_REVERSE";
  endpoint: string;
  entityType: string;
  entityId: string;
  financialYearId: string;
  operationType: SyncOperation["operationType"];
  payload: InputPayload;
  idempotencyKey?: string;
  dependsOnOperationIds?: string[];
  /** Online fetch auth headers (injected by BusinessContext). */
  headers?: Record<string, string>;
  /** Optional override: force offline path even if online (for testing). */
  forceOffline?: boolean;
}

/**
 * Unified application command dispatcher.
 *
 * IF ONLINE: POST to canonical API route (server admin repository → authoritative).
 * IF OFFLINE (or cannot reach server + command is whitelisted):
 *   1) LOCAL → run the EXACT SAME Application/domain engine against Dexie repository.
 *   2) ENQUEUE → durable sync operation record; will be submitted on reconnect with same idempotencyKey.
 *
 * Result is always a CommandResult for caller code parity.
 *
 * CONTRACT:
 * - Never duplicates domain logic. Offline uses same executeXxx with swapped repo.
 * - Server ALWAYS re-validates EVERYTHING on sync (see §16). Local "success" is provisional.
 */
export async function dispatchSmartCommand(args: SmartCommandArgs): Promise<CommandResult<any> & { _mode: "online" | "offline"; _localOnly?: boolean; _syncOp?: SyncOperation }> {
  const { net, enqueueCommand, aggregate, permissionCacheValid, cachedRole } = useSync_readonlySnapshot();
  const { activeBusinessId } = useBusiness();
  const allowOffline = OFFLINE_ALLOWED_COMMANDS.has(args.commandId);
  const online = (net === "online" || (!permissionCacheValid && net === "unknown"));
  const goOffline = args.forceOffline || (!online && allowOffline);

  if (!goOffline) {
    // Online path: trust server-administered authoritative result.
    const res = await fetch(args.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(args.headers || {}) },
      body: JSON.stringify({ ...args.payload, idempotencyKey: args.idempotencyKey }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ...(data?.result || data?.value || data || {}), success: true, idempotencyKey: args.idempotencyKey ?? "", _mode: "online" };
    }
    if (allowOffline && res.status >= 500) {
      // Transient server errors can fall back to offline, not block user.
      return executeOfflineAndEnqueue(args);
    }
    const text = await res.text().catch(() => String(res.status));
    throw new Error(`Server error (HTTP ${res.status}): ${text.slice(0, 500)}`);
  }

  if (!permissionCacheValid) {
    // Security: even if offline, we refuse write operations if permission cache expired (>24h).
    throw new Error("Authorization cache expired. Reconnect to verify permissions before posting.");
  }
  // Basic role sanity guard even if offline (server will re-verify on sync).
  if (args.commandId.startsWith("MASTER_") && cachedRole !== "owner" && cachedRole !== "admin" && cachedRole !== "accountant" && cachedRole !== "manager") {
    throw new Error("Insufficient permission (offline cache).");
  }

  void aggregate; // keep reference for type check
  void activeBusinessId;
  return executeOfflineAndEnqueue(args);
}

// Lightweight synchronous snapshot getter (keeps dispatchSmartCommand usable outside React via module-scoped singleton bridge).
let lastSyncSnapshot: any = null;
export function setLastSyncSnapshot(snap: any) { lastSyncSnapshot = snap; }
export function useSync_readonlySnapshot() {
  // If called from within component: prefer useSync hook; fallback to module snapshot.
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return require("@/context/SyncContext").useSync();
  } catch { return lastSyncSnapshot || { net: "unknown", enqueueCommand: null, aggregate: { counts: {} }, permissionCacheValid: false, cachedRole: "staff" }; }
}

async function executeOfflineAndEnqueue(args: SmartCommandArgs): Promise<any> {
  if (typeof window === "undefined") throw new Error("Offline command is browser-only.");
  const { userId, businessId, firestoreDb } = getSession();
  if (!userId || !businessId) throw new Error("Session required for offline operations.");

  // 1) Execute locally via the shared Application Layer + Dexie(SQLite) repository.
  const { openOfflineRepositoryForCurrentSession } = await import("@/infrastructure/repositoryFactory");
  const { repo, db } = await openOfflineRepositoryForCurrentSession(userId, businessId);
  const ids = { newId: (hint?: string) => `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}${hint ? "_" + hint : ""}` };
  const clock = ApplicationClock;
  const ctx: any = {
    businessId, userId, idempotencyKey: args.idempotencyKey ?? "",
    financialYearId: args.financialYearId, activeFinancialYearId: args.financialYearId,
    permissions: {}, role: "owner", businessPermissions: {},
  };
  const deps: any = { repo, ids, clock };
  let value: any;
  try {
    value = await dispatchDomainExecute(args.commandId, deps, ctx, args.payload);
  } catch (e: any) {
    // Local validation failed → same as online, throw before enqueueing.
    throw new Error(String(e.message || e));
  }

  // 2) Enqueue durable sync operation with same idempotencyKey → sync worker replays when online.
  if (enqueueCommand_fn()) {
    const deviceRow = await db.deviceId.get("singleton");
    const operation = await enqueueCommand_fn()!({
      commandId: args.commandId,
      entityType: args.entityType,
      entityId: args.entityId,
      operationType: args.operationType,
      payload: args.payload,
      idempotencyKey: ctx.idempotencyKey,
      financialYearId: args.financialYearId,
      dependsOnOperationIds: args.dependsOnOperationIds ?? [],
      reservedNumberInfo: args.commandId.endsWith("_CREATE") && value?.voucher ? {
        voucherType: value.voucher.voucherType,
        reservedLocalNumber: nextLocalPendingNumber(value.voucher.voucherType, Date.now() & 0xfffff, deviceRow?.deviceId || "LOCAL"),
      } : undefined,
    });
    // 3) Merge local sync status overlay onto voucher (if any) so UI badges can display LOCAL_ONLY.
    if (value?.voucher) {
      try {
        const existing = await db.vouchers.get(String(value.voucher.id));
        if (existing) {
          await db.vouchers.update(String(value.voucher.id), { _syncStatus: operation.status, _localSeq: operation.localSequence });
        }
      } catch { /* ignore */ }
    }
    void firestoreDb;
    return { value, success: true, idempotencyKey: ctx.idempotencyKey, _mode: "offline", _localOnly: true, _syncOp: operation };
  }
  void firestoreDb;
  return { value, success: true, idempotencyKey: ctx.idempotencyKey, _mode: "offline", _localOnly: true };
}

function enqueueCommand_fn(): any {
  const s = lastSyncSnapshot;
  return s?.enqueueCommand ?? null;
}

function getSession() {
  try {
    const anyWin: any = window;
    return {
      userId: anyWin.__BUSYSOFT_SESSION__?.uid ?? null,
      businessId: anyWin.__BUSYSOFT_SESSION__?.businessId ?? null,
      firestoreDb: anyWin.__BUSYSOFT_SESSION__?.firestoreDb ?? null,
    };
  } catch { return { userId: null, businessId: null, firestoreDb: null }; }
}

async function dispatchDomainExecute(commandId: string, deps: any, ctx: any, payload: any): Promise<any> {
  const mdl = await import("@/application/core");
  switch (commandId) {
    case "SALE_CREATE": return mdl.executeSale(deps, ctx, payload);
    case "PURCHASE_CREATE": return mdl.executePurchase(deps, ctx, payload);
    case "EXPENSE_CREATE": return mdl.executeExpense(deps, ctx, payload);
    case "RECEIPT_CREATE": return mdl.executeReceipt(deps, ctx, payload);
    case "PAYMENT_CREATE": return mdl.executePayment(deps, ctx, payload);
    case "JOURNAL_CREATE": return mdl.executeJournal(deps, ctx, payload);
    case "CONTRA_CREATE": return mdl.executeContra(deps, ctx, payload);
    case "RETURN_CREATE": return mdl.executeReturn(deps, ctx, payload);
    case "DOC_CANCEL": return mdl.executeCancelVoucher(deps, ctx, payload);
    case "DOC_REVERSE": return mdl.executeReverseVoucher(deps, ctx, payload);
    case "MASTER_PARTY_UPSERT": {
      await deps.repo.runInTransaction(async (tx: any) => tx.saveBusinessDocument("parties", payload.id, { ...payload, businessId: ctx.businessId }));
      return { id: payload.id };
    }
    case "MASTER_ITEM_UPSERT": {
      await deps.repo.runInTransaction(async (tx: any) => tx.saveBusinessDocument("items", payload.id, { ...payload, businessId: ctx.businessId }));
      return { id: payload.id };
    }
    case "MASTER_WAREHOUSE_UPSERT": {
      await deps.repo.runInTransaction(async (tx: any) => tx.saveBusinessDocument("warehouses", payload.id, { ...payload, businessId: ctx.businessId }));
      return { id: payload.id };
    }
    default:
      throw new Error(`dispatchDomainExecute: unknown command ${commandId}`);
  }
}
