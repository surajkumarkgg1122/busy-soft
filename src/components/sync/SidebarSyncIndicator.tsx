"use client";
import React, { useMemo } from "react";
import Link from "next/link";
import { useSyncState } from "@/infrastructure/local/syncStore";
import { syncPendingOperations, retryFailedOperations } from "@/infrastructure/local/syncEngine";

function formatRelative(ts?: string | null): string {
  if (!ts) return "Never";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export const SidebarSyncIndicator: React.FC<{ onOpenSyncCenter?: () => void }> = ({ onOpenSyncCenter }) => {
  const state = useSyncState();
  const view = useMemo(() => {
    if (state.conflictCount > 0) return { label: "Attention Required", sub: `${state.conflictCount} conflict${state.conflictCount === 1 ? "" : "s"}`, dot: "#f5b544" };
    if (state.failedCount > 0) return { label: "Sync Error · Retry", sub: `${state.failedCount} failed operation${state.failedCount === 1 ? "" : "s"}`, dot: "#f04438" };
    if (state.syncStatus === "SYNCING" || state.syncingCount > 0) return { label: "Syncing…", sub: `${state.pendingCount + state.syncingCount} pending`, dot: "#465fff" };
    if (state.connectionStatus === "OFFLINE" || state.connectionStatus === "SERVER_UNREACHABLE" || state.connectionStatus === "UNKNOWN") return { label: state.connectionStatus === "OFFLINE" ? "Offline" : state.connectionStatus === "SERVER_UNREACHABLE" ? "Server Unreachable" : "Working Offline", sub: state.pendingCount ? `${state.pendingCount} change${state.pendingCount === 1 ? "" : "s"} waiting` : "No pending changes", dot: "#f5b544" };
    return { label: "Synced", sub: "All changes saved to cloud", dot: "#12b76a" };
  }, [state]);

  const retry = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    await retryFailedOperations();
  };

  return (
    <div className="mt-2 mb-1">
      <div className="rounded-lg border border-white/10 bg-[#202c3d] p-2 text-xs text-[#d8e0eb]">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: view.dot }} aria-hidden />
          <Link href="/sync-center" onClick={onOpenSyncCenter} className="min-w-0 flex-1 text-left hover:text-white" aria-label={`Sync status: ${view.label}`}>
            <div className="truncate font-semibold">{view.label}</div>
            <div className="truncate text-[11px] text-[#93a1b3]">{view.sub}</div>
          </Link>
          {state.failedCount > 0 && <button type="button" onClick={retry} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/10">Retry</button>}
          {state.pendingCount > 0 && <button type="button" onClick={(event) => { event.stopPropagation(); void syncPendingOperations(); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/10">Sync</button>}
        </div>
        <div className="mt-1 text-[10px] text-[#718198]">Last sync: {formatRelative(state.lastSuccessfulSync)}</div>
      </div>
    </div>
  );
};

export const SidebarSyncLink: React.FC = () => <SidebarSyncIndicator />;
