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
  if (status >= 500 || status === 0) return "TRANSIENT";
  return "PERMANENT";
}

function backoff(retryCount: number) {
  const jitter = Math.floor(Math.random() * 500);
  return Math.min(5 * 60_000, BASE_BACKOFF_MS * 2 ** Math.max(0, retryCount - 1) + jitter);
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

function resultRecord(body: Record<string, unknown>) {
  return body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : body;
}

async function reconcileCanonical(operation: SyncOperationRow, result: Record<string, unknown>) {
  const db = requireLocalDb();
  const canonicalVoucher = result.voucher && typeof result.voucher === "object" ? result.voucher as Record<string, unknown> : undefined;
  if (!canonicalVoucher?.id) return;

  const localVoucherId = operation.entityId;
  const serverVoucherId = String(canonicalVoucher.id);
  const lines = Array.isArray(result.lines) ? result.lines as Record<string, unknown>[] : [];
  const ledger = Array.isArray(result.ledgerEntries) ? result.ledgerEntries as Record<string, unknown>[] : [];
  const movements = Array.isArray(result.stockMovements) ? result.stockMovements as Record<string, unknown>[] : [];
  const now = new Date().toISOString();

  await db.transaction("rw", [db.vouchers, db.voucherLines, db.ledgerEntries, db.stockMovements, db.partyAllocations, db.accountingDocuments, db.localTransactions, db.canonicalMappings], async () => {
    if (localVoucherId && localVoucherId !== serverVoucherId) {
      const localLines = await db.voucherLines.where("voucherId").equals(localVoucherId).toArray();
      for (const line of localLines) await db.voucherLines.delete(line.id);
      const localLedger = await db.ledgerEntries.where("voucherId").equals(localVoucherId).toArray();
      for (const entry of localLedger) await db.ledgerEntries.delete(entry.id);
      const localStock = await db.stockMovements.where("sourceId").equals(localVoucherId).toArray();
      for (const movement of localStock) await db.stockMovements.delete(movement.id);
      const localAllocations = await db.partyAllocations.toArray();
      for (const allocation of localAllocations) {
        if (allocation.fromVoucherId === localVoucherId || allocation.toVoucherId === localVoucherId) await db.partyAllocations.delete(allocation.id);
      }
      await db.vouchers.delete(localVoucherId);
      await db.canonicalMappings.put({
        id: operation.operationId,
        operationId: operation.operationId,
        entityType: operation.entityType,
        localEntityId: localVoucherId,
        serverEntityId: serverVoucherId,
        businessId: operation.businessId,
        financialYearId: operation.financialYearId,
        createdAt: now,
      });
    }

    await db.vouchers.put(canonicalVoucher as never);
    for (const line of lines) await db.voucherLines.put(line as never);
    for (const entry of ledger) await db.ledgerEntries.put(entry as never);
    for (const movement of movements) await db.stockMovements.put(movement as never);

    const documents = await db.accountingDocuments.toArray();
    for (const document of documents) {
      if (String(document.businessId ?? "") !== operation.businessId || String(document.financialYearId ?? "") !== operation.financialYearId) continue;
      if (document.voucherId === localVoucherId) await db.accountingDocuments.update(document.id, { voucherId: serverVoucherId });
    }

    const localTransactions = await db.localTransactions.toArray();
    for (const local of localTransactions) {
      if (local.businessId === operation.businessId && local.entityId === localVoucherId) {
        await db.localTransactions.update(local.id, { entityId: serverVoucherId, serverEntityId: serverVoucherId, syncStatus: "SYNCED", serverUpdatedAt: now });
      }
    }
  });
}

async function markLocalStatus(operation: SyncOperationRow, status: "SYNCED" | "FAILED" | "CONFLICT") {
  const db = requireLocalDb();
  const rows = await db.localTransactions.toArray();
  const matching = rows.filter(row => row.businessId === operation.businessId && row.entityId === operation.entityId);
  for (const row of matching) await db.localTransactions.update(row.id, { syncStatus: status });
}

async function syncOne(operation: SyncOperationRow) {
  const db = requireLocalDb();
  const startedAt = new Date().toISOString();
  const attemptNo = operation.retryCount + 1;
  await db.syncOperations.update(operation.operationId, { status: "SYNCING", lastAttemptAt: startedAt, updatedAt: startedAt });
  await db.syncAttempts.add({ id: crypto.randomUUID(), operationId: operation.operationId, businessId: operation.businessId, attemptNo, startedAt, outcome: "RETRY" });

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
        idempotencyKey: operation.idempotencyKey,
        payloadFingerprint: operation.payloadFingerprint,
        deviceId: operation.deviceId,
        userId: operation.userId,
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
        await db.conflicts.put({ id: crypto.randomUUID(), operationId: operation.operationId, businessId: operation.businessId, financialYearId: operation.financialYearId, entityType: operation.entityType, entityId: operation.entityId, reason: message, localPayload: operation.payload, status: "OPEN", createdAt: new Date().toISOString() });
        await markLocalStatus(operation, "CONFLICT");
      } else if (status === "FAILED") {
        await markLocalStatus(operation, "FAILED");
      }
      await db.syncAttempts.add({ id: crypto.randomUUID(), operationId: operation.operationId, businessId: operation.businessId, attemptNo, startedAt, finishedAt: new Date().toISOString(), outcome: status === "CONFLICT" ? "CONFLICT" : terminal ? "FAILED" : "RETRY", errorClass, errorMessage: message });
      return;
    }

    const result = resultRecord(body);
    await reconcileCanonical(operation, result);
    await db.transaction("rw", [db.syncOperations, db.syncAttempts, db.localTransactions], async () => {
      const acknowledgedAt = new Date().toISOString();
      await db.syncOperations.update(operation.operationId, { status: "SYNCED", retryCount: attemptNo, lastError: undefined, errorClass: undefined, serverAcknowledgedAt: acknowledgedAt, serverTimestamp: typeof body.serverTimestamp === "string" ? body.serverTimestamp : acknowledgedAt, serverResult: result, updatedAt: acknowledgedAt });
      const rows = await db.localTransactions.toArray();
      for (const row of rows) if (row.businessId === operation.businessId && (row.entityId === operation.entityId || row.serverEntityId === operation.entityId)) await db.localTransactions.update(row.id, { syncStatus: "SYNCED", serverUpdatedAt: acknowledgedAt });
      await db.syncAttempts.add({ id: crypto.randomUUID(), operationId: operation.operationId, businessId: operation.businessId, attemptNo, startedAt, finishedAt: acknowledgedAt, outcome: "SUCCESS" });
    });
  } catch (cause) {
    const status = Number((cause as { status?: number }).status ?? 0);
    const errorClass = status === 401 || status === 403 ? "AUTHORIZATION" : "TRANSIENT";
    const terminal = errorClass === "AUTHORIZATION" || attemptNo >= MAX_RETRIES;
    const message = cause instanceof Error ? cause.message : "Synchronization failed.";
    await db.syncOperations.update(operation.operationId, { status: terminal ? "FAILED" : "PENDING", retryCount: attemptNo, nextAttemptAt: terminal ? undefined : new Date(Date.now() + backoff(attemptNo)).toISOString(), lastError: message, errorClass, updatedAt: new Date().toISOString() });
    if (terminal) await markLocalStatus(operation, "FAILED");
  }
}

