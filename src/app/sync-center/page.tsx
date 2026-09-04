"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { requireLocalDb } from "@/infrastructure/local/localDb";
import { syncPendingOperations } from "@/infrastructure/local/syncEngine";
import { useSyncState } from "@/infrastructure/local/syncStore";

export default function SyncCenterPage() {
  const state = useSyncState();
  const [operations, setOperations] = useState<Array<{ operationId: string; commandType: string; status: string; retryCount: number; lastError?: string; createdAt: string }>>([]);

  const load = async () => {
    const db = requireLocalDb();
    const rows = await db.syncOperations.orderBy("createdAt").reverse().limit(100).toArray();
    setOperations(rows.map(row => ({ operationId: row.operationId, commandType: row.commandType, status: row.status, retryCount: row.retryCount, lastError: row.lastError, createdAt: row.createdAt })));
  };

  useEffect(() => { void load(); }, [state.pendingCount, state.failedCount, state.conflictCount, state.syncStatus]);
  const syncNow = async () => { await syncPendingOperations(); await load(); };

  return (
    <main className="min-h-screen bg-[#f5f7fa] p-6 text-[#182230]">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div><Link href="/" className="text-sm text-[#64748b] hover:text-[#182230]">← Back</Link><h1 className="mt-2 text-2xl font-bold">Sync Center</h1><p className="mt-1 text-sm text-[#64748b]">Durable local operations and cloud synchronization diagnostics.</p></div>
          <button type="button" onClick={() => void syncNow()} className="rounded-lg bg-[#182230] px-4 py-2 text-sm font-semibold text-white hover:bg-[#243247]">Sync Now</button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card title="Connection" value={state.connectionStatus} />
          <Card title="Pending" value={String(state.pendingCount)} />
          <Card title="Failed" value={String(state.failedCount)} />
          <Card title="Conflicts" value={String(state.conflictCount)} />
        </div>

        <section className="mt-6 overflow-hidden rounded-xl border border-[#dbe2ea] bg-white">
          <div className="flex items-center justify-between border-b border-[#e5eaf0] px-5 py-4"><div><h2 className="font-semibold">Recent operations</h2><p className="text-xs text-[#718198]">Financial sync records are durable and cannot be deleted from this screen.</p></div><span className="text-xs text-[#718198]">Last sync: {state.lastSuccessfulSync ? new Date(state.lastSuccessfulSync).toLocaleString() : "Never"}</span></div>
          <div className="divide-y divide-[#edf1f5]">
            {!operations.length ? <p className="px-5 py-8 text-sm text-[#718198]">No synchronization operations have been recorded on this device.</p> : operations.map(operation => (
              <div key={operation.operationId} className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_140px_80px_2fr] md:items-center">
                <div><p className="text-sm font-medium">{operation.commandType}</p><p className="text-[11px] text-[#8392a8]">{operation.operationId}</p></div>
                <span className="text-xs font-semibold">{operation.status}</span>
                <span className="text-xs text-[#64748b]">#{operation.retryCount}</span>
                <div className="text-xs text-[#64748b]">{operation.lastError ?? new Date(operation.createdAt).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return <div className="rounded-xl border border-[#dbe2ea] bg-white p-4"><p className="text-xs font-medium uppercase tracking-wide text-[#8392a8]">{title}</p><p className="mt-2 text-lg font-bold">{value}</p></div>;
}
