"use client";

import { firebaseAuth } from "@/lib/firebase";
import { requireLocalDb, type SyncOperationRow } from "./localDb";
import { syncStore } from "./syncStore";

const MAX_RETRIES = 8;
const BASE_BACKOFF_MS = 2_000;
let running = false;

function classify(status: number): SyncOperationRow["errorClass"] {
  if (status === 401 || status === 403) return "AUTHORIZATION";
  if (status === 409) return "CONFLICT";
  if (status >= 400 && status < 500) return "VALIDATION";
  if (status >= 500) return "TRANSIENT";
  return "PERMANENT";
}

function backoff(retryCount: number) {
  return Math.min(5 * 60_000, BASE_BACKOFF_MS * 2 ** Math.max(0, retryCount - 1));
}

async function reachable(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const response = await fetch("/api/health", { method: "HEAD", cache: "no-store" });
    return response.ok || response.status === 401 || response.status === 403;
  } catch {
    return false;
  }
}

async function syncOne(operation: SyncOperationRow) {
  const db = requireLocalDb();
  const startedAt = new Date().toISOString();
  const attemptNo = operation.retryCount + 1;
  await db.syncOperations.update(operation.operationId, { status: "SYNCING", lastAttemptAt: startedAt, updatedAt: startedAt });
  await db.syncAttempts.add({ id: crypto.randomUUID(), operationId: operation.operationId, businessId: operation.businessId, attemptNo, startedAt, outcome: "RETRY" });
  syncStore.setState({ syncStatus: "SYNCING" });

  try {
    const user = firebaseAuth?.currentUser;
    if (!user) throw Object.assign(new Error("Authentication session is unavailable."), { status: 401 });
    const token = await user.getIdToken();
    const response = await fetch("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        operationId: operation.operationId,
        commandId: operation.commandId,
        commandType: operation.commandType,
        businessId: operation.businessId,
        financialYearId: operation.financialYearId,
        idempotencyKey: operation.payload.idempotencyKey,
        deviceId: operation.deviceId,
        payload: operation.payload,
      }),
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      const errorClass = classify(response.status);
      const message = String(body.error ?? `Synchronization failed with HTTP ${response.status}.`);
      const terminal = errorClass === "AUTHORIZATION" || errorClass === "VALIDATION" || errorClass === "PERMANENT" || errorClass === "CONFLICT" || attemptNo >= MAX_RETRIES;
      const status = errorClass === "CONFLICT" ? "CONFLICT" : terminal ? "FAILED" : "PENDING";
      const nextAttemptAt = terminal ? undefined : new Date(Date.now() + backoff(attemptNo)).toISOString();
      await db.syncOperations.update(operation.operationId, { status, retryCount: attemptNo, nextAttemptAt, lastError: message, errorClass, updatedAt: new Date().toISOString() });
      if (status === "CONFLICT") {
        await db.conflicts.put({ id: crypto.randomUUID(), operationId: operation.operationId, businessId: operation.businessId, entityType: operation.entityType, entityId: operation.entityId, reason: message, localPayload: operation.payload, status: "OPEN", createdAt: new Date().toISOString() });
      }
      await db.syncAttempts.add({ id: crypto.randomUUID(), operationId: operation.operationId, businessId: operation.businessId, attemptNo, startedAt, finishedAt: new Date().toISOString(), outcome: status === "CONFLICT" ? "CONFLICT" : terminal ? "FAILED" : "RETRY", errorClass, errorMessage: message });
      return;
    }

    const result = body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : body;
    await db.transaction("rw", [db.syncOperations, db.syncAttempts, db.localTransactions, db.vouchers, db.voucherLines, db.ledgerEntries, db.stockMovements, db.partyAllocations, db.returnDocuments, db.accountingDocuments], async () => {
      await db.syncOperations.update(operation.operationId, { status: "SYNCED", retryCount: attemptNo, lastError: undefined, errorClass: undefined, serverAcknowledgedAt: new Date().toISOString(), serverResult: result, updatedAt: new Date().toISOString() });
      if (operation.entityId) {
        const local = await db.localTransactions.toCollection().filter(v => v.businessId === operation.businessId && v.entityId === operation.entityId).first();
        if (local) await db.localTransactions.update(local.id, { syncStatus: "SYNCED", serverUpdatedAt: new Date().toISOString() });
      }
      await db.syncAttempts.add({ id: crypto.randomUUID(), operationId: operation.operationId, businessId: operation.businessId, attemptNo, startedAt, finishedAt: new Date().toISOString(), outcome: "SUCCESS" });
    });
  } catch (cause) {
    const status = Number((cause as { status?: number }).status ?? 0);
    const errorClass = status === 401 ? "AUTHORIZATION" : "TRANSIENT";
    const terminal = errorClass === "AUTHORIZATION" || attemptNo >= MAX_RETRIES;
    const message = cause instanceof Error ? cause.message : "Synchronization failed.";
    await db.syncOperations.update(operation.operationId, { status: terminal ? "FAILED" : "PENDING", retryCount: attemptNo, nextAttemptAt: terminal ? undefined : new Date(Date.now() + backoff(attemptNo)).toISOString(), lastError: message, errorClass, updatedAt: new Date().toISOString() });
  }
}

export async function syncPendingOperations(options: { businessId?: string } = {}) {
  if (running) return;
  running = true;
  syncStore.setState({ lastSyncAttempt: new Date().toISOString() });
  try {
    const db = requireLocalDb();
    const online = await reachable();
    if (!online) {
      syncStore.setState({ connectionStatus: navigator.onLine ? "SERVER_UNREACHABLE" : "OFFLINE", syncStatus: "IDLE" });
      return;
    }
    syncStore.setState({ connectionStatus: "ONLINE", syncStatus: "SYNCING" });
    const now = new Date().toISOString();
    const pending = (await db.syncOperations.where("status").anyOf("PENDING", "FAILED", "CONFLICT").toArray())
      .filter(v => (!options.businessId || v.businessId === options.businessId) && v.status === "PENDING" && (!v.nextAttemptAt || v.nextAttemptAt <= now))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const operation of pending) await syncOne(operation);
    const remaining = await db.syncOperations.where("status").equals("PENDING").count();
    const failed = await db.syncOperations.where("status").equals("FAILED").count();
    const conflicts = await db.syncOperations.where("status").equals("CONFLICT").count();
    const syncing = await db.syncOperations.where("status").equals("SYNCING").count();
    syncStore.setState({ syncStatus: conflicts ? "CONFLICT" : failed ? "FAILED" : "IDLE", pendingCount: remaining, failedCount: failed, conflictCount: conflicts, syncingCount: syncing, lastSuccessfulSync: failed || conflicts ? syncStore.getState().lastSuccessfulSync : new Date().toISOString(), lastSyncError: failed ? "One or more operations require attention." : null });
  } finally {
    running = false;
  }
}

export function startSyncEngine() {
  if (typeof window === "undefined") return () => undefined;
  const run = () => { void syncPendingOperations(); };
  const online = () => run();
  window.addEventListener("online", online);
  run();
  const interval = window.setInterval(run, 30_000);
  return () => { window.removeEventListener("online", online); window.clearInterval(interval); };
}
