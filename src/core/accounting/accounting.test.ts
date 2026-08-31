import { describe, expect, it } from "vitest";
import { assertBalanced, validateVoucherLines } from "./ledger";
import { calculateTax } from "./gst";
import { valueFifo, valueWeightedAverage } from "./valuation";
import { allocateAgainstOutstanding } from "./party";
import type { StockMovement } from "./types";

const movement = (overrides: Partial<StockMovement>): StockMovement => ({
  id: "m",
  businessId: "b",
  financialYearId: "fy",
  date: "2026-04-01",
  itemId: "i",
  direction: "in",
  quantity: 10,
  unitCost: 500,
  value: 5000,
  sourceType: "purchase",
  sourceId: "p",
  createdBy: "u",
  createdAt: "2026-04-01T00:00:00.000Z",
  ...overrides,
});

describe("accounting invariants", () => {
  it("accepts balanced double-entry lines", () => {
    expect(() => assertBalanced([{ debit: 1000, credit: 0 }, { debit: 0, credit: 1000 }])).not.toThrow();
  });

  it("rejects an unbalanced entry", () => {
    expect(() => assertBalanced([{ debit: 1000, credit: 0 }, { debit: 0, credit: 900 }])).toThrow();
  });

  it("rejects a line with both debit and credit", () => {
    expect(() => validateVoucherLines([{
      lineId: "1", voucherId: "v", businessId: "b", lineNo: 1,
      accountId: "a", debit: 100, credit: 50,
    }])).toThrow();
  });

  it("calculates intra-state GST correctly", () => {
    const tax = calculateTax({ taxableValue: 10000, rate: 18, intraState: true });
    expect(tax).toMatchObject({ cgst: 900, sgst: 900, igst: 0, total: 11800 });
  });

  it("calculates inter-state GST correctly", () => {
    const tax = calculateTax({ taxableValue: 10000, rate: 18, intraState: false });
    expect(tax).toMatchObject({ cgst: 0, sgst: 0, igst: 1800, total: 11800 });
  });

  it("allocates receipts oldest-first", () => {
    const result = allocateAgainstOutstanding(7000, [
      { voucherId: "a", voucherNumber: "1", date: "2026-04-01", original: 5000, allocated: 0, outstanding: 5000 },
      { voucherId: "b", voucherNumber: "2", date: "2026-04-02", original: 10000, allocated: 0, outstanding: 10000 },
    ]);
    expect(result.allocations).toEqual([
      { voucherId: "a", amount: 5000 },
      { voucherId: "b", amount: 2000 },
    ]);
    expect(result.unallocated).toBe(0);
  });

  it("values FIFO closing stock", () => {
    const result = valueFifo([
      movement({ id: "1", date: "2026-04-01", quantity: 10, unitCost: 500, value: 5000 }),
      movement({ id: "2", date: "2026-04-02", quantity: 10, unitCost: 600, value: 6000 }),
      movement({ id: "3", date: "2026-04-03", direction: "out", quantity: 12, unitCost: 0, value: 0, sourceType: "sale", sourceId: "s" }),
    ]);
    expect(result).toEqual({ quantity: 8, value: 4800 });
  });

  it("values weighted-average closing stock", () => {
    const result = valueWeightedAverage([
      movement({ id: "1", date: "2026-04-01", quantity: 10, unitCost: 500, value: 5000 }),
      movement({ id: "2", date: "2026-04-02", quantity: 10, unitCost: 600, value: 6000 }),
      movement({ id: "3", date: "2026-04-03", direction: "out", quantity: 12, unitCost: 0, value: 0, sourceType: "sale", sourceId: "s" }),
    ]);
    expect(result).toEqual({ quantity: 8, value: 4800 });
  });
});
