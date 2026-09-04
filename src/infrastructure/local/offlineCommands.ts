import type { AccountingPermission } from "@/core/accounting/authorization";
import type { CommandContext, CommandResult } from "@/application/core";
import { executeExpense, executePayment, executePurchase, executePurchaseReturn, executeReceipt, executeSale, executeSaleReturn } from "@/application/core";
import { createLocalAccountingRepository } from "./localAccountingRepository";
import { requireLocalDb, type SyncOperationRow } from "./localDb";

export type OfflineCommandName = "SALE_CREATE" | "PURCHASE_CREATE" | "RETURN_CREATE" | "RECEIPT_CREATE" | "PAYMENT_CREATE" | "EXPENSE_CREATE";

export interface OfflineCommandInput {
  commandType: OfflineCommandName;
  businessId: string;
  financialYearId: string;
  userId: string;
  role?: string;
  permissions: readonly AccountingPermission[];
  payload: Record<string, unknown>;
  entityId?: string;
  entityType?: string;
  idempotencyKey?: string;
  dependencies?: string[];
}

const commandIds = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const deviceId = () => {
  const key = "erp.device.id";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.localStorage.setItem(key, value);
  return value;
};

async function dispatch(command: OfflineCommandName, repo: ReturnType<typeof createLocalAccountingRepository>, ctx: CommandContext, payload: Record<string, unknown>): Promise<CommandResult> {
  const deps = { repo, ids: { next: commandIds }, clock: { now: () => new Date().toISOString() } };
  switch (command) {
    case "SALE_CREATE": return executeSale(deps, ctx, payload);
    case "PURCHASE_CREATE": return executePurchase(deps, ctx, payload);
    case "RETURN_CREATE": {
      const type = String(payload.type ?? "SALE_RETURN").toUpperCase();
      return type === "PURCHASE_RETURN" ? executePurchaseReturn(deps, ctx, payload) : executeSaleReturn(deps, ctx, payload);
    }
    case "RECEIPT_CREATE": return executeReceipt(deps, ctx, payload);
    case "PAYMENT_CREATE": return executePayment(deps, ctx, payload);
    case "EXPENSE_CREATE": return executeExpense(deps, ctx, payload);
  }
}

export async function executeOfflineCommand(input: OfflineCommandInput): Promise<CommandResult> {
  if (typeof window === "undefined") throw new Error("Offline commands require a browser runtime.");
  const db = requireLocalDb();
  const repo = createLocalAccountingRepository(input.businessId);
  const key = (input.idempotencyKey ?? `${input.commandType.toLowerCase()}-${input.businessId}-${crypto.randomUUID()}`).trim();
  if (key.length < 16 || key.length > 128) throw new Error("Offline idempotency key must be 16–128 characters.");
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const payload = { ...input.payload, businessId: input.businessId, financialYearId: input.financialYearId, idempotencyKey: key };
  const ctx: CommandContext = {
    businessId: input.businessId,
    financialYearId: input.financialYearId,
    userId: input.userId,
    idempotencyKey: key,
    role: input.role,
    permissions: input.permissions,
  };
  const operation: SyncOperationRow = {
    id: operationId,
    operationId,
    commandId: operationId,
    businessId: input.businessId,
    financialYearId: input.financialYearId,
    deviceId: deviceId(),
    entityType: input.entityType ?? input.commandType,
    entityId: input.entityId,
    commandType: input.commandType,
    payload,
    status: "PENDING",
    retryCount: 0,
    createdAt: now,
    updatedAt: now,
    dependencies: input.dependencies ?? [],
  };

  // The outbox row is inserted BEFORE invoking the domain command, inside the
  // same Dexie transaction. If the command fails, the entire transaction rolls back.
  return db.transaction("rw", [
    db.businesses, db.financialYears, db.accounts, db.parties, db.items, db.units, db.warehouses,
    db.taxConfigurations, db.vouchers, db.voucherLines, db.ledgerEntries, db.stockMovements,
    db.partyAllocations, db.returnDocuments, db.accountingDocuments, db.auditLogs, db.localTransactions,
    db.syncOperations, db.syncAttempts, db.conflicts, db.syncCheckpoints, db.projections,
  ], async () => {
    const existing = await db.syncOperations.where("commandId").equals(operation.commandId).first();
    if (existing) return { value: existing.serverResult ?? { operationId: existing.operationId, status: existing.status }, idempotencyKey: key };
    await db.syncOperations.put(operation);
    const result = await dispatch(input.commandType, repo, ctx, payload);
    const value = result.value as Record<string, unknown>;
    const voucher = value && typeof value === "object" && value.voucher && typeof value.voucher === "object" ? value.voucher as Record<string, unknown> : undefined;
    const entityId = input.entityId ?? (voucher?.id as string | undefined);
    await db.syncOperations.update(operationId, { entityId, updatedAt: new Date().toISOString() });
    if (entityId) {
      await db.localTransactions.put({
        id: `${input.commandType}:${entityId}`,
        businessId: input.businessId,
        financialYearId: input.financialYearId,
        entityType: input.entityType ?? input.commandType,
        entityId,
        lifecycle: "POSTED",
        syncStatus: "PENDING",
        localUpdatedAt: new Date().toISOString(),
      });
    }
    return result;
  });
}
