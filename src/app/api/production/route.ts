import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import type { BusinessMember } from "@/types";
import { calculateManufacturingCost, buildProductionConsumption, validateManufacturingConfig, type ManufacturingConfig } from "@/core/accounting/manufacturing";
import { assertBalanced, validateVoucherLines } from "@/core/accounting/ledger";
import { createStockMovement } from "@/core/accounting/inventory";
import type { StockMovement, Voucher, VoucherLine } from "@/core/accounting/types";

export const runtime = "nodejs";
const responseError = (message: string, status = 400) => NextResponse.json({ success: false, error: message }, { status });
const text = (value: unknown) => String(value ?? "").trim();

async function authenticate(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) throw new Error("Authentication is required.");
  return { db, token: await auth.verifyIdToken(header.slice(7)) };
}

async function member(db: Firestore, businessId: string, uid: string) {
  const snap = await db.collection("businesses").doc(businessId).collection("members").doc(uid).get();
  if (!snap.exists) throw Object.assign(new Error("You are not a member of this business."), { statusCode: 403 });
  const m = snap.data() as BusinessMember;
  if (m.status !== "active") throw Object.assign(new Error("Your business membership is not active."), { statusCode: 403 });
  return m;
}

function canView(m: BusinessMember) {
  return m.role === "owner" || m.role === "admin" || !!m.permissions?.items?.view || !!m.permissions?.items?.create;
}
function canCreate(m: BusinessMember) {
  return m.role === "owner" || m.role === "admin" || !!m.permissions?.items?.create;
}
function safeQuantity(value: unknown, name: string) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be greater than zero.`);
  return n;
}
function dateInFY(date: string, fy: Record<string, unknown>) {
  return date >= String(fy.startDate || "") && date <= String(fy.endDate || "");
}

async function activeFY(db: Firestore, businessId: string) {
  const s = await db.collection("businesses").doc(businessId).collection("financialYears").where("locked", "==", false).get();
  return s.docs.sort((a, b) => String(b.data()?.startDate || "").localeCompare(String(a.data()?.startDate || "")))[0] || null;
}

export async function GET(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const url = new URL(request.url);
    const businessId = text(url.searchParams.get("businessId"));
    if (!businessId) return responseError("Business ID is required.");
    const m = await member(db, businessId, token.uid);
    if (!canView(m)) return responseError("Permission denied: production view.", 403);
    const fy = await activeFY(db, businessId);
    if (!fy) return responseError("No active financial year is configured.");
    const s = await db.collection("businesses").doc(businessId).collection("productionVouchers").where("financialYearId", "==", fy.id).limit(200).get();
    const productions = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => String(b.date || "").localeCompare(String(a.date || "")));
    return NextResponse.json({ success: true, financialYearId: fy.id, productions });
  } catch (e) {
    return responseError(e instanceof Error ? e.message : "Unable to load production.", (e as { statusCode?: number }).statusCode || 400);
  }
}

export async function POST(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const body = await request.json() as Record<string, unknown>;
    const businessId = text(body.businessId);
    const itemId = text(body.itemId);
    const financialYearId = text(body.financialYearId);
    const idempotencyKey = text(body.idempotencyKey);
    const date = text(body.date) || new Date().toISOString().slice(0, 10);
    const warehouseId = text(body.warehouseId) || undefined;
    const quantity = safeQuantity(body.quantity, "Production quantity");
    if (!businessId || !itemId || !financialYearId || idempotencyKey.length < 16) return responseError("businessId, itemId, financialYearId and an idempotencyKey of at least 16 characters are required.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return responseError("Production date must use YYYY-MM-DD format.");
    const m = await member(db, businessId, token.uid);
    if (!canCreate(m)) return responseError("Permission denied: production entry.", 403);

    const root = db.collection("businesses").doc(businessId);
    const itemRef = root.collection("items").doc(itemId);
    const fyRef = root.collection("financialYears").doc(financialYearId);
    const productionRef = root.collection("productionVouchers").doc();
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const [itemSnap, fySnap] = await Promise.all([tx.get(itemRef), tx.get(fyRef)]);
      if (!itemSnap.exists) throw Object.assign(new Error("Finished item not found."), { statusCode: 404 });
      if (!fySnap.exists) throw new Error("Financial year not found.");
      const item = itemSnap.data() as Record<string, unknown>;
      const fy = fySnap.data() as Record<string, unknown>;
      if (String(item.businessId) !== businessId || String(fy.businessId) !== businessId) throw Object.assign(new Error("Business isolation check failed."), { statusCode: 403 });
      if (Boolean(fy.locked)) throw new Error("The financial year is locked.");
      if (!dateInFY(date, fy)) throw new Error("Production date must fall inside the selected financial year.");

      const existing = await tx.get(root.collection("productionVouchers").where("idempotencyKey", "==", idempotencyKey).limit(1));
      if (!existing.empty) return existing.docs[0].data();

      const config = validateManufacturingConfig(item.manufacturing as ManufacturingConfig);
      const batchOutput = config.batchQuantity * (1 - Number(config.wastagePercent || 0) / 100);
      const productionRatio = quantity / batchOutput;
      if (!Number.isFinite(productionRatio) || productionRatio <= 0) throw new Error("Invalid production quantity for this manufacturing batch.");

      const movementSnap = await tx.get(root.collection("stockMovements").where("financialYearId", "==", financialYearId));
      const movements = movementSnap.docs.map((d) => d.data() as StockMovement);
      const materialUnitCosts: Record<string, number> = {};
      const requiredConsumption = buildProductionConsumption(config, quantity);

      for (const component of requiredConsumption) {
        const itemMovements = movements.filter((x) => x.itemId === component.itemId && (!warehouseId || !x.warehouseId || x.warehouseId === warehouseId));
        let availableQuantity = 0;
        let availableValue = 0;
        for (const movement of itemMovements) {
          const sign = movement.direction === "in" ? 1 : -1;
          availableQuantity += movement.quantity * sign;
          availableValue += movement.value * sign;
        }
        if (availableQuantity + 1e-9 < component.quantity) throw new Error(`Insufficient stock for BOM item ${component.itemId}: required ${component.quantity}, available ${Math.max(0, availableQuantity)}.`);
        const unitCost = component.unitCost ?? (availableQuantity > 0 ? Math.max(0, Math.round(availableValue / availableQuantity)) : undefined);
        if (unitCost === undefined) throw new Error(`No cost is available for BOM item ${component.itemId}.`);
        materialUnitCosts[component.itemId] = unitCost;
      }

      const batchCosting = calculateManufacturingCost({ config, materialUnitCosts });
      const costing = {
        materialCost: Math.round(batchCosting.materialCost * productionRatio),
        labourCost: Math.round(batchCosting.labourCost * productionRatio),
        electricityCost: Math.round(batchCosting.electricityCost * productionRatio),
        machineCost: Math.round(batchCosting.machineCost * productionRatio),
        overheadCost: Math.round(batchCosting.overheadCost * productionRatio),
        otherCost: Math.round(batchCosting.otherCost * productionRatio),
        totalCost: 0,
      };
      costing.totalCost = costing.materialCost + costing.labourCost + costing.electricityCost + costing.machineCost + costing.overheadCost + costing.otherCost;
      const consumptionValue = requiredConsumption.reduce((sum, c) => sum + Math.round(c.quantity * Number(c.unitCost ?? materialUnitCosts[c.itemId])), 0);
      const overheadValue = costing.totalCost - costing.materialCost;
      const finishedValue = costing.totalCost;
      if (consumptionValue !== costing.materialCost) throw new Error("Production material valuation mismatch. Check BOM costing and stock valuation.");
      if (!Number.isSafeInteger(finishedValue) || finishedValue < 0) throw new Error("Production cost exceeds safe integer range.");

      const materialInventoryAccountId = text(body.materialInventoryAccountId);
      const finishedGoodsAccountId = text(body.finishedGoodsAccountId) || text(config.finishedGoodsAccountId);
      const wipAccountId = text(body.wipAccountId) || text(config.wipAccountId) || text(config.manufacturingOverheadAccountId);
      if (!materialInventoryAccountId || !finishedGoodsAccountId) throw new Error("Production accounting requires material inventory and finished-goods account IDs.");
      if (overheadValue > 0 && !wipAccountId) throw new Error("WIP account is required when production has labour or manufacturing overhead.");

      const accountIds = [materialInventoryAccountId, finishedGoodsAccountId, ...(overheadValue > 0 ? [wipAccountId] : [])];
      const accounts = await Promise.all(accountIds.map((id) => tx.get(root.collection("accounts").doc(id))));
      if (accounts.some((a) => !a.exists || a.data()?.businessId !== businessId || a.data()?.active === false)) throw new Error("One or more production accounting accounts are invalid.");

      const voucherId = productionRef.id;
      const voucherNumber = `PROD-${Date.now()}-${voucherId.slice(-5)}`;
      const rawLines = [
        { accountId: finishedGoodsAccountId, description: `Finished goods: ${String(item.name ?? itemId)}`, debit: finishedValue, credit: 0, itemId },
        ...(costing.materialCost > 0 ? [{ accountId: materialInventoryAccountId, description: "Raw material consumed", debit: 0, credit: costing.materialCost }] : []),
        ...(overheadValue > 0 ? [{ accountId: wipAccountId!, description: "Labour and manufacturing overhead absorbed", debit: 0, credit: overheadValue }] : []),
      ];
      assertBalanced(rawLines);
      const lines: VoucherLine[] = rawLines.map((line, index) => ({ ...line, lineId: `${voucherId}-line-${index + 1}`, voucherId, businessId, lineNo: index + 1 }));
      validateVoucherLines(lines);
      const voucher: Voucher = { id: voucherId, businessId, financialYearId, voucherType: "PRODUCTION", voucherNumber, date, status: "posted", referenceType: "production", referenceId: voucherId, narration: `Production of ${String(item.name ?? itemId)}`, totalDebit: finishedValue, totalCredit: finishedValue, createdBy: token.uid, createdAt: now, updatedAt: now, idempotencyKey };
      const ids = { next: (prefix: string) => `${prefix}-${voucherId}-${Math.random().toString(36).slice(2, 8)}` };
      const stockOut = requiredConsumption.map((c) => createStockMovement({ businessId, financialYearId, date, itemId: c.itemId, warehouseId, direction: "out", quantity: c.quantity, unitCost: Number(c.unitCost ?? materialUnitCosts[c.itemId]), sourceType: "production_consumption", sourceId: voucherId, createdBy: token.uid }, ids, now));
      const finishedUnitCost = Math.round(finishedValue / quantity);
      const stockIn = createStockMovement({ businessId, financialYearId, date, itemId, warehouseId, direction: "in", quantity, unitCost: finishedUnitCost, sourceType: "production", sourceId: voucherId, createdBy: token.uid, manufactureDate: date }, ids, now);
      if (stockIn.value !== finishedValue) throw new Error("Production stock valuation rounding mismatch.");

      const record = { id: voucherId, businessId, financialYearId, itemId, itemName: String(item.name ?? itemId), quantity, outputQuantity: quantity, batchQuantity: config.batchQuantity, materialCost: costing.materialCost, labourCost: costing.labourCost, electricityCost: costing.electricityCost, machineCost: costing.machineCost, overheadCost: costing.overheadCost, otherCost: costing.otherCost, totalCost: finishedValue, unitCost: finishedUnitCost, consumedValue: consumptionValue, overheadValue, warehouseId: warehouseId ?? null, date, voucherNumber, idempotencyKey, status: "posted", createdBy: token.uid, createdAt: now };
      tx.set(productionRef, record);
      tx.set(root.collection("vouchers").doc(voucherId), voucher);
      for (const line of lines) {
        tx.set(root.collection("voucherLines").doc(line.lineId), line);
        tx.set(root.collection("ledgerEntries").doc(line.lineId), { ...line, date, voucherType: "PRODUCTION", voucherNumber, createdAt: now });
      }
      for (const movement of [...stockOut, stockIn]) tx.set(root.collection("stockMovements").doc(movement.id), movement);
      tx.set(root.collection("atomicAccountingDocuments").doc(voucherId), { id: voucherId, businessId, financialYearId, type: "production", voucherId, idempotencyKey, status: "posted", date, createdBy: token.uid, createdAt: now, payload: record });
      tx.set(root.collection("auditEvents").doc(`${voucherId}-production`), { id: `${voucherId}-production`, businessId, entityType: "production", entityId: voucherId, action: "PRODUCTION_POSTED", userId: token.uid, timestamp: now, after: record });
      return record;
    });
    return NextResponse.json({ success: true, production: result });
  } catch (error) {
    return responseError(error instanceof Error ? error.message : "Could not post production.", (error as { statusCode?: number }).statusCode || 400);
  }
}
