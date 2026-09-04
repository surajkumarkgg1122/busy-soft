import { describe, expect, it } from "vitest";
import { auditModuleRegistry, moduleRegistry, navigation } from "./moduleRegistry";

describe("central module registry", () => {
  it("has unique routes and permission ownership", () => {
    const routes = moduleRegistry.map(m => m.route);
    expect(new Set(routes).size).toBe(routes.length);
    expect(moduleRegistry.every(m => m.permissions.length > 0)).toBe(true);
  });

  it("derives navigation from the registry", async () => {
    const { navigation: derived } = await import("./navigation");
    expect(derived.map(x => x.href)).toEqual(navigation.map(x => x.route));
    expect(derived.flatMap(x => x.children ?? []).map(x => x.href)).toEqual(
      moduleRegistry.filter(m => m.parent && m.sidebarVisible && m.status !== "deprecated").sort((a,b) => a.order-b.order).map(m => m.route)
    );
  });

  it("detects registry gaps without mutating application state", () => {
    const report = auditModuleRegistry(["/", "/sales", "/not-registered"], ["SALE_CREATE", "UNKNOWN_PERMISSION"]);
    expect(report.routeWithoutNavigation).toContain("/not-registered");
    expect(report.permissionWithoutModule).toContain("UNKNOWN_PERMISSION");
  });
});
