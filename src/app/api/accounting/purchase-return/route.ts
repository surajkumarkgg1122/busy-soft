import { NextResponse } from "next/server";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { createPurchaseReturn } from "@/application/purchases/returnService";
import { resolveFinancialYear } from "@/core/accounting/financialYear";
import { validateReturnAgainstOriginal, type ReturnItem } from "@/core/accounting/returns";
import type { Account, StockMovement, VoucherLine } from "@/core/accounting/types";
import type { AccountingPermission } from "@/core/accounting/authorization";

export const runtime = "nodejs";
const errorResponse = (message: string, status = 400) => NextResponse.json({ success: false, error: message }, { status });
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : Number(v ?? 0);

function accountByName(accounts: Account[], patterns: string[]): string | undefined {
  return accounts.find(a => patterns.every(p => a.name.toLowerCase().includes(p.toLowerCase())))?.id;
}
function accountByCode(accounts: Account[], code: string): string | undefined { return accounts.find(a => a.code === code)?.id; }
function assetSettlementAccount(accounts: Account[], lines: VoucherLine[], partyId?: string): string | undefined {
  return lines.find(l => l.credit > 0 && accounts.some(a => a.id === l.accountId && a.active && a.type === "asset") && l.partyId !== partyId)?.accountId;
}

