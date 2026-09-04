import type { AccountingRepository, PostingResult, StockMovement } from "./types";
import { reverseVoucher } from "./voucher";
import { createStockMovement } from "./inventory";
import { buildSerialStock } from "./inventoryTracking";
import { ValidationError } from "./errors";

export interface CancellationDeps { ids:{next(prefix:string):string}; clock:{now():string} }
export interface CancellationInput { businessId:string; voucherId:string; userId:string; date?:string; idempotencyKey:string }

function netQuantity(movements:readonly StockMovement[],itemId:string,warehouseId?:string){return movements.filter(m=>m.itemId===itemId&&(warehouseId===undefined||m.warehouseId===warehouseId)).reduce((s,m)=>s+(m.direction==="in"?m.quantity:-m.quantity),0)}
function assertCancelableDate(date:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new ValidationError("Cancellation date must be YYYY-MM-DD.")}

export async function cancelSalesDocument(repo:AccountingRepository,input:CancellationInput,deps:CancellationDeps):Promise<PostingResult>{
  if(!input.businessId||!input.voucherId||!input.userId||!input.idempotencyKey)throw new ValidationError("Business, voucher, user and idempotency key are required for sale cancellation.");
  return repo.runInTransaction(async tx=>{
    const original=await tx.getVoucher(input.voucherId);if(!original)throw new ValidationError("Sale voucher not found.");
    if(original.businessId!==input.businessId||original.voucherType!=="SALE")throw new ValidationError("Only a sale voucher from this business can be cancelled.");
    if(original.status!=="posted")throw new ValidationError("Only a posted sale can be cancelled.");
    if((await tx.getVouchersByReference("sale_return",original.id)).length)throw new ValidationError("A sale with posted returns cannot be cancelled; reverse the return first.");
    if((await tx.getPartyAllocationsForVoucher(original.id)).length)throw new ValidationError("A sale with party allocations cannot be cancelled. Reverse/unallocate its receipts first.");
    const existing=await tx.getVouchersByReference("sale_cancellation",original.id);if(existing.length)throw new ValidationError("Sale cancellation already exists.");
    const date=input.date??original.date;assertCancelableDate(date);
    const originalMovements=(await tx.getStockMovementsForSource(original.id)).filter(m=>m.sourceType==="sale");
    const result=await reverseVoucher(tx,original.id,input.userId,deps,date);
    const restores:StockMovement[]=[];
    for(const m of originalMovements){
      if(m.serialNumbers?.length){const current=buildSerialStock(await tx.getStockMovementsForItem(m.itemId,m.warehouseId,date),m.itemId,m.warehouseId);const held=new Set(current.map(x=>x.serialNumber));for(const serial of m.serialNumbers)if(held.has(serial))throw new ValidationError(`Cannot cancel sale because serial ${serial} is already in stock from a later transaction.`);}
      restores.push(createStockMovement({businessId:input.businessId,financialYearId:original.financialYearId,date,itemId:m.itemId,warehouseId:m.warehouseId,direction:"in",quantity:m.quantity,unitCost:m.unitCost,value:m.value,sourceType:"sale_cancel",sourceId:result.voucher.id,createdBy:input.userId,batchId:m.batchId,batchNumber:m.batchNumber,manufactureDate:m.manufactureDate,expiryDate:m.expiryDate,serialNumbers:m.serialNumbers,unitId:m.unitId,quantityInBaseUnit:m.quantityInBaseUnit},deps.ids,deps.clock.now()));
    }
    if(restores.length)await tx.saveStockMovements(restores);
    await tx.saveBusinessDocument("saleCancellations",original.id,{businessId:input.businessId,originalVoucherId:original.id,reversalVoucherId:result.voucher.id,date,createdBy:input.userId,createdAt:deps.clock.now(),idempotencyKey:input.idempotencyKey});
    await tx.saveAuditEvent({id:deps.ids.next("audit"),businessId:input.businessId,entityType:"sale",entityId:original.id,action:"SALE_CANCELLED",userId:input.userId,timestamp:deps.clock.now(),after:{originalVoucherId:original.id,reversalVoucherId:result.voucher.id,stockRestored:restores.length}});
    return{...result,stockMovements:restores};
  });
}

