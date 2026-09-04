"use client";

import Link from "next/link";
import { useSyncState } from "@/infrastructure/local/syncStore";
import { syncPendingOperations } from "@/infrastructure/local/syncEngine";

export default function SyncStatusIndicator({ collapsed = false }: { collapsed?: boolean }) {
  const state = useSyncState();
  const retry = () => { void syncPendingOperations(); };
  const label = state.conflictCount > 0
    ? `Attention Required · ${state.conflictCount} conflicts`
    : state.failedCount > 0
      ? "Sync Error · Retry"
      : state.connectionStatus !== "ONLINE"
        ? `Offline · ${state.pendingCount} pending`
        : state.pendingCount > 0 || state.syncingCount > 0
          ? `Syncing… ${state.pendingCount} pending`
          : "Synced";
  const dot = state.conflictCount > 0 ? "bg-[#f59e0b]" : state.failedCount > 0 ? "bg-[#ef4444]" : state.connectionStatus !== "ONLINE" ? "bg-[#f5b544]" : "bg-[#46d18c]";

  if (collapsed) {
    return <Link href="/sync-center" title={label} aria-label={label} className="flex h-9 w-full items-center justify-center rounded-lg text-[#aebbc9] hover:bg-[#243247]"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} /></Link>;
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-[#202c3d] px-3 py-2 text-xs text-[#b8c5d4]">
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <Link href="/sync-center" className="min-w-0 flex-1 truncate hover:text-white">{label}</Link>
      {state.failedCount > 0 && <button type="button" onClick={retry} className="shrink-0 font-semibold text-[#f5b544] hover:text-white">Retry</button>}
    </div>
  );
}