export async function POST(request: Request) {
  try {
    const { auth, db } = getAdminServices();
    const header = request.headers.get("authorization") || "";
    if (!header.startsWith("Bearer ")) return errorResponse("Authentication is required.", 401);
    const token = await auth.verifyIdToken(header.slice(7));
    const body = await request.json() as Record<string, unknown>;
    const businessId = text(body.businessId), date = text(body.date), originalVoucherId = text(body.originalVoucherId), idempotencyKey = text(body.idempotencyKey);
    const mode = text(body.mode) as "credit" | "cash" | "bank";
    if (!businessId || !date || !originalVoucherId || !idempotencyKey) return errorResponse("Business, return date, original purchase and idempotency key are required.");
    if (!["credit", "cash", "bank"].includes(mode)) return errorResponse("Invalid purchase return settlement mode.");

    const businessRef = db.collection("businesses").doc(businessId);
    const memberSnap = await businessRef.collection("members").doc(token.uid).get();
    if (!memberSnap.exists) return errorResponse("You are not a member of this business.", 403);
    const member = memberSnap.data() as { status?: string; role?: string; permissions?: Record<string, unknown> };
    if (member.status !== "active") return errorResponse("Your business membership is not active.", 403);
    const permissions = (member.permissions?.purchase ?? {}) as Record<string, unknown>;
    if (!(member.role === "owner" || member.role === "admin" || permissions.returnCreate === true || permissions.create === true)) return errorResponse("Permission denied: RETURN_CREATE.", 403);

    const businessSnap = await businessRef.get();
    if (!businessSnap.exists) return errorResponse("Business does not exist.");
    const business = businessSnap.data() as { setupStatus?: string; financialYearStartMonth?: number };
    if (business.setupStatus && business.setupStatus !== "ready") return errorResponse("Business accounting setup is not ready.");
    const fy = resolveFinancialYear(date, Number(business.financialYearStartMonth ?? 4));
    const fySnap = await businessRef.collection("financialYears").doc(fy.id).get();
    if (!fySnap.exists) return errorResponse("Financial year is not initialized for this business.");
    const fyData = fySnap.data() as { locked?: boolean; status?: string };
    if (fyData.locked === true || fyData.status === "locked") return errorResponse("Financial year is locked.");

    const originalSnap = await businessRef.collection("vouchers").doc(originalVoucherId).get();
    if (!originalSnap.exists) return errorResponse("Original purchase voucher was not found.");
    const original = originalSnap.data() as { businessId?: string; financialYearId?: string; voucherType?: string; status?: string };
    if (original.businessId !== businessId || original.financialYearId !== fy.id || original.voucherType !== "PURCHASE" || original.status !== "posted") return errorResponse("Only a posted purchase from this business and financial year can be returned.");

    const [accountsSnap, linesSnap, movementSnap, priorSnap] = await Promise.all([
      businessRef.collection("accounts").get(),
      businessRef.collection("voucherLines").where("voucherId", "==", originalVoucherId).get(),
      businessRef.collection("stockMovements").where("sourceId", "==", originalVoucherId).get(),
      businessRef.collection("vouchers").where("referenceType", "==", "purchase_return").where("referenceId", "==", originalVoucherId).get(),
    ]);
    const accounts = accountsSnap.docs.map(d => ({ id: d.id, ...d.data() } as Account));
    const lines = linesSnap.docs.map(d => d.data() as VoucherLine);
    const originalMovements = movementSnap.docs.map(d => d.data() as StockMovement).filter(m => m.sourceType === "purchase");
    if (!originalMovements.length) return errorResponse("Original purchase has no stock movements available for return.");
    const priorMovements = (await Promise.all(priorSnap.docs.map(async d => (await businessRef.collection("stockMovements").where("sourceId", "==", d.id).get()).docs.map(x => x.data() as StockMovement)))).flat().filter(m => m.sourceType === "purchase_return");

    const requested = Array.isArray(body.items) ? body.items as Array<Record<string, unknown>> : [];
    const items: ReturnItem[] = requested.map(raw => ({
      itemId: text(raw.itemId), quantity: num(raw.quantity), warehouseId: text(raw.warehouseId) || undefined, batchId: text(raw.batchId) || undefined, batchNumber: text(raw.batchNumber) || undefined,
      manufactureDate: text(raw.manufactureDate) || undefined, expiryDate: text(raw.expiryDate) || undefined, serialNumbers: Array.isArray(raw.serialNumbers) ? raw.serialNumbers.map(String) : undefined,
      unitId: text(raw.unitId) || undefined, quantityInBaseUnit: raw.quantityInBaseUnit === undefined ? undefined : num(raw.quantityInBaseUnit),
    }));
    const validatedItems = validateReturnAgainstOriginal(items, originalMovements, priorMovements);
    const inventoryValue = validatedItems.reduce((sum, item) => sum + Math.round(item.quantity * item.unitCost), 0);
    if (!Number.isSafeInteger(inventoryValue) || inventoryValue <= 0) return errorResponse("Return inventory value is invalid.");

    const supplierFromLine = lines.find(l => typeof l.partyId === "string" && l.partyId)?.partyId;
    const supplierId = text(body.supplierId) || supplierFromLine || undefined;
    let partyLedger: string | undefined;
    if (supplierId) {
      const partySnap = await businessRef.collection("parties").doc(supplierId).get();
      if (!partySnap.exists) return errorResponse("Selected supplier does not exist.");
      const party = partySnap.data() as { businessId?: string; kind?: string; status?: string; ledgerAccountId?: string; payableLedgerAccountId?: string };
      if (party.businessId !== businessId || !["supplier", "both"].includes(String(party.kind))) return errorResponse("Selected party is not a supplier of this business.");
      if (party.status !== "active") return errorResponse("Selected supplier is inactive.");
      partyLedger = party.payableLedgerAccountId || party.ledgerAccountId;
      if (!partyLedger) return errorResponse("Selected supplier has no payable ledger account.");
    }
    if (mode === "credit" && !partyLedger) return errorResponse("Supplier is required for a credit purchase return.");

    const inventory = accountByCode(accounts, "1300") || accountByName(accounts, ["inventory"]);
    const inputCgst = accountByName(accounts, ["input", "cgst"]);
    const inputSgst = accountByName(accounts, ["input", "sgst"]);
    const inputIgst = accountByName(accounts, ["input", "igst"]);
    const inputCess = accountByName(accounts, ["input", "cess"]);
    if (!inventory) return errorResponse("Inventory account is not configured.");
    const originalSettlement = assetSettlementAccount(accounts, lines, partyLedger);
    const settlement = mode === "credit" ? partyLedger : originalSettlement;
    if (!settlement) return errorResponse(`Could not determine the original ${mode} settlement account.`);
    const settlementAccount = accounts.find(a => a.id === settlement);
    if (!settlementAccount?.active || settlementAccount.type !== "asset" && mode !== "credit") return errorResponse("Purchase refund settlement account is invalid.");

    const taxableOriginal = lines.filter(l => l.accountId === inventory).reduce((s, l) => s + l.debit - l.credit, 0);
    const cgst = inputCgst ? lines.filter(l => l.accountId === inputCgst).reduce((s, l) => s + l.debit - l.credit, 0) : 0;
    const sgst = inputSgst ? lines.filter(l => l.accountId === inputSgst).reduce((s, l) => s + l.debit - l.credit, 0) : 0;
    const igst = inputIgst ? lines.filter(l => l.accountId === inputIgst).reduce((s, l) => s + l.debit - l.credit, 0) : 0;
    const cess = inputCess ? lines.filter(l => l.accountId === inputCess).reduce((s, l) => s + l.debit - l.credit, 0) : 0;
    if (taxableOriginal <= 0) return errorResponse("Original purchase has no taxable inventory value.");
    const taxRate = Number((((cgst + sgst + igst) / taxableOriginal) * 100).toFixed(6));
    const cessRate = Number(((cess / taxableOriginal) * 100).toFixed(6));
    const intraState = cgst > 0 || sgst > 0;

    const repo = createAdminAccountingRepository(businessId);
    const result = await createPurchaseReturn(
      { repo, ids: { next: prefix => `${prefix}-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } },
      { businessId, userId: token.uid, financialYearId: fy.id, idempotencyKey, permissions: ["RETURN_CREATE" as AccountingPermission] },
      {
        date, supplierId, taxableValue: inventoryValue, taxRate, intraState, cessRate,
        narration: text(body.narration) || undefined, originalVoucherId, mode,
        accountMap: { party: partyLedger, cash: mode === "cash" ? settlement : undefined, bank: mode === "bank" ? settlement : undefined, inventory, inputCgst, inputSgst, inputIgst, inputCess },
        items,
      },
    );
    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not post purchase return.";
    const status = /authentication|token|credential/i.test(message) ? 401 : /permission|member/i.test(message) ? 403 : /conflict|duplicate|idempotency/i.test(message) ? 409 : 400;
    return errorResponse(message, status);
  }
}
