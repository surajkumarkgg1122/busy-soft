"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { SyncWorker, OFFLINE_ALLOWED_COMMANDS } from "@/lib/offline/syncEngine";
import type { SyncAggregate, SyncOperation } from "@/types/offline";
import { useAuthState } from "react-firebase-hooks/auth";
import { firebaseAuth, firestoreDb } from "@/lib/firebase";
import { useBusiness } from "@/context/BusinessContext";

export interface SyncProviderValue {
  worker: SyncWorker | null;
  aggregate: SyncAggregate;
  net: SyncAggregate["net"];
  enabled: boolean;
  // Actions
  flush: (force?: boolean) => Promise<SyncAggregate | null>;
  manualRetry: (operationIds: string[]) => Promise<void>;
  enqueueCommand: SyncWorker["enqueue"] | null;
  markConflictResolved: SyncWorker["markConflictResolved"] | null;
  // Permission cache
  permissionCacheValid: boolean;
  cachedRole: string;
  cachedPermissions: Record<string, any>;
  operations: SyncOperation[];
}

const SyncContext = createContext<SyncProviderValue | null>(null);

const emptyAggregate: SyncAggregate = {
  net: "unknown", heartbeat: null, lastSuccessfulSyncAt: null, lastSyncAttemptAt: null, lastSyncError: null,
  counts: { pending: 0, syncing: 0, failed: 0, conflict: 0, blocked: 0, synced: 0, localOnly: 0, LOCAL_ONLY: 0, PENDING: 0, SYNCING: 0, SYNCED: 0, FAILED: 0, CONFLICT: 0, BLOCKED: 0 },
  flushInProgress: false, flushProgressPercent: 100,
};

function isBrowser() { return typeof window !== "undefined"; }

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, authLoading] = useAuthState(firebaseAuth);
  const { activeBusinessId } = useBusiness();
  const [aggregate, setAggregate] = useState<SyncAggregate>(emptyAggregate);
  const [worker, setWorker] = useState<SyncWorker | null>(null);
  const [operations, setOperations] = useState<SyncOperation[]>([]);
  const workerRef = useRef<SyncWorker | null>(null);
  const [permissionCacheValid, setPermissionCacheValid] = useState(false);
  const [cachedRole, setCachedRole] = useState("staff");
  const [cachedPermissions, setCachedPermissions] = useState<Record<string, any>>({});
  const enabled = isBrowser() && !!user && !!activeBusinessId && !authLoading;

  const authTokenFetcher = useCallback(async () => {
    if (!user) return null;
    try { return await user.getIdToken(true); } catch { return user.getIdToken(false); }
  }, [user]);

  const isServerReachable = useCallback(async () => {
    try {
      const res = await fetch("/api/heartbeat", { method: "GET", cache: "no-store", headers: { "X-Ping": "1" } });
      return res.ok || res.status === 401; // 401 means server is reachable, just needs re-auth.
    } catch {
      // Fallback: navigator.onLine is less reliable than heartbeat, but better than nothing.
      if (typeof navigator !== "undefined") return navigator.onLine;
      return false;
    }
  }, []);

  // Set up worker when user/business ready
  useEffect(() => {
    if (!enabled) {
      if (workerRef.current) { workerRef.current.dispose(); workerRef.current = null; setWorker(null); }
      return;
    }
    if (workerRef.current) return;
    let alive = true;
    (async () => {
      // Browser Dexie worker; inject business context
      const { getOfflineDb } = await import("@/lib/offline/sqliteAccountingRepository");
      const { SyncWorker } = await import("@/lib/offline/syncEngine");
      const w = new SyncWorker({
        userId: user!.uid,
        businessId: activeBusinessId!,
        authTokenFetcher,
        onStateChange: (agg) => { if (alive) setAggregate(agg); },
        isServerReachable,
      }, getOfflineDb(user!.uid, activeBusinessId!));
      await w.init();
      // Initial load of operations for Sync Center
      const db = w.getDb();
      const initial = await db.syncOperations.where("businessId").equals(activeBusinessId!).toArray();
      setOperations(initial);
      const listener = db.syncOperations.where("businessId").equals(activeBusinessId!);
      (db.syncOperations as any).hook("creating", () => { /* no-op; we poll below */ });
      workerRef.current = w;
      setWorker(w);
      await w.flush().catch(() => {});
      const interval = setInterval(async () => {
        if (!alive) return;
        const dbNow = workerRef.current?.getDb();
        if (dbNow) setOperations(await dbNow.syncOperations.where("businessId").equals(activeBusinessId!).sortBy("createdAt").then(arr => arr.reverse()));
        void workerRef.current?.flush();
      }, 15_000);
      const netListener = () => { if (navigator.onLine) workerRef.current?.scheduleFlush(500); };
      window.addEventListener?.("online", netListener);
      window.addEventListener?.("offline", netListener);
      // Cache permissions from heartbeat once
      try {
        const hb = await fetch("/api/heartbeat", { cache: "no-store" }).then(r => r.ok ? r.json() : null);
        if (hb) {
          setCachedRole(hb.membership?.role ?? "staff");
          setCachedPermissions(hb.permissions ?? {});
          setPermissionCacheValid(new Date(hb.authCacheExpiresAt).getTime() > Date.now());
        }
      } catch { /* offline; will populate later */ }
      return () => {
        alive = false;
        clearInterval(interval);
        window.removeEventListener?.("online", netListener);
        window.removeEventListener?.("offline", netListener);
      };
    })();
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, user?.uid, activeBusinessId]);

  const flush = useCallback(async (force = false) => {
    return worker ? worker.flush(force) : null;
  }, [worker]);

  const manualRetry = useCallback(async (operationIds: string[]) => {
    return worker?.manualRetry(operationIds);
  }, [worker]);

  const enqueueCommand: any = useCallback(async (args: any) => worker?.enqueue(args), [worker]);

  const markConflictResolved: any = useCallback(async (opid: string, resolution: any, payload?: any) => worker?.markConflictResolved(opid, resolution, payload), [worker]);

  const value = useMemo<SyncProviderValue>(() => ({
    worker, aggregate, net: aggregate.net, enabled,
    flush, manualRetry, enqueueCommand, markConflictResolved,
    permissionCacheValid, cachedRole, cachedPermissions, operations,
  }), [worker, aggregate, enabled, flush, manualRetry, enqueueCommand, markConflictResolved, permissionCacheValid, cachedRole, cachedPermissions, operations]);

  return React.createElement(SyncContext.Provider, { value }, children);
};

export function useSync(): SyncProviderValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider. Wrap <SyncProvider> in your app layout.");
  return ctx;
}

export { OFFLINE_ALLOWED_COMMANDS };
