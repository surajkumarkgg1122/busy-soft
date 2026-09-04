import { describe, expect, it } from "vitest";
import { assertAuthorized, assertTrustedPostingBoundary, type AuthorizationContext } from "../authorization";
import { assertPostedVoucherImmutable } from "../voucher";
import type { Voucher } from "../types";
import { AuthorizationError, PostedVoucherMutationError } from "../errors";

const ctx = (overrides: Partial<AuthorizationContext> = {}): AuthorizationContext => ({
  userId: "user-a",
  businessId: "business-a",
  permissions: ["SALE_CREATE", "REPORT_VIEW"],
  ...overrides,
});

describe("security and RBAC hardening", () => {
  it("rejects an empty authenticated business context", () => {
    expect(() => assertTrustedPostingBoundary(ctx({ businessId: "" }))).toThrow(AuthorizationError);
    expect(() => assertTrustedPostingBoundary(ctx({ userId: "" }))).toThrow(AuthorizationError);
  });

  it("rejects permission bypass at the application boundary", () => {
    expect(() => assertAuthorized(ctx(), "PURCHASE_CREATE")).toThrow(AuthorizationError);
    expect(() => assertAuthorized(ctx({ permissions: ["PURCHASE_CREATE"] }), "PURCHASE_CREATE")).not.toThrow();
  });

  it("does not treat a business id alone as authorization", () => {
    expect(() => assertAuthorized(ctx({ businessId: "business-other" }), "SALE_CREATE")).not.toThrow();
    expect(() => assertTrustedPostingBoundary(ctx({ businessId: "business-other" }))).not.toThrow();
  });

  it("rejects mutation of posted accounting vouchers", () => {
    const voucher = { id: "v1", businessId: "business-a", financialYearId: "fy", voucherType: "SALE", voucherNumber: "S-1", date: "2026-04-01", status: "posted", totalDebit: 100, totalCredit: 100, createdBy: "user-a", createdAt: "2026-04-01T00:00:00.000Z", updatedAt: "2026-04-01T00:00:00.000Z" } as Voucher;
    expect(() => assertPostedVoucherImmutable(voucher)).toThrow(PostedVoucherMutationError);
  });
});
