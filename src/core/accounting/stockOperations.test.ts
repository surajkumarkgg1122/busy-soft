import { describe, expect, it } from "vitest";
import { calculateOutgoingAllocations } from "./valuation";
import { createStockMovement } from "./inventory";

describe("inventory hardening", () => {
  it("preserves FIFO layers when allocating a transfer", () => {
    const movements = [
      { id: "in-1", businessId: "b", financialYearId: "fy", itemId: "i", warehouseId: "w", direction: "in" as const, quantity: 100, baseQuantity: 100, unitCost: 1000, value: 100000, date: "2026-04-01", createdAt: "2026-04-01T09:00:00Z", createdBy: "u", sourceType: "opening" as const, sourceId: "v1" },
      { id: "in-2", businessId: "b", financialYearId: "fy", itemId: "i", warehouseId: "w", direction: "in" as const, quantity: 100, baseQuantity: 100, unitCost: 2000, value: 200000, date: "2026-04-02", createdAt: "2026-04-02T09:00:00Z", createdBy: "u", sourceType: "purchase" as const, sourceId: "v2" },
    ];
    expect(calculateOutgoingAllocations(movements, 150, "fifo")).toEqual([
      { quantity: 100, unitCost: 1000, value: 100000 },
      { quantity: 50, unitCost: 2000, value: 100000 },
    ]);
  });

  it("rejects blank or duplicate serial numbers", () => {
    const make = (serialNumbers: string[]) => createStockMovement({
      businessId: "b", financialYearId: "fy", date: "2026-04-01", itemId: "i", warehouseId: "w",
      direction: "in", quantity: 2, unitCost: 1000, sourceType: "opening", sourceId: "v1", createdBy: "u", serialNumbers,
    }, { next: (p: string) => `${p}-1` }, "2026-04-01T09:00:00Z");
    expect(() => make(["S1", "S1"])).toThrow("unique");
    expect(() => make(["S1", " "])).toThrow("blank");
  });
});
