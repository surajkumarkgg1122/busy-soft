"use client";
import React, { useMemo } from "react";
import Link from "next/link";
import { useSync } from "@/context/SyncContext";
import type { SyncAggregate } from "@/types/offline";

function formatRelative(ts?: string | null): string {
  if (!ts) return "Never";
  const ms = Date.now() - new Date(ts).getTime();
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export const SidebarSyncIndicator: React.FC<{ onOpenSyncCenter: () => void }> = ({ onOpenSyncCenter }) => {
  const { aggregate, net, flush } = useSync();

  const state = useMemo(() => computeState(aggregate, net), [aggregate, net]);

  return (
    <button
      onClick={() => onOpenSyncCenter()}
      className="w-full mt-2 mb-1 rounded-lg border border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/5 hover:bg-white hover:shadow-sm transition p-2 text-left text-xs"
      title={`Click for diagnostics. Net: ${state.label}. Pending: ${aggregate.counts.pending}`}
      aria-label={`Sync status: ${state.label}`}
    >
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full inline-block flex-none shadow-inner" style={{ background: state.dot }} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate text-textPrimary dark:text-white">{state.label}</div>
          <div className="truncate opacity-70">{state.sub}</div>
        </div>
      </div>
      {aggregate.flushInProgress ? (
        <div className="mt-2 w-full h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${Math.max(10, aggregate.flushProgressPercent)}%` }} />
        </div>
      ) : null}
      <div className="mt-1 flex items-center justify-between gap-1 opacity-80">
        <span>Last sync: {formatRelative(aggregate.lastSuccessfulSyncAt)}</span>
        <button
          type="button"
          onClick={async (e) => { e.stopPropagation(); await flush(true); }}
          className="rounded px-1.5 py-0.5 border border-black/10 dark:border-white/10 hover:bg-accent/10 transition"
          aria-label="Sync Now"
        >⟳ Sync</button>
      </div>
    </button>
  );
};

export function computeState(agg: SyncAggregate, net: SyncAggregate["net"]) {
  const c = agg.counts;
  if (c.conflict > 0) return {
    label: `Attention Required`,
    sub: `${c.conflict} conflict${c.conflict === 1 ? "" : "s"}`,
    dot: "#f5b544", // amber
  };
  if (c.failed > 0) return {
    label: `Sync Error · Retry`,
    sub: `${c.failed} failed operation${c.failed === 1 ? "" : "s"}`,
    dot: "#f04438", // red
  };
  if (agg.flushInProgress || c.syncing > 0) return {
    label: `Syncing…`,
    sub: `${c.pending + c.syncing} pending`,
    dot: "#465fff", // brand blue animated
  };
  if (net === "offline" || net === "server_unreachable" || net === "unknown") {
    const total = c.pending + c.localOnly + c.failed + c.conflict + c.syncing + c.blocked;
    return {
      label: net === "offline" ? "Offline" : net === "server_unreachable" ? "Server Unreachable" : "Working Offline",
      sub: total > 0 ? `${total} change${total === 1 ? "" : "s"} waiting` : "No pending changes",
      dot: "#f5b544",
    };
  }
  return { label: "Synced", sub: net === "online" ? "All changes saved to cloud" : "Connection unknown", dot: "#12b76a" };
}

export const SidebarSyncLink: React.FC = () => React.createElement(Link, {
  href: "/tools/sync-center", className: "block mt-1",
}, React.createElement(SidebarSyncIndicator, { onOpenSyncCenter: () => {} }));
