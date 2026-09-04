import { describe, expect, it } from "vitest";
import { assertAuditPayload, assertAuditWriteTrusted, assertLifecycleTransition, assertPostedImmutable } from "../documentLifecycle";
import { AuthorizationError, ValidationError } from "../errors";

describe("document lifecycle and audit hardening", () => {
  it("enforces Draft -> Validated -> Posted", () => {
    expect(assertLifecycleTransition("draft", "VALIDATE")).toBe("validated");
    expect(assertLifecycleTransition("validated", "POST")).toBe("posted");
  });

  it("allows only cancellation/reversal from posted", () => {
    expect(assertLifecycleTransition("posted", "CANCEL")).toBe("cancelled");
    expect(assertLifecycleTransition("posted", "REVERSE")).toBe("cancelled");
    expect(() => assertLifecycleTransition("posted", "EDIT")).toThrow(ValidationError);
    expect(() => assertLifecycleTransition("posted", "DELETE")).toThrow(ValidationError);
  });

  it("prevents mutation of cancelled documents", () => {
    expect(() => assertLifecycleTransition("cancelled", "EDIT")).toThrow(ValidationError);
    expect(() => assertLifecycleTransition("cancelled", "DELETE")).toThrow(ValidationError);
  });

  it("requires audit identity fields", () => {
    expect(() => assertAuditPayload({ id: "a", businessId: "", entityType: "voucher", entityId: "v", action: "POST", userId: "u", timestamp: new Date().toISOString() })).toThrow(ValidationError);
  });

  it("requires trusted server boundary for audit writes", () => {
    expect(() => assertAuditWriteTrusted(false)).toThrow(AuthorizationError);
    expect(() => assertAuditWriteTrusted(true)).not.toThrow();
  });

  it("protects posted vouchers independently of UI", () => {
    expect(() => assertPostedImmutable("posted")).toThrow(ValidationError);
    expect(() => assertPostedImmutable("draft")).not.toThrow();
  });
});
