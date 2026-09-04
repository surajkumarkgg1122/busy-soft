"use client";

import { requireLocalDb } from "./localDb";
import { syncStore } from "./syncStore";

export async function hydrateSyncState(businessId?: string) {
  const rows = await requireLocalDb().syncOperations.toArray();
  const scoped = rows.filter(row => !businessId || row.businessId === businessId);
  syncStore.setState({
    pendingCount: scoped.filter(row => row.status === "PENDING").length,
    syncingCount: scoped.filter(row => row.status === "SYNCING").length,
    failedCount: scoped.filter(row => row.status === "FAILED").length,
    conflictCount: scoped.filter(row => row.status === "CONFLICT").length,
  });
}
