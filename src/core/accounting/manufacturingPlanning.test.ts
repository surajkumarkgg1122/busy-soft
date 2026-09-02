import { describe, expect, it } from "vitest";
import { nextProductionPlanStatus, validateProductionPlan } from "./manufacturingPlanning";

describe("manufacturing planning", () => {
  it("validates a production plan", () => {
    expect(() => validateProductionPlan({ plannedQuantity: 100, dueDate: "2026-09-10", bomVersion: 1, status: "draft" })).not.toThrow();
  });
  it("rejects invalid plans", () => {
    expect(() => validateProductionPlan({ plannedQuantity: 0, dueDate: "2026-09-10", bomVersion: 1, status: "draft" })).toThrow();
    expect(() => validateProductionPlan({ plannedQuantity: 10, dueDate: "10-09-2026", bomVersion: 1, status: "draft" })).toThrow();
  });
  it("moves released plans through progress to completion", () => {
    expect(nextProductionPlanStatus("released", 0, 100)).toBe("released");
    expect(nextProductionPlanStatus("released", 25, 100)).toBe("in_progress");
    expect(nextProductionPlanStatus("in_progress", 100, 100)).toBe("completed");
  });
  it("never reopens cancelled or completed plans", () => {
    expect(nextProductionPlanStatus("cancelled", 0, 100)).toBe("cancelled");
    expect(nextProductionPlanStatus("completed", 0, 100)).toBe("completed");
  });
});
