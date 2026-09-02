import type { AccountingRepository, Money, PostingResult, VoucherLineInput } from "./types";
import type { AccountingPermission } from "./authorization";
import { assertAuthorized, assertTrustedPostingBoundary } from "./authorization";
import { postIdempotentVoucher } from "./atomic";
import { reverseVoucher } from "./voucher";
import { createStockMovement } from "./inventory";
import { calculateManufacturingCost, buildProductionConsumption, validateManufacturingConfig, type ManufacturingConfig } from "./manufacturing";
import { ValidationError } from "./errors";
import { assertQuantity } from "./money";
import type { TransactionDeps } from "./transactions";

export interface ProductionInput { businessId:string; financialYearId:string; date:string; userId:string; itemId:string; quantity:number; warehouseId?:string; materialInventoryAccountId:string; finishedGoodsAccountId?:string; wipAccountId?:string; config:ManufacturingConfig; idempotencyKey:string; }
export interface ProductionCancelInput { businessId:string; productionId:string; userId:string; permissions:AccountingPermission[]; }

export async function postProduction(repo:AccountingRepository,input:ProductionInput,deps:TransactionDeps):Promise<PostingResult>{
  assertTrustedPostingBoundary({businessId:input.businessId,userId:input.userId,permissions:[]});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Production date must be YYYY-MM-DD.");
  assertQuantity(input.quantity); if(!input.idempotencyKey)throw new ValidationError("Idempotency key is required.");
  const config=validateManufacturingConfig(input.config);
  return repo.runInTransaction(async tx=>{
    const fy=await tx.getFinancialYear(input.financialYearId); if(!fy)throw new ValidationError("Financial year not found.");
    if(fy.businessId!==input.businessId)throw new ValidationError("Financial year belongs to another business."); if(fy.locked)throw new ValidationError("Financial year is locked.");
    if(input.date<fy.startDate||input.date>fy.endDate)throw new ValidationError("Production date is outside the financial year.");
    const item=await tx.getBusinessDocument("items",input.itemId); if(!item)throw new ValidationError("Finished item not found."); if(String(item.businessId)!==input.businessId)throw new ValidationError("Finished item belongs to another business.");
    const existing=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey); if(existing)return{voucher:existing,lines:await tx.getVoucherLines(existing.id),ledgerEntries:[],stockMovements:await tx.getStockMovementsForSource(existing.id)};
    const consumption=buildProductionConsumption(config,input.quantity); const materialUnitCosts:Record<string,Money>={};
    for(const c of consumption){const source=await tx.getStockMovementsForItem(c.itemId,input.warehouseId,input.date);let q=0,v=0;for(const m of source){q+=m.direction==="in"?m.quantity:-m.quantity;v+=m.direction==="in"?m.value:-m.value;}if(q+1e-9<c.quantity)throw new ValidationError(`Insufficient stock for BOM item ${c.itemId}: required ${c.quantity}, available ${Math.max(0,q)}.`);const unit=c.unitCost??(q>0?Math.max(0,Math.round(v/q)):undefined);if(unit===undefined)throw new ValidationError(`No cost is available for BOM item ${c.itemId}.`);materialUnitCosts[c.itemId]=unit;}
    const batch=calculateManufacturingCost({config,materialUnitCosts}); const ratio=input.quantity/batch.outputQuantity;
    const costs={materialCost:Math.round(batch.materialCost*ratio),labourCost:Math.round(batch.labourCost*ratio),electricityCost:Math.round(batch.electricityCost*ratio),machineCost:Math.round(batch.machineCost*ratio),overheadCost:Math.round(batch.overheadCost*ratio),otherCost:Math.round(batch.otherCost*ratio)};
    const total=costs.materialCost+costs.labourCost+costs.electricityCost+costs.machineCost+costs.overheadCost+costs.otherCost; const overhead=total-costs.materialCost;
    if(!Number.isSafeInteger(total))throw new ValidationError("Production cost exceeds safe integer range.");
    const finishedAccount=input.finishedGoodsAccountId||config.finishedGoodsAccountId; if(!finishedAccount)throw new ValidationError("Finished-goods inventory account is required."); const wip=input.wipAccountId||config.wipAccountId||config.manufacturingOverheadAccountId; if(overhead>0&&!wip)throw new ValidationError("WIP/manufacturing overhead account is required.");
    for(const id of [input.materialInventoryAccountId,finishedAccount,...(overhead>0?[wip!]:[])]){const a=await tx.getAccount(id);if(!a||!a.active)throw new ValidationError(`Invalid or inactive production account: ${id}.`);}
    const lines:VoucherLineInput[]=[{accountId:finishedAccount,description:`Finished goods: ${String(item.name??input.itemId)}`,debit:total,credit:0,itemId:input.itemId,warehouseId:input.warehouseId},{accountId:input.materialInventoryAccountId,description:"Raw material consumed",debit:0,credit:costs.materialCost},...(overhead>0?[{accountId:wip!,description:"Labour and manufacturing overhead absorbed",debit:0,credit:overhead}]:[])];
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"PRODUCTION",prefix:"PROD",date:input.date,narration:`Production of ${String(item.name??input.itemId)}`,referenceType:"production",referenceId:input.itemId,createdBy:input.userId,lines,idempotencyKey:input.idempotencyKey},deps);
    const stockOut=consumption.map(c=>createStockMovement({businessId:input.businessId,financialYearId:input.financialYearId,date:input.date,itemId:c.itemId,warehouseId:input.warehouseId,direction:"out",quantity:c.quantity,unitCost:Number(c.unitCost??materialUnitCosts[c.itemId]),sourceType:"production_consumption",sourceId:result.voucher.id,createdBy:input.userId},deps.ids,deps.clock.now()));
    const unitCost=Math.round(total/input.quantity);const stockIn=createStockMovement({businessId:input.businessId,financialYearId:input.financialYearId,date:input.date,itemId:input.itemId,warehouseId:input.warehouseId,direction:"in",quantity:input.quantity,unitCost,sourceType:"production",sourceId:result.voucher.id,createdBy:input.userId,manufactureDate:input.date});if(stockIn.value!==total)throw new ValidationError("Production stock valuation rounding mismatch.");await tx.saveStockMovements([...stockOut,stockIn]);
    const record={id:result.voucher.id,businessId:input.businessId,financialYearId:input.financialYearId,itemId:input.itemId,itemName:String(item.name??input.itemId),quantity:input.quantity,outputQuantity:input.quantity,batchQuantity:config.batchQuantity,materialCost:costs.materialCost,labourCost:costs.labourCost,electricityCost:costs.electricityCost,machineCost:costs.machineCost,overheadCost:costs.overheadCost,otherCost:costs.otherCost,totalCost:total,unitCost,consumedValue:costs.materialCost,overheadValue:overhead,warehouseId:input.warehouseId??null,date:input.date,voucherNumber:result.voucher.voucherNumber,idempotencyKey:input.idempotencyKey,status:"posted",createdBy:input.userId,createdAt:deps.clock.now()};
    await tx.saveBusinessDocument("productionVouchers",result.voucher.id,record);await tx.saveAtomicDocument({id:result.voucher.id,businessId:input.businessId,financialYearId:input.financialYearId,type:"production",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,status:"posted",date:input.date,createdBy:input.userId,createdAt:deps.clock.now(),payload:record});return{...result,stockMovements:[...stockOut,stockIn]};
  });
}

