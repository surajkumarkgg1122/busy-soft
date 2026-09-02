import { NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import type { BusinessMember } from "@/types";
import { calculateManufacturingCost, buildProductionConsumption, validateManufacturingConfig, type ManufacturingConfig } from "@/core/accounting/manufacturing";
import { validateVoucherLines } from "@/core/accounting/ledger";
import { createStockMovement } from "@/core/accounting/inventory";
import type { StockMovement, Voucher, VoucherLine } from "@/core/accounting/types";

export const runtime = "nodejs";
const responseError = (message: string, status = 400) => NextResponse.json({ success: false, error: message }, { status });
const text = (value: unknown) => String(value ?? "").trim();
const amount = (value: unknown, name: string) => { const n = Number(value ?? 0); if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer minor-unit amount.`); return n; };

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

function canCreate(m: BusinessMember) { return m.role === "owner" || m.role === "admin" || !!m.permissions?.items?.create; }

function safeQuantity(value: unknown, name: string) { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be greater than zero.`); return n; }

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

    const itemRef = db.collection("businesses").doc(businessId).collection("items").doc(itemId);
    const fyRef = db.collection("businesses").doc(businessId).collection("financialYears").doc(financialYearId);
    const productionRef = db.collection("businesses").doc(businessId).collection("productionVouchers").doc();
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const [itemSnap, fySnap] = await Promise.all([tx.get(itemRef), tx.get(fyRef)]);
      if (!itemSnap.exists) throw Object.assign(new Error("Finished item not found."), { statusCode: 404 });
      if (!fySnap.exists) throw new Error("Financial year not found.");
      const item = itemSnap.data() as Record<string, unknown>;
      const fy = fySnap.data() as Record<string, unknown>;
      if (String(item.businessId) !== businessId || String(fy.businessId) !== businessId) throw Object.assign(new Error("Business isolation check failed."), { statusCode: 403 });
      if (Boolean(fy.locked)) throw new Error("The financial year is locked.");
      const config = validateManufacturingConfig(item.manufacturing as ManufacturingConfig);

      const existing = await tx.get(db.collection("businesses").doc(businessId).collection("productionVouchers").where("idempotencyKey", "==", idempotencyKey).limit(1));
      if (!existing.empty) return existing.docs[0].data();

      const movementQuery = db.collection("businesses").doc(businessId).collection("stockMovements").where("financialYearId", "==", financialYearId);
      const movementSnap = await tx.get(movementQuery);
      const movements = movementSnap.docs.map((d) => d.data() as StockMovement);
      const materialUnitCosts: Record<string, number> = {};
      for (const component of config.bom) {
        const componentMovements = movements.filter((movement) => movement.itemId === component.itemId && (!warehouseId || !movement.warehouseId || movement.warehouseId === warehouseId));
        let quantityOnHand = 0;
        let valueOnHand = 0;
        for (const movement of componentMovements) {
          const sign = movement.direction === "in" ? 1 : -1;
          quantityOnHand += movement.quantity * sign;
          valueOnHand += movement.value * sign;
        }
        if (quantityOnHand <= 0) throw new Error(`Insufficient stock for BOM item ${component.itemId}.`);
        materialUnitCosts[component.itemId] = Math.max(0, Math.round(valueOnHand / quantityOnHand));
      }
      const costing = calculateManufacturingCost({ config, materialUnitCosts });
      const consumption = buildProductionConsumption(config, quantity);
      const consumptionValue = consumption.map((component) => ({ ...component, unitCost: component.unitCost ?? materialUnitCosts[component.itemId] }));
      let consumedValue = 0;
      for (const component of consumptionValue) consumedValue += Math.round(component.quantity * Number(component.unitCost));
      const overheadValue = costing.totalCost - costing.materialCost;
      const finishedUnitCost = Math.round(costing.totalCost / costing.outputQuantity);
      const finishedValue = Math.round(finishedUnitCost * quantity);

      const materialInventoryAccountId = text(body.materialInventoryAccountId) || text(config.manufacturingOverheadAccountId);
      const finishedGoodsAccountId = text(body.finishedGoodsAccountId) || text(config.finishedGoodsAccountId);
      const wipAccountId = text(body.wipAccountId) || text(config.wipAccountId);
      if (!materialInventoryAccountId || !finishedGoodsAccountId) throw new Error("Production accounting requires material inventory and finished-goods account IDs.");
      const accountIds = [materialInventoryAccountId, finishedGoodsAccountId, ...(overheadValue > 0 && wipAccountId ? [wipAccountId] : [])];
      const accounts = await Promise.all(accountIds.map((id) => tx.get(db.collection("businesses").doc(businessId).collection("accounts").doc(id))));
      if (accounts.some((account) => !account.exists || account.data()?.businessId !== businessId || account.data()?.active === false)) throw new Error("One or more production accounting accounts are invalid.");
      if (overheadValue > 0 && !wipAccountId) throw new Error("WIP account is required when production has labour or manufacturing overhead.");

      const voucherId = productionRef.id;
      const voucherNumber = `PROD-${Date.now()}`;
      const rawLines = [
        { accountId: finishedGoodsAccountId, description: `Finished goods: ${String(item.name ?? itemId)}`, debit: finishedValue, credit: 0, itemId },
        ...(consumedValue > 0 ? [{ accountId: materialInventoryAccountId, description: "Raw material consumed", debit: 0, credit: consumedValue, itemId: undefined }] : []),
        ...(overheadValue > 0 ? [{ accountId: wipAccountId, description: "Manufacturing labour and overhead absorbed", debit: 0, credit: overheadValue, itemId: undefined }] : []),
      ];
      const totalCredit = consumedValue + overheadValue;
      if (finishedValue !== totalCredit) throw new Error("Production costing imbalance. Check BOM cost and output quantity.");
      const lines: VoucherLine[] = rawLines.map((line, index) => ({ ...line, lineId: `${voucherId}-line-${index + 1}`, voucherId, businessId, lineNo: index + 1 }));
      validateVoucherLines(lines);
      const voucher: Voucher = { id: voucherId, businessId, financialYearId, voucherType: "PRODUCTION", voucherNumber, date, status: "posted", referenceType: "production", referenceId: voucherId, narration: `Production of ${String(item.name ?? itemId)}`, totalDebit: finishedValue, totalCredit, createdBy: token.uid, createdAt: now, updatedAt: now, idempotencyKey };

      const stockOut: StockMovement[] = consumptionValue.map((component, index) => createStockMovement({ businessId, financialYearId, date, itemId: component.itemId, warehouseId, direction: "out", quantity: component.quantity, unitCost: Number(component.unitCost), value: Math.round(component.quantity * Number(component.unitCost)), sourceType: "production_consumption", sourceId: voucherId, createdBy: token.uid }, { next: (prefix) => `${prefix}-${voucherId}-${index}` }, now));
      const stockIn = createStockMovement({ businessId, financialYearId, date, itemId, warehouseId, direction: "in", quantity, unitCost: finishedUnitCost, value: finishedValue, sourceType: "production", sourceId: voucherId, createdBy: token.uid, manufactureDate: date }, { next: (prefix) => `${prefix}-${voucherId}-finished` }, now);
      const record = { id: voucherId, businessId, financialYearId, itemId, itemName: String(item.name ?? itemId), quantity, outputQuantity: costing.outputQuantity, materialCost: costing.materialCost, labourCost: costing.labourCost, electricityCost: costing.electricityCost, machineCost: costing.machineCost, overheadCost: costing.overheadCost, otherCost: costing.otherCost, totalCost: costing.totalCost, unitCost: finishedUnitCost, consumedValue, overheadValue, warehouseId: warehouseId ?? null, date, voucherNumber, idempotencyKey, status: "posted", createdBy: token.uid, createdAt: now };
      tx.set(productionRef, record);
      tx.set(db.collection("businesses").doc(businessId).collection("vouchers").doc(voucherId), voucher);
      for (const line of lines) tx.set(db.collection("businesses").doc(businessId).collection("voucherLines").doc(line.lineId), line);
      for (const line of lines) tx.set(db.collection("businesses").doc(businessId).collection("ledgerEntries").doc(line.lineId), { ...line, date, voucherType: "PRODUCTION", voucherNumber, createdAt: now });
      for (const movement of [...stockOut, stockIn]) tx.set(db.collection("businesses").doc(businessId).collection("stockMovements").doc(movement.id), movement);
      tx.set(db.collection("businesses").doc(businessId).collection("atomicAccountingDocuments").doc(voucherId), { id: voucherId, businessId, financialYearId, type: "production", voucherId, idempotencyKey, status: "posted", date, createdBy: token.uid, createdAt: now, payload: record });
      tx.set(db.collection("businesses").doc(businessId).collection("auditEvents").doc(`${voucherId}-production`), { id: `${voucherId}-production`, businessId, entityType: "production", entityId: voucherId, action: "PRODUCTION_POSTED", userId: token.uid, timestamp: now, after: record });
      return record;
    });
    return NextResponse.json({ success: true, production: result });
  } catch (error) {
    return responseError(error instanceof Error ? error.message : "Could not post production.", (error as { statusCode?: number }).statusCode || 400);
  }
}
