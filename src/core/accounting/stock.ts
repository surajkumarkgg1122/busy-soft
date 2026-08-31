import type { Money, StockDirection, StockMovement } from "./types";
import { ValidationError } from "./errors";

/** The movement ledger is authoritative. Item-level stock fields are caches only. */
export interface StockScope {
  businessId: string;
  financialYearId: string;
  itemId: string;
  warehouseId: string;
}

export interface StockBalance extends StockScope {
  quantity: number;
  value: Money;
  movementCount: number;
  asOf?: string;
}

export interface StockAdjustmentInput extends StockScope {
  date: string;
  quantityDelta: number;
  unitCost: Money;
  sourceId: string;
  createdBy: string;
}

export interface StockTransferInput {
  businessId: string;
  financialYearId: string;
  date: string;
  itemId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  quantity: number;
  unitCost: Money;
  sourceId: string;
  createdBy: string;
}

export const DEFAULT_WAREHOUSE_ID = "default";

export function normalizeWarehouseId(warehouseId?: string | null): string {
  const value = warehouseId?.trim();
  return value || DEFAULT_WAREHOUSE_ID;
}

export function stockScope(itemId: string, warehouseId?: string | null): string {
  if (!itemId?.trim()) throw new ValidationError("Item is required for stock scope.");
  return `${itemId}:${normalizeWarehouseId(warehouseId)}`;
}

function signedQuantity(movement: StockMovement): number {
  return movement.direction === "in" ? movement.quantity : -movement.quantity;
}

export function balanceFor(
  movements: readonly StockMovement[],
  scope: Omit<StockScope, "warehouseId"> & { warehouseId?: string },
  asOf?: string,
): StockBalance {
  const warehouseId = normalizeWarehouseId(scope.warehouseId);
  const relevant = movements.filter(
    (movement) =>
      movement.businessId === scope.businessId &&
      movement.financialYearId === scope.financialYearId &&
      movement.itemId === scope.itemId &&
      normalizeWarehouseId(movement.warehouseId) === warehouseId &&
      (!asOf || movement.date <= asOf),
  );

  let quantity = 0;
  let value = 0;

  for (const movement of relevant) {
    quantity += signedQuantity(movement);
    // Movement.value is already rounded to the application's minor-unit money
    // representation. Reusing it keeps balances consistent with posted stock.
    value += movement.direction === "in" ? movement.value : -movement.value;
  }

  if (!Number.isFinite(quantity) || !Number.isSafeInteger(value)) {
    throw new ValidationError("Stock balance exceeds safe numeric range.");
  }

  return {
    ...scope,
    warehouseId,
    quantity,
    value,
    movementCount: relevant.length,
    ...(asOf ? { asOf } : {}),
  };
}

export function assertAvailableStock(
  movements: readonly StockMovement[],
  scope: Omit<StockScope, "warehouseId"> & { warehouseId?: string },
  quantity: number,
  asOf?: string,
): StockBalance {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError("Stock quantity must be greater than zero.");
  }

  const balance = balanceFor(movements, scope, asOf);
  if (balance.quantity < quantity) {
    throw new ValidationError(
      `Insufficient stock for item ${scope.itemId} in warehouse ${balance.warehouseId}. Available ${balance.quantity}, required ${quantity}.`,
    );
  }
  return balance;
}

export function adjustmentMovement(
  input: StockAdjustmentInput,
  id: string,
  createdAt: string,
): StockMovement {
  if (!Number.isFinite(input.quantityDelta) || input.quantityDelta === 0) {
    throw new ValidationError("Stock adjustment cannot be zero.");
  }
  if (!Number.isSafeInteger(input.unitCost) || input.unitCost < 0) {
    throw new ValidationError("Adjustment unit cost must be a non-negative integer.");
  }

  const quantity = Math.abs(input.quantityDelta);
  const direction: StockDirection = input.quantityDelta > 0 ? "in" : "out";

  return {
    id,
    businessId: input.businessId,
    financialYearId: input.financialYearId,
    date: input.date,
    itemId: input.itemId,
    warehouseId: normalizeWarehouseId(input.warehouseId),
    direction,
    quantity,
    unitCost: input.unitCost,
    value: Math.round(quantity * input.unitCost),
    sourceType: "adjustment",
    sourceId: input.sourceId,
    createdBy: input.createdBy,
    createdAt,
  };
}

