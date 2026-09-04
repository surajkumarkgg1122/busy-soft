import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rules = readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8");

describe("Firestore security contract", () => {
  it("has a deny-by-default fallback", () => {
    expect(rules).toContain("match /{document=**} { allow read, write: if false; }");
  });

  it("binds business-scoped writes to the path business id", () => {
    expect(rules).toContain("request.resource.data.businessId == businessId");
    expect(rules).toContain("resource.data.businessId == businessId && request.resource.data.businessId == businessId");
  });

  it("blocks direct financial mutation from clients", () => {
    for (const collection of ["vouchers", "voucherLines", "ledgerEntries", "partyAllocations", "payments", "stockMovements", "financialYears"]) {
      expect(rules).toContain(`match /${collection}/`);
    }
    expect(rules).toContain("match /vouchers/{voucherId} { allow read:");
    expect(rules).toContain("allow create, update, delete: if false;");
  });

  it("prevents direct party master writes during migration", () => {
    expect(rules).toContain("match /parties/{partyId} { allow read:");
    expect(rules).toContain("match /customers/{customerId} { allow read:");
    expect(rules).toContain("match /suppliers/{supplierId} { allow read:");
  });

  it("protects system accounting accounts from client mutation", () => {
    expect(rules).toContain("resource.data.systemAccount == false");
    expect(rules).toContain("request.resource.data.systemAccount == false");
  });
});
