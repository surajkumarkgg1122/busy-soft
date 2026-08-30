import type { IdGenerator, Money, StockDirection, StockMovement, StockSourceType } from "./types";
import { ValidationError } from "./errors";

export interface StockMovementRequest {
  businessId: string;
  financialYearId: string;
  date: string;
  itemId: string;
  warehouseId?: string;
  direction: StockDirection;
  quantity: number;
  unitCost: Money;
  sourceType: StockSourceType;
  sourceId: string;
  createdBy: string;
}

export function createStockMovement(input: StockMovementRequest, ids: IdGenerator, createdAt: string): StockMovement {
  if (!input.itemId) throw new ValidationError("Stock movement requires an item.");
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) throw new ValidationError("Stock quantity must be greater than zero.");
  if (!Number.isSafeInteger(input.unitCost) || input.unitCost < 0) throw new ValidationError("Unit cost must be a non-negative integer minor-unit amount.");
  if (!input.sourceId) throw new ValidationError("Stock movement requires a source voucher.");
  if (input.direction === "neutral") throw new ValidationError("Use an in/out movement for stock quantity changes.");

  return {
    id: ids.next("stk"),
    businessId: input.businessId,
    financialYearId: input.financialYearId,
    date: input.date,
    itemId: input.itemId,
    warehouseId: input.warehouseId,
    direction: input.direction,
    quantity: input.quantity,
    unitCost: input.unitCost,
    value: Math.round(input.quantity * input.unitCost),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    createdBy: input.createdBy,
    createdAt,
  };
}

export function signedQuantity(movement: Pick<StockMovement, "direction" | "quantity">): number {
  return movement.direction === "in" ? movement.quantity : movement.direction === "out" ? -movement.quantity : 0;
}

export function calculateStockBalance(movements: readonly Pick<StockMovement, "direction" | "quantity">[]): number {
  return movements.reduce((sum, movement) => sum + signedQuantity(movement), 0);
}

export function calculateStockValue(movements: readonly Pick<StockMovement, "direction" | "quantity" | "unitCost">[]): Money {
  return movements.reduce((sum, movement) => sum + signedQuantity(movement) * movement.unitCost, 0);
}
