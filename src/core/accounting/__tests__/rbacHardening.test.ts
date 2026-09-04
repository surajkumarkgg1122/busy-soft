import { describe, expect, it } from "vitest";
import { assertAuthorized, assertCanManageAccounts, assertCanManageUsers, assertOwnerOrAdmin, permissionsForRole, type AuthorizationContext } from "../authorization";
import { AuthorizationError } from "../errors";

const context = (role: string, permissions: string[] = []): AuthorizationContext => ({
  userId: "user-a", businessId: "business-a", role, permissions: permissions as any,
});

describe("central RBAC hardening", () => {
  it("defines least-privilege role permissions", () => {
    expect(permissionsForRole("staff")).toContain("SALE_CREATE");
    expect(permissionsForRole("staff")).not.toContain("SALE_CANCEL");
    expect(permissionsForRole("staff")).not.toContain("USER_MANAGE");
    expect(permissionsForRole("accountant")).toContain("JOURNAL_CREATE");
    expect(permissionsForRole("manager")).not.toContain("FY_LOCK");
  });

  it("rejects unknown roles instead of granting access", () => {
    expect(() => assertAuthorized(context("unknown"), "SALE_CREATE")).toThrow(AuthorizationError);
  });

  it("prevents staff from privileged mutations", () => {
    expect(() => assertCanManageUsers(context("staff"))).toThrow(AuthorizationError);
    expect(() => assertCanManageAccounts(context("staff"))).toThrow(AuthorizationError);
    expect(() => assertOwnerOrAdmin(context("staff"))).toThrow(AuthorizationError);
  });

  it("allows explicit privileged roles only", () => {
    expect(() => assertCanManageUsers(context("admin"))).not.toThrow();
    expect(() => assertCanManageUsers(context("owner"))).not.toThrow();
    expect(() => assertCanManageAccounts(context("accountant"))).not.toThrow();
  });

  it("requires authenticated business context for every authorization check", () => {
    expect(() => assertAuthorized(context("owner", ["SALE_CREATE"]), "SALE_CREATE")).not.toThrow();
    expect(() => assertAuthorized({ ...context("owner"), businessId: "" }, "SALE_CREATE")).toThrow(AuthorizationError);
    expect(() => assertAuthorized({ ...context("owner"), userId: "" }, "SALE_CREATE")).toThrow(AuthorizationError);
  });
});