export async function cancelPurchaseDocument(repo:AccountingRepository,input:CancellationInput,deps:CancellationDeps):Promise<PostingResult>{
  if(!input.businessId||!input.voucherId||!input.userId||!input.idempotencyKey)throw new ValidationError("Business, voucher, user and idempotency key are required for purchase cancellation.");
  return repo.runInTransaction(async tx=>{
    const original=await tx.getVoucher(input.voucherId);if(!original)throw new ValidationError("Purchase voucher not found.");
    if(original.businessId!==input.businessId||original.voucherType!=="PURCHASE")throw new ValidationError("Only a purchase voucher from this business can be cancelled.");
    if(original.status!=="posted")throw new ValidationError("Only a posted purchase can be cancelled.");
    if((await tx.getVouchersByReference("purchase_return",original.id)).length)throw new ValidationError("A purchase with posted returns cannot be cancelled; reverse the return first.");
    if((await tx.getPartyAllocationsForVoucher(original.id)).length)throw new ValidationError("A purchase with party allocations cannot be cancelled. Reverse/unallocate its payments first.");
    const existing=await tx.getVouchersByReference("purchase_cancellation",original.id);if(existing.length)throw new ValidationError("Purchase cancellation already exists.");
    const date=input.date??original.date;assertCancelableDate(date);
    const originalMovements=(await tx.getStockMovementsForSource(original.id)).filter(m=>m.sourceType==="purchase");
    for(const m of originalMovements){
      const available=netQuantity(await tx.getStockMovementsForItem(m.itemId,m.warehouseId,date),m.itemId,m.warehouseId);if(available<m.quantity)throw new ValidationError(`Cannot cancel purchase: ${m.itemId} has only ${available} units available in the original warehouse.`);
      if(m.serialNumbers?.length){const current=buildSerialStock(await tx.getStockMovementsForItem(m.itemId,m.warehouseId,date),m.itemId,m.warehouseId);const held=new Set(current.map(x=>x.serialNumber));for(const serial of m.serialNumbers)if(!held.has(serial))throw new ValidationError(`Cannot cancel purchase because serial ${serial} is no longer in stock: ${serial}.`);}
    }
    const result=await reverseVoucher(tx,original.id,input.userId,deps,date);
    const removals=originalMovements.map(m=>createStockMovement({businessId:input.businessId,financialYearId:original.financialYearId,date,itemId:m.itemId,warehouseId:m.warehouseId,direction:"out",quantity:m.quantity,unitCost:m.unitCost,value:m.value,sourceType:"purchase_cancel",sourceId:result.voucher.id,createdBy:input.userId,batchId:m.batchId,batchNumber:m.batchNumber,manufactureDate:m.manufactureDate,expiryDate:m.expiryDate,serialNumbers:m.serialNumbers,unitId:m.unitId,quantityInBaseUnit:m.quantityInBaseUnit},deps.ids,deps.clock.now()));
    if(removals.length)await tx.saveStockMovements(removals);
    await tx.saveBusinessDocument("purchaseCancellations",original.id,{businessId:input.businessId,originalVoucherId:original.id,reversalVoucherId:result.voucher.id,date,createdBy:input.userId,createdAt:deps.clock.now(),idempotencyKey:input.idempotencyKey});
    await tx.saveAuditEvent({id:deps.ids.next("audit"),businessId:input.businessId,entityType:"purchase",entityId:original.id,action:"PURCHASE_CANCELLED",userId:input.userId,timestamp:deps.clock.now(),after:{originalVoucherId:original.id,reversalVoucherId:result.voucher.id,stockRemoved:removals.length}});
    return{...result,stockMovements:removals};
  });
}
