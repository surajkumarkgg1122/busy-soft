"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { firebaseAuth } from "@/lib/firebase";
import { useBusiness } from "@/context/BusinessContext";
import { useSyncState } from "@/infrastructure/local/syncStore";
import { requireLocalDb, type SyncOperationRow } from "@/infrastructure/local/localDb";
import { executeOfflineCommand, type OfflineCommandInput, type OfflineCommandName } from "@/infrastructure/local/offlineCommands";
import { retryFailedOperations, syncPendingOperations } from "@/infrastructure/local/syncEngine";
import type { SyncAggregate, SyncOperation } from "@/types/offline";
import type { AccountingPermission } from "@/core/accounting/authorization";

export const OFFLINE_ALLOWED_COMMANDS: readonly OfflineCommandName[] = ["SALE_CREATE", "PURCHASE_CREATE", "RETURN_CREATE", "RECEIPT_CREATE", "PAYMENT_CREATE", "EXPENSE_CREATE"];

export interface SyncProviderValue {
  worker: null;
  aggregate: SyncAggregate;
  net: SyncAggregate["net"];
  enabled: boolean;
  flush: (force?: boolean) => Promise<SyncAggregate | null>;
  manualRetry: (operationIds: string[]) => Promise<void>;
  enqueueCommand: ((args: OfflineCommandInput) => Promise<unknown>) | null;
  markConflictResolved: ((operationId: string, resolution?: unknown, payload?: Record<string, unknown>) => Promise<void>) | null;
  permissionCacheValid: boolean;
  cachedRole: string;
  cachedPermissions: Record<string, unknown>;
  operations: SyncOperation[];
}

const SyncContext = createContext<SyncProviderValue | null>(null);
const emptyAggregate: SyncAggregate = { net: "unknown", heartbeat: null, lastSuccessfulSyncAt: null, lastSyncAttemptAt: null, lastSyncError: null, counts: { pending: 0, syncing: 0, failed: 0, conflict: 0, blocked: 0, synced: 0, localOnly: 0, LOCAL_ONLY: 0, PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0, BLOCKED: 0 }, flushInProgress: false, flushProgressPercent: 100 };

function toAggregate(state: ReturnType<typeof useSyncState>): SyncAggregate {
  const net = state.connectionStatus === "ONLINE" ? "online" : state.connectionStatus === "OFFLINE" ? "offline" : state.connectionStatus === "SERVER_UNREACHABLE" ? "server_unreachable" : "unknown";
  const counts = { pending: state.pendingCount, syncing: state.syncingCount, failed: state.failedCount, conflict: state.conflictCount, blocked: 0, synced: 0, localOnly: 0, LOCAL_ONLY: 0, PENDING: state.pendingCount, SYNCING: state.syncingCount, SYNCED: 0, FAILED: state.failedCount, CONFLICT: state.conflictCount, BLOCKED: 0 };
  return { net, heartbeat: null, lastSuccessfulSyncAt: state.lastSuccessfulSync, lastSyncAttemptAt: state.lastSyncAttempt, lastSyncError: state.lastSyncError, counts, flushInProgress: state.syncStatus === "SYNCING", flushProgressPercent: state.syncStatus === "SYNCING" ? 50 : 100 };
}

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, authLoading] = useAuthState(firebaseAuth);
  const { activeBusinessId } = useBusiness();
  const state = useSyncState();
  const [operations, setOperations] = useState<SyncOperation[]>([]);
  const [cachedRole, setCachedRole] = useState("staff");
  const [cachedPermissions, setCachedPermissions] = useState<Record<string, unknown>>({});
  const [permissionCacheValid, setPermissionCacheValid] = useState(false);
  const enabled = typeof window !== "undefined" && !!user && !!activeBusinessId && !authLoading;

  const loadOperations = useCallback(async () => {
    if (!enabled) { setOperations([]); return; }
    try {
      const rows = await requireLocalDb().syncOperations.where("businessId").equals(activeBusinessId!).sortBy("createdAt");
      setOperations(rows.reverse() as unknown as SyncOperation[]);
    } catch { setOperations([]); }
  }, [enabled, activeBusinessId]);

  useEffect(() => { void loadOperations(); const timer = window.setInterval(() => void loadOperations(), 5000); return () => window.clearInterval(timer); }, [loadOperations, state.pendingCount, state.failedCount, state.conflictCount]);

  useEffect(() => {
    if (!enabled) return;
    const run = async () => {
      try {
        const response = await fetch("/api/heartbeat", { cache: "no-store" });
        if (!response.ok) return;
        const hb = await response.json();
        setCachedRole(String(hb.membership?.role ?? "staff"));
        setCachedPermissions((hb.permissions ?? {}) as Record<string, unknown>);
        setPermissionCacheValid(Boolean(hb.authCacheExpiresAt) && new Date(hb.authCacheExpiresAt).getTime() > Date.now());
      } catch { /* offline: retain last verified cache */ }
    };
    void run();
  }, [enabled, activeBusinessId, user?.uid]);

  const flush = useCallback(async () => { await syncPendingOperations({ businessId: activeBusinessId ?? undefined }); await loadOperations(); return toAggregate(state); }, [activeBusinessId, loadOperations, state]);
  const manualRetry = useCallback(async (operationIds: string[]) => {
    const db = requireLocalDb();
    const now = new Date().toISOString();
    for (const id of operationIds) await db.syncOperations.update(id, { status: "PENDING", retryCount: 0, nextAttemptAt: now, lastError: undefined, errorClass: undefined, updatedAt: now });
    await syncPendingOperations({ businessId: activeBusinessId ?? undefined });
    await loadOperations();
  }, [activeBusinessId, loadOperations]);
  const enqueueCommand = useCallback(async (args: OfflineCommandInput) => executeOfflineCommand(args), []);
  const markConflictResolved = useCallback(async (operationId: string, _resolution?: unknown, payload?: Record<string, unknown>) => {
    const db = requireLocalDb();
    const operation = await db.syncOperations.get(operationId);
    if (!operation) throw new Error("Synchronization operation not found.");
    if (operation.status !== "CONFLICT") throw new Error("Only conflicted operations can be resolved.");
    if (payload) await db.syncOperations.update(operationId, { payload, status: "PENDING", retryCount: 0, nextAttemptAt: new Date().toISOString(), lastError: undefined, errorClass: undefined, updatedAt: new Date().toISOString() });
    const conflicts = await db.conflicts.where("operationId").equals(operationId).toArray();
    for (const conflict of conflicts) await db.conflicts.update(conflict.id, { status: "RESOLVED", resolvedAt: new Date().toISOString() });
    await syncPendingOperations({ businessId: activeBusinessId ?? undefined });
    await loadOperations();
  }, [activeBusinessId, loadOperations]);

  const value = useMemo<SyncProviderValue>(() => ({ worker: null, aggregate: toAggregate(state), net: toAggregate(state).net, enabled, flush, manualRetry, enqueueCommand, markConflictResolved, permissionCacheValid, cachedRole, cachedPermissions, operations }), [state, enabled, flush, manualRetry, enqueueCommand, markConflictResolved, permissionCacheValid, cachedRole, cachedPermissions, operations]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export function useSync(): SyncProviderValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider. Wrap <SyncProvider> in your app layout.");
  return ctx;
}
