"use client";

import { useSyncExternalStore } from "react";

export type ConnectionStatus = "ONLINE" | "OFFLINE" | "SERVER_UNREACHABLE" | "UNKNOWN";
export type SyncStatus = "IDLE" | "SYNCING" | "FAILED" | "CONFLICT";

export interface SyncState {
  connectionStatus: ConnectionStatus;
  syncStatus: SyncStatus;
  pendingCount: number;
  syncingCount: number;
  failedCount: number;
  conflictCount: number;
  lastSuccessfulSync: string | null;
  lastSyncAttempt: string | null;
  lastSyncError: string | null;
}

const initial: SyncState = {
  connectionStatus: "UNKNOWN",
  syncStatus: "IDLE",
  pendingCount: 0,
  syncingCount: 0,
  failedCount: 0,
  conflictCount: 0,
  lastSuccessfulSync: null,
  lastSyncAttempt: null,
  lastSyncError: null,
};

let state = initial;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const syncStore = {
  getState: () => state,
  setState: (patch: Partial<SyncState>) => { state = { ...state, ...patch }; emit(); },
  subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
};

const serverSnapshot = JSON.stringify(initial);
export function useSyncState(): SyncState {
  return useSyncExternalStore(syncStore.subscribe, syncStore.getState, () => JSON.parse(serverSnapshot) as SyncState);
}
