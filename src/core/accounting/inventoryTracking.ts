import type { Money, StockMovement } from "./types";
import { ValidationError } from "./errors";

export interface BatchStockRow {
  batchId: string;
  batchNumber?: string;
  itemId: string;
  warehouseId: string;
  quantity: number;
  value: Money;
  manufactureDate?: string;
  expiryDate?: string;
}

export interface SerialStockRow {
  serialNumber: string;
  itemId: string;
  warehouseId: string;
  direction: "in" | "out";
  sourceId: string;
  date: string;
  expiryDate?: string;
}

function signed(m: StockMovement) { return m.direction === "in" ? m.quantity : -m.quantity; }

export function buildBatchStock(movements: readonly StockMovement[], itemId?: string, warehouseId?: string): BatchStockRow[] {
  const map = new Map<string, BatchStockRow>();
  for (const movement of movements) {
    if (itemId && movement.itemId !== itemId) continue;
    if (warehouseId && movement.warehouseId !== warehouseId) continue;
    if (!movement.batchId) continue;
    const key = `${movement.itemId}:${movement.warehouseId ?? "default"}:${movement.batchId}`;
    const current = map.get(key) ?? { batchId: movement.batchId, batchNumber: movement.batchNumber, itemId: movement.itemId, warehouseId: movement.warehouseId ?? "default", quantity: 0, value: 0 };
    current.quantity += signed(movement);
    current.value += movement.direction === "in" ? movement.value : -movement.value;
    current.batchNumber ??= movement.batchNumber;
    current.manufactureDate ??= movement.manufactureDate;
    current.expiryDate ??= movement.expiryDate;
    map.set(key, current);
  }
  return [...map.values()].filter(x => x.quantity !== 0 || x.value !== 0);
}

export function buildSerialStock(movements: readonly StockMovement[], itemId?: string, warehouseId?: string): SerialStockRow[] {
  const map = new Map<string, SerialStockRow>();
  for (const movement of movements) {
    if (itemId && movement.itemId !== itemId) continue;
    if (warehouseId && movement.warehouseId !== warehouseId) continue;
    for (const serialNumber of movement.serialNumbers ?? []) {
      const key = `${movement.itemId}:${movement.warehouseId ?? "default"}:${serialNumber}`;
      if (movement.direction === "out") map.delete(key);
      else map.set(key, { serialNumber, itemId: movement.itemId, warehouseId: movement.warehouseId ?? "default", direction: "in", sourceId: movement.sourceId, date: movement.date, expiryDate: movement.expiryDate });
    }
  }
  return [...map.values()];
}

export function assertSerialsAvailable(movements: readonly StockMovement[], serialNumbers: readonly string[], itemId: string, warehouseId: string): void {
  const available = new Set(buildSerialStock(movements, itemId, warehouseId).map(x => x.serialNumber));
  for (const serial of serialNumbers) if (!available.has(serial)) throw new ValidationError(`Serial number ${serial} is not available in warehouse ${warehouseId}.`);
}

export function buildExpiryReport(movements: readonly StockMovement[], throughDate?: string): BatchStockRow[] {
  const rows = buildBatchStock(movements).filter(x => x.quantity > 0 && x.expiryDate);
  if (!throughDate) return rows;
  return rows.filter(x => (x.expiryDate ?? "") <= throughDate);
}

export function convertQuantity(quantity: number, conversionFactor: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) throw new ValidationError("Quantity must be non-negative.");
  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) throw new ValidationError("Unit conversion factor must be greater than zero.");
  const result = quantity * conversionFactor;
  if (!Number.isFinite(result)) throw new ValidationError("Converted quantity exceeds numeric range.");
  return result;
}
