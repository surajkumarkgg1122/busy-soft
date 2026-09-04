import { describe, expect, it } from "vitest";
import { resolveFinancialYear } from "./financialYear";

describe("financial year engine", () => {
  it("resolves the default April-March year", () => {
    expect(resolveFinancialYear("2026-04-01")).toMatchObject({
      id: "fy-2026-27",
      startDate: "2026-04-01",
      endDate: "2027-03-31",
    });
    expect(resolveFinancialYear("2027-03-31").id).toBe("fy-2026-27");
  });

  it("supports a non-April configured start month", () => {
    expect(resolveFinancialYear("2026-06-30", 7)).toMatchObject({
      id: "fy-2025-26",
      startDate: "2025-07-01",
      endDate: "2026-06-30",
    });
  });

  it("rejects invalid dates and start months", () => {
    expect(() => resolveFinancialYear("2026/04/01")).toThrow();
    expect(() => resolveFinancialYear("2026-04-01", 0)).toThrow();
    expect(() => resolveFinancialYear("2026-13-01")).toThrow();
  });
});
