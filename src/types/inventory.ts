import type { Timestamp } from "firebase/firestore";

export type StockMovementType =
  | "purchase"
  | "sale"
  | "sale_return"
  | "purchase_return"
  | "adjustment"
  | "opening"
  | "damage"
  | "transfer";

export interface StockMovement {
  movementId: string;
  itemId: string;
  type: StockMovementType;
  referenceType?: string;
  referenceId?: string;
  quantity: number;
  previousStock: number;
  newStock: number;
  date: Timestamp;
  createdBy: string;
  createdAt: Timestamp;
}

export interface StockAdjustment {
  adjustmentId: string;
  itemId: string;
  quantityChange: number;
  previousStock: number;
  newStock: number;
  reason: string;
  date: Timestamp;
  createdBy: string;
  createdAt: Timestamp;
}
