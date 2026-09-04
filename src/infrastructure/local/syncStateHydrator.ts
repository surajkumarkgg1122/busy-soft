"use client";

import { requireLocalDb } from "./localDb";
import { syncStore } from "./syncStore";

export async function hydrateSyncState(businessId?: string) {
  const rows = await requireLocalDb().syncOperations.toArray();
  const scoped = rows.filter(row => !businessId || row.businessId === businessId);
  const pendingCount = scoped.filter(row => row.status === "PENDING").length;
  const syncingCount = scoped.filter(row => row.status === "SYNCING").length;
  const failedCount = scoped.filter(row => row.status === "FAILED").length;
  const conflictCount = scoped.filter(row => row.status === "CONFLICT").length;
  syncStore.setState({ connectionStatus: navigator.onLine ? "ONLINE" : "OFFLINE", pendingCount, syncingCount, failedCount, conflictCount, syncStatus: conflictCount ? "CONFLICT" : failedCount ? "FAILED" : "IDLE" });
}