function dependenciesSatisfied(operation: SyncOperationRow, byId: Map<string, SyncOperationRow>) {
  return operation.dependencies.every(id => byId.get(id)?.status === "SYNCED");
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
    const all = await db.syncOperations.toArray();
    const byId = new Map(all.map(operation => [operation.operationId, operation]));
    const pending = all
      .filter(v => (!options.businessId || v.businessId === options.businessId) && v.status === "PENDING" && (!v.nextAttemptAt || v.nextAttemptAt <= now) && dependenciesSatisfied(v, byId))
      .sort((a, b) => a.localSequence - b.localSequence);

    for (const operation of pending) await syncOne(operation);

    const scoped = all.filter(v => !options.businessId || v.businessId === options.businessId);
    const pendingCount = scoped.filter(v => v.status === "PENDING").length;
    const failed = scoped.filter(v => v.status === "FAILED").length;
    const conflicts = scoped.filter(v => v.status === "CONFLICT").length;
    const syncing = scoped.filter(v => v.status === "SYNCING").length;
    const blocked = scoped.filter(v => v.status === "BLOCKED").length;
    const hasWork = pendingCount + failed + conflicts + syncing + blocked > 0;
    syncStore.setState({
      connectionStatus: "ONLINE",
      syncStatus: conflicts ? "CONFLICT" : failed ? "FAILED" : "IDLE",
      pendingCount,
      failedCount: failed,
      conflictCount: conflicts,
      syncingCount: syncing,
      lastSuccessfulSync: hasWork ? syncStore.getState().lastSuccessfulSync : new Date().toISOString(),
      lastSyncError: failed ? "One or more operations require attention." : conflicts ? "One or more operations require conflict resolution." : null,
    });
  } finally {
    running = false;
  }
}

export async function retryFailedOperations(businessId?: string) {
  const db = requireLocalDb();
  const failed = await db.syncOperations.where("status").equals("FAILED").toArray();
  const now = new Date().toISOString();
  for (const operation of failed) {
    if (businessId && operation.businessId !== businessId) continue;
    await db.syncOperations.update(operation.operationId, { status: "PENDING", retryCount: 0, nextAttemptAt: now, lastError: undefined, errorClass: undefined, updatedAt: now });
    await markLocalStatus(operation, "FAILED");
  }
  await syncPendingOperations({ businessId });
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
