import { ValidationError } from "./errors";
import type { ManufacturingConfig } from "./manufacturing";

export type ProductionPlanStatus = "draft" | "released" | "in_progress" | "completed" | "cancelled";

export interface BomVersionSnapshot {
  version: number;
  itemId: string;
  effectiveFrom: string;
  effectiveTo?: string;
  config: ManufacturingConfig;
  createdBy: string;
  createdAt: string;
}

export interface ProductionPlan {
  id: string;
  businessId: string;
  financialYearId: string;
  planNumber: string;
  itemId: string;
  warehouseId?: string;
  plannedQuantity: number;
  completedQuantity: number;
  dueDate: string;
  status: ProductionPlanStatus;
  bomVersion: number;
  bomSnapshot: ManufacturingConfig;
  notes?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function validateProductionPlan(input: Pick<ProductionPlan, "plannedQuantity" | "dueDate" | "bomVersion" | "status">): void {
  if (!Number.isFinite(input.plannedQuantity) || input.plannedQuantity <= 0) throw new ValidationError("Planned production quantity must be greater than zero.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) throw new ValidationError("Production due date must be YYYY-MM-DD.");
  if (!Number.isInteger(input.bomVersion) || input.bomVersion < 1) throw new ValidationError("A valid BOM version is required.");
  if (!["draft", "released", "in_progress", "completed", "cancelled"].includes(input.status)) throw new ValidationError("Invalid production plan status.");
}

export function nextProductionPlanStatus(current: ProductionPlanStatus, completedQuantity: number, plannedQuantity: number): ProductionPlanStatus {
  if (current === "cancelled" || current === "completed") return current;
  if (completedQuantity >= plannedQuantity) return "completed";
  if (completedQuantity > 0) return "in_progress";
  return current === "draft" ? "draft" : "released";
}
