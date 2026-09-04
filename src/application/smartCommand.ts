"use client";

import { firebaseAuth } from "@/lib/firebase";
import { executeOfflineCommand, type OfflineCommandName } from "@/infrastructure/local/offlineCommands";
import { syncStore } from "@/infrastructure/local/syncStore";
import type { SyncOperation } from "@/types/offline";
import type { CommandResult } from "@/application/core";
import type { AccountingPermission } from "@/core/accounting/authorization";

type InputPayload = Record<string, any>;

export interface SmartCommandArgs {
  commandId: "SALE_CREATE" | "PURCHASE_CREATE" | "RETURN_CREATE" | "RECEIPT_CREATE" | "PAYMENT_CREATE" | "CONTRA_CREATE" | "JOURNAL_CREATE" | "EXPENSE_CREATE" | "MASTER_PARTY_UPSERT" | "MASTER_ITEM_UPSERT" | "MASTER_WAREHOUSE_UPSERT" | "DOC_CANCEL" | "DOC_REVERSE";
  endpoint: string;
  entityType: string;
  entityId: string;
  financialYearId: string;
  operationType: SyncOperation["operationType"];
  payload: InputPayload;
  idempotencyKey?: string;
  dependsOnOperationIds?: string[];
  headers?: Record<string, string>;
  forceOffline?: boolean;
  permissions?: readonly AccountingPermission[];
  role?: string;
}

const OFFLINE_ALLOWED = new Set<OfflineCommandName>(["SALE_CREATE", "PURCHASE_CREATE", "RETURN_CREATE", "RECEIPT_CREATE", "PAYMENT_CREATE", "EXPENSE_CREATE"]);

function session() {
  const value = (window as typeof window & { __BUSYSOFT_SESSION__?: { businessId?: string; uid?: string; role?: string; permissions?: AccountingPermission[] } }).__BUSYSOFT_SESSION__;
  return value ?? {};
}

function localContext(args: SmartCommandArgs) {
  const s = session();
  return {
    businessId: String(s.businessId ?? args.payload.businessId ?? ""),
    userId: String(s.uid ?? firebaseAuth?.currentUser?.uid ?? ""),
    role: args.role ?? s.role,
    permissions: args.permissions ?? s.permissions ?? [],
  };
}

/** Unified command boundary. Online writes use the existing API; offline writes use the same application/domain commands against local persistence. */
export async function dispatchSmartCommand(args: SmartCommandArgs): Promise<CommandResult<any> & { _mode: "online" | "offline"; _localOnly?: boolean; _syncOp?: unknown }> {
  if (typeof window === "undefined") throw new Error("Commands require a browser runtime.");
  const state = syncStore.getState();
  const allowOffline = OFFLINE_ALLOWED.has(args.commandId as OfflineCommandName);
  const online = state.connectionStatus === "ONLINE";
  const goOffline = args.forceOffline === true || (!online && allowOffline);

  if (!goOffline) {
    const response = await fetch(args.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(args.headers ?? {}) },
      body: JSON.stringify({ ...args.payload, idempotencyKey: args.idempotencyKey }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { ...(data?.result || data?.value || data || {}), success: true, idempotencyKey: args.idempotencyKey ?? "", _mode: "online" };
    if (!(allowOffline && response.status >= 500)) throw new Error(`Server error (HTTP ${response.status}): ${String(data?.error ?? "Request failed.").slice(0, 500)}`);
  }

  if (!allowOffline) throw new Error(`Command ${args.commandId} is not permitted while offline.`);
  const ctx = localContext(args);
  if (!ctx.businessId || !ctx.userId || !args.financialYearId) throw new Error("Offline session, business and financial year are required.");
  if (!ctx.permissions.length && !["owner", "admin"].includes(ctx.role ?? "")) throw new Error("Offline authorization cache is unavailable or expired. Reconnect to verify permissions.");

  const result = await executeOfflineCommand({
    commandType: args.commandId as OfflineCommandName,
    businessId: ctx.businessId,
    financialYearId: args.financialYearId,
    userId: ctx.userId,
    role: ctx.role,
    permissions: ctx.permissions,
    payload: args.payload,
    entityId: args.entityId,
    entityType: args.entityType,
    idempotencyKey: args.idempotencyKey,
    dependencies: args.dependsOnOperationIds,
  });
  return { ...result, _mode: "offline", _localOnly: true, _syncOp: undefined } as CommandResult<any> & { _mode: "offline"; _localOnly: true; _syncOp?: unknown };
}
