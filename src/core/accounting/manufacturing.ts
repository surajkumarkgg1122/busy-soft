import { ValidationError } from "./errors";
import type { Money } from "./types";

export type ManufacturingCostType = "material" | "labour" | "electricity" | "machine" | "overhead" | "other";

export interface BomComponent {
  itemId: string;
  quantity: number;
  scrapPercent?: number;
  unitCost?: Money;
  notes?: string;
}

export interface ManufacturingCostComponent {
  type: ManufacturingCostType;
  name: string;
  amount: Money;
  accountId?: string;
  allocationBasis?: "direct" | "per_unit" | "percentage" | "quantity";
  notes?: string;
}

export interface ManufacturingConfig {
  enabled: boolean;
  bom: BomComponent[];
  batchQuantity: number;
  wastagePercent?: number;
  costComponents?: ManufacturingCostComponent[];
  costingMethod?: "standard" | "actual";
  finishedGoodsAccountId?: string;
  wipAccountId?: string;
  manufacturingOverheadAccountId?: string;
}

export interface ManufacturingCostResult {
  materialCost: Money;
  labourCost: Money;
  electricityCost: Money;
  machineCost: Money;
  overheadCost: Money;
  otherCost: Money;
  totalCost: Money;
  outputQuantity: number;
  unitCost: Money;
}

function money(value: unknown, name: string): Money {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n) || n < 0) throw new ValidationError(`${name} must be a non-negative integer minor-unit amount.`);
  return n;
}

function positiveQuantity(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new ValidationError(`${name} must be greater than zero.`);
  return n;
}

export function validateManufacturingConfig(config: ManufacturingConfig): ManufacturingConfig {
  if (!config || config.enabled !== true) throw new ValidationError("Manufacturing configuration must be enabled for a manufactured item.");
  if (!Array.isArray(config.bom) || config.bom.length === 0) throw new ValidationError("A manufactured item requires at least one BOM component.");
  const seen = new Set<string>();
  const bom = config.bom.map((component, index) => {
    const itemId = String(component.itemId ?? "").trim();
    if (!itemId) throw new ValidationError(`BOM component ${index + 1} requires an item.`);
    if (seen.has(itemId)) throw new ValidationError(`BOM component ${itemId} is duplicated.`);
    seen.add(itemId);
    const quantity = positiveQuantity(component.quantity, `BOM component ${itemId} quantity`);
    const scrapPercent = Number(component.scrapPercent ?? 0);
    if (!Number.isFinite(scrapPercent) || scrapPercent < 0 || scrapPercent > 100) throw new ValidationError(`BOM component ${itemId} scrap percentage must be between 0 and 100.`);
    return { itemId, quantity, ...(scrapPercent ? { scrapPercent } : {}), ...(component.unitCost !== undefined ? { unitCost: money(component.unitCost, `BOM component ${itemId} cost`) } : {}), ...(component.notes?.trim() ? { notes: component.notes.trim() } : {}) };
  });
  const batchQuantity = positiveQuantity(config.batchQuantity, "Manufacturing batch quantity");
  const wastagePercent = Number(config.wastagePercent ?? 0);
  if (!Number.isFinite(wastagePercent) || wastagePercent < 0 || wastagePercent >= 100) throw new ValidationError("Manufacturing wastage percentage must be between 0 and less than 100.");
  const costComponents = (config.costComponents ?? []).map((component, index) => {
    const name = String(component.name ?? "").trim();
    if (!name) throw new ValidationError(`Manufacturing cost component ${index + 1} requires a name.`);
    return { type: component.type, name, amount: money(component.amount, `${name} amount`), ...(component.accountId?.trim() ? { accountId: component.accountId.trim() } : {}), ...(component.allocationBasis ? { allocationBasis: component.allocationBasis } : {}), ...(component.notes?.trim() ? { notes: component.notes.trim() } : {}) };
  });
  return { enabled: true, bom, batchQuantity, ...(wastagePercent ? { wastagePercent } : {}), costComponents, costingMethod: config.costingMethod ?? "actual", ...(config.finishedGoodsAccountId?.trim() ? { finishedGoodsAccountId: config.finishedGoodsAccountId.trim() } : {}), ...(config.wipAccountId?.trim() ? { wipAccountId: config.wipAccountId.trim() } : {}), ...(config.manufacturingOverheadAccountId?.trim() ? { manufacturingOverheadAccountId: config.manufacturingOverheadAccountId.trim() } : {}) };
}

export function calculateManufacturingCost(input: { config: ManufacturingConfig; materialUnitCosts: Record<string, Money> }): ManufacturingCostResult {
  const config = validateManufacturingConfig(input.config);
  let materialCost = 0;
  for (const component of config.bom) {
    const unitCost = component.unitCost ?? input.materialUnitCosts[component.itemId];
    if (unitCost === undefined) throw new ValidationError(`No cost is available for BOM item ${component.itemId}.`);
    const cost = component.quantity * (1 + Number(component.scrapPercent ?? 0) / 100) * unitCost * config.batchQuantity;
    if (!Number.isSafeInteger(Math.round(cost))) throw new ValidationError("Manufacturing material cost exceeds safe integer range.");
    materialCost += Math.round(cost);
  }
  const costs = { labourCost: 0, electricityCost: 0, machineCost: 0, overheadCost: 0, otherCost: 0 };
  for (const component of config.costComponents ?? []) {
    const amount = component.amount;
    if (component.type === "labour") costs.labourCost += amount;
    else if (component.type === "electricity") costs.electricityCost += amount;
    else if (component.type === "machine") costs.machineCost += amount;
    else if (component.type === "overhead") costs.overheadCost += amount;
    else if (component.type === "other") costs.otherCost += amount;
    else materialCost += amount;
  }
  const totalCost = materialCost + costs.labourCost + costs.electricityCost + costs.machineCost + costs.overheadCost + costs.otherCost;
  if (!Number.isSafeInteger(totalCost)) throw new ValidationError("Total manufacturing cost exceeds safe integer range.");
  const outputQuantity = config.batchQuantity * (1 - Number(config.wastagePercent ?? 0) / 100);
  if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) throw new ValidationError("Manufacturing output quantity must be greater than zero.");
  return { ...costs, materialCost, totalCost, outputQuantity, unitCost: Math.round(totalCost / outputQuantity) };
}

export function buildProductionConsumption(config: ManufacturingConfig, productionQuantity: number): BomComponent[] {
  const normalized = validateManufacturingConfig(config);
  const ratio = positiveQuantity(productionQuantity, "Production quantity") / normalized.batchQuantity;
  return normalized.bom.map((component) => ({ ...component, quantity: component.quantity * ratio }));
}