export function transferMovements(
  input: StockTransferInput,
  outId: string,
  inId: string,
  createdAt: string,
): [StockMovement, StockMovement] {
  const fromWarehouseId = normalizeWarehouseId(input.fromWarehouseId);
  const toWarehouseId = normalizeWarehouseId(input.toWarehouseId);

  if (fromWarehouseId === toWarehouseId) {
    throw new ValidationError("Source and destination warehouses must be different.");
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new ValidationError("Transfer quantity must be greater than zero.");
  }
  if (!Number.isSafeInteger(input.unitCost) || input.unitCost < 0) {
    throw new ValidationError("Transfer unit cost must be a non-negative integer.");
  }

  const value = Math.round(input.quantity * input.unitCost);

  return [
    {
      id: outId,
      businessId: input.businessId,
      financialYearId: input.financialYearId,
      date: input.date,
      itemId: input.itemId,
      warehouseId: fromWarehouseId,
      direction: "out",
      quantity: input.quantity,
      unitCost: input.unitCost,
      value,
      sourceType: "transfer",
      sourceId: input.sourceId,
      createdBy: input.createdBy,
      createdAt,
    },
    {
      id: inId,
      businessId: input.businessId,
      financialYearId: input.financialYearId,
      date: input.date,
      itemId: input.itemId,
      warehouseId: toWarehouseId,
      direction: "in",
      quantity: input.quantity,
      unitCost: input.unitCost,
      value,
      sourceType: "transfer",
      sourceId: input.sourceId,
      createdBy: input.createdBy,
      createdAt,
    },
  ];
}

export function reconcileCachedStock(
  current: Record<string, unknown>,
  balance: StockBalance,
  now: string,
): Record<string, unknown> {
  return {
    ...current,
    stock: balance.quantity,
    stockValue: balance.value,
    stockWarehouseId: balance.warehouseId,
    stockReconciledAt: now,
    stockReconciliationSource: "stockMovements",
  };
}

export interface StockLedgerRow {
  date: string;
  movementId: string;
  sourceType: StockMovement["sourceType"];
  sourceId: string;
  direction: StockDirection;
  quantity: number;
  unitCost: Money;
  value: Money;
  runningQuantity: number;
  runningValue: Money;
  warehouseId: string;
}

export function buildStockLedger(
  movements: readonly StockMovement[],
  scope: Omit<StockScope, "warehouseId"> & { warehouseId?: string },
  throughDate?: string,
): StockLedgerRow[] {
  const warehouseId = normalizeWarehouseId(scope.warehouseId);
  const rows = movements
    .filter(
      (movement) =>
        movement.businessId === scope.businessId &&
        movement.financialYearId === scope.financialYearId &&
        movement.itemId === scope.itemId &&
        normalizeWarehouseId(movement.warehouseId) === warehouseId &&
        (!throughDate || movement.date <= throughDate),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );

  let runningQuantity = 0;
  let runningValue = 0;

  return rows.map((movement) => {
    runningQuantity += signedQuantity(movement);
    runningValue += movement.direction === "in" ? movement.value : -movement.value;

    if (!Number.isFinite(runningQuantity) || !Number.isSafeInteger(runningValue)) {
      throw new ValidationError("Stock ledger exceeds safe numeric range.");
    }

    return {
      date: movement.date,
      movementId: movement.id,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      direction: movement.direction,
      quantity: movement.quantity,
      unitCost: movement.unitCost,
      value: movement.value,
      runningQuantity,
      runningValue,
      warehouseId,
    };
  });
}
