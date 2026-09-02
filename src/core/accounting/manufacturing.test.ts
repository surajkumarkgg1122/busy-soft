import { describe, expect, it } from "vitest";
import { calculateManufacturingCost, validateManufacturingConfig } from "./manufacturing";

describe("manufacturing costing", () => {
  const config = { enabled: true, batchQuantity: 100, bom: [{ itemId: "raw", quantity: 2 }], costComponents: [
    { type: "electricity" as const, name: "Electricity", amount: 1500 },
    { type: "labour" as const, name: "Labour", amount: 2000 },
    { type: "overhead" as const, name: "Factory overhead", amount: 500 },
  ], costingMethod: "actual" as const };

  it("capitalizes material, labour, electricity and overhead into finished-goods cost", () => {
    const result = calculateManufacturingCost({ config, materialUnitCosts: { raw: 50 } });
    expect(result.materialCost).toBe(10000);
    expect(result.electricityCost).toBe(1500);
    expect(result.labourCost).toBe(2000);
    expect(result.overheadCost).toBe(500);
    expect(result.totalCost).toBe(14000);
    expect(result.outputQuantity).toBe(100);
    expect(result.unitCost).toBe(140);
  });

  it("includes BOM scrap in material consumption", () => {
    const result = calculateManufacturingCost({ config: { ...config, bom: [{ itemId: "raw", quantity: 2, scrapPercent: 10 }] }, materialUnitCosts: { raw: 50 } });
    expect(result.materialCost).toBe(11000);
  });

  it("rejects duplicate BOM components", () => {
    expect(() => validateManufacturingConfig({ ...config, bom: [{ itemId: "raw", quantity: 1 }, { itemId: "raw", quantity: 1 }] })).toThrow(/duplicated/i);
  });

  it("rejects missing material cost", () => {
    expect(() => calculateManufacturingCost({ config, materialUnitCosts: {} })).toThrow(/No cost is available/i);
  });
});