export async function cancelProduction(repo:AccountingRepository,input:ProductionCancelInput,deps:TransactionDeps):Promise<PostingResult>{
  assertAuthorized({businessId:input.businessId,userId:input.userId,permissions:input.permissions},"PRODUCTION_CANCEL");
  return repo.runInTransaction(async tx=>{
    const voucher=await tx.getVoucher(input.productionId);if(!voucher||voucher.businessId!==input.businessId||voucher.referenceType!=="production")throw new ValidationError("Production voucher not found.");
    const existing=await tx.getVouchersByReference("reversal",voucher.id);if(existing.length)throw new ValidationError("This production has already been cancelled.");
    const fy=await tx.getFinancialYear(voucher.financialYearId);if(!fy||fy.locked)throw new ValidationError("The production financial year is locked or missing.");
    const originalStock=await tx.getStockMovementsForSource(voucher.id);if(!originalStock.length)throw new ValidationError("Production stock movements are missing; cancellation is blocked.");
    for(const movement of originalStock){if(movement.direction!=="in")continue;const current=await tx.getStockMovementsForItem(movement.itemId,movement.warehouseId);const qty=current.reduce((s,m)=>s+(m.direction==="in"?m.quantity:-m.quantity),0);if(qty+1e-9<movement.quantity)throw new ValidationError(`Cannot cancel production: finished stock ${movement.itemId} has already been consumed or transferred.`);}
    const reversal=await reverseVoucher(tx,voucher.id,input.userId,deps);
    const reverseMovements=originalStock.map(m=>createStockMovement({businessId:input.businessId,financialYearId:m.financialYearId,date:deps.clock.now().slice(0,10),itemId:m.itemId,warehouseId:m.warehouseId,direction:m.direction==="in"?"out":"in",quantity:m.quantity,unitCost:m.unitCost,sourceType:"production_cancel",sourceId:reversal.voucher.id,createdBy:input.userId},deps.ids,deps.clock.now()));
    await tx.saveStockMovements(reverseMovements);const prod=await tx.getBusinessDocument("productionVouchers",voucher.id);if(prod)await tx.saveBusinessDocument("productionVouchers",voucher.id,{...prod,status:"cancelled",cancelledAt:deps.clock.now(),cancelledBy:input.userId,reversalVoucherId:reversal.voucher.id});return{...reversal,stockMovements:reverseMovements};
  });
}
