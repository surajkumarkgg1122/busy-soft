import type { AccountingRepository, AtomicAccountingDocument, Money, PostingResult, StockMovement, VoucherLineInput } from "./types";
import { ValidationError } from "./errors";
import { postIdempotentVoucher } from "./atomic";
import { adjustmentMovement, assertAvailableStock, balanceFor, buildStockLedger, normalizeWarehouseId, reconcileCachedStock, transferMovements, type StockAdjustmentInput, type StockLedgerRow, type StockTransferInput } from "./stock";
import { createStockMovement } from "./inventory";

export interface StockOperationDeps { ids:{next(prefix:string):string}; clock:{now():string}; }
const req=(v:string|undefined,n:string)=>{if(!v)throw new ValidationError(`Missing ${n} account.`);return v;};
const dr=(accountId:string,amount:Money,itemId?:string,warehouseId?:string):VoucherLineInput=>({accountId,debit:amount,credit:0,itemId,warehouseId});
const cr=(accountId:string,amount:Money,itemId?:string,warehouseId?:string):VoucherLineInput=>({accountId,debit:0,credit:amount,itemId,warehouseId});
const atomic=(input:{id:string;businessId:string;financialYearId:string;type:AtomicAccountingDocument["type"];voucherId:string;idempotencyKey:string;date:string;createdBy:string;createdAt:string;payload:Record<string,unknown>}):AtomicAccountingDocument=>({...input,status:"posted"});

export interface StockAdjustmentCommand extends StockAdjustmentInput { idempotencyKey:string; accountMap:{inventory:string;stockAdjustmentGain:string;stockAdjustmentLoss:string}; }
export async function postStockAdjustment(repo:AccountingRepository,input:StockAdjustmentCommand,deps:StockOperationDeps):Promise<PostingResult>{
  if(!input.businessId||!input.financialYearId||!input.userId&&false) throw new ValidationError("Invalid stock adjustment context.");
  if(!input.idempotencyKey) throw new ValidationError("Stock adjustment idempotency key is required.");
  return repo.runInTransaction(async tx=>{
    const pre=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);
    if(pre) return postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"STOCK_ADJUSTMENT",prefix:"SA",date:input.date,createdBy:input.createdBy,narration:`Stock adjustment ${input.itemId}`,lines:[],idempotencyKey:input.idempotencyKey},deps);
    const warehouseId=normalizeWarehouseId(input.warehouseId);
    const movements=await tx.getStockMovementsForItem(input.itemId,warehouseId,input.date);
    if(input.quantityDelta<0) assertAvailableStock(movements,{businessId:input.businessId,financialYearId:input.financialYearId,itemId:input.itemId,warehouseId},Math.abs(input.quantityDelta),input.date);
    const movement=adjustmentMovement({...input,warehouseId},deps.ids.next("stk"),deps.clock.now());
    const value=movement.value;
    const lines=input.quantityDelta>0?[dr(req(input.accountMap.inventory,"inventory"),value,input.itemId,warehouseId),cr(req(input.accountMap.stockAdjustmentGain,"stock adjustment gain"),value,input.itemId,warehouseId)]:[dr(req(input.accountMap.stockAdjustmentLoss,"stock adjustment loss"),value,input.itemId,warehouseId),cr(req(input.accountMap.inventory,"inventory"),value,input.itemId,warehouseId)];
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"STOCK_ADJUSTMENT",prefix:"SA",date:input.date,createdBy:input.createdBy,narration:`Stock adjustment ${input.itemId}`,lines,idempotencyKey:input.idempotencyKey},deps);
    movement.sourceId=result.voucher.id;
    await tx.saveStockMovements([movement]);
    await tx.saveAtomicDocument(atomic({id:`${result.voucher.id}:stock`,businessId:input.businessId,financialYearId:input.financialYearId,type:"journal",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,date:input.date,createdBy:input.createdBy,createdAt:deps.clock.now(),payload:{operation:"stock_adjustment",itemId:input.itemId,warehouseId,quantityDelta:input.quantityDelta,unitCost:input.unitCost,value}}));
    return {...result,stockMovements:[movement]};
  });
}

export interface StockTransferCommand extends StockTransferInput { idempotencyKey:string; }
export async function postStockTransfer(repo:AccountingRepository,input:StockTransferCommand,deps:StockOperationDeps):Promise<PostingResult>{
  if(!input.idempotencyKey) throw new ValidationError("Stock transfer idempotency key is required.");
  if(normalizeWarehouseId(input.fromWarehouseId)===normalizeWarehouseId(input.toWarehouseId)) throw new ValidationError("Source and destination warehouses must be different.");
  return repo.runInTransaction(async tx=>{
    const pre=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);
    if(pre) return postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"STOCK_TRANSFER",prefix:"ST",date:input.date,createdBy:input.createdBy,narration:`Stock transfer ${input.itemId}`,lines:[],idempotencyKey:input.idempotencyKey},deps);
    const source=await tx.getStockMovementsForItem(input.itemId,input.fromWarehouseId,input.date);
    assertAvailableStock(source,{businessId:input.businessId,financialYearId:input.financialYearId,itemId:input.itemId,warehouseId:input.fromWarehouseId},input.quantity,input.date);
    const costState=balanceFor(source,{businessId:input.businessId,financialYearId:input.financialYearId,itemId:input.itemId,warehouseId:input.fromWarehouseId},input.date);
    const [out,inMove]=transferMovements(input,deps.ids.next("stk"),deps.ids.next("stk"),deps.clock.now());
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"STOCK_TRANSFER",prefix:"ST",date:input.date,createdBy:input.createdBy,narration:`Stock transfer ${input.itemId}`,lines:[],idempotencyKey:input.idempotencyKey},deps);
    out.sourceId=result.voucher.id; inMove.sourceId=result.voucher.id;
    // Preserve the source valuation when the caller did not supply a cost.
    const transferCost=input.unitCost>=0?input.unitCost:costState.quantity?Math.round(costState.value/costState.quantity):0;
    out.unitCost=transferCost;inMove.unitCost=transferCost;out.value=Math.round(out.quantity*transferCost);inMove.value=out.value;
    await tx.saveStockMovements([out,inMove]);
    await tx.saveAtomicDocument(atomic({id:`${result.voucher.id}:stock`,businessId:input.businessId,financialYearId:input.financialYearId,type:"journal",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,date:input.date,createdBy:input.createdBy,createdAt:deps.clock.now(),payload:{operation:"stock_transfer",itemId:input.itemId,fromWarehouseId:input.fromWarehouseId,toWarehouseId:input.toWarehouseId,quantity:input.quantity,unitCost:transferCost}}));
    return {...result,stockMovements:[out,inMove]};
  });
}

export async function getStockLedger(repo:AccountingRepository,scope:{businessId:string;financialYearId:string;itemId:string;warehouseId?:string},throughDate?:string):Promise<StockLedgerRow[]>{
  return repo.runInTransaction(tx=>tx.getStockMovementsForItem(scope.itemId,scope.warehouseId,throughDate).then(ms=>buildStockLedger(ms,scope,throughDate)));
}

export async function reconcileItemStockCache(repo:AccountingRepository,scope:{businessId:string;financialYearId:string;itemId:string;warehouseId?:string},deps:StockOperationDeps):Promise<Record<string,unknown>>{
  return repo.runInTransaction(async tx=>{
    const warehouseId=normalizeWarehouseId(scope.warehouseId);
    const movements=await tx.getStockMovementsForItem(scope.itemId,scope.warehouseId);
    const balance=balanceFor(movements, {...scope,warehouseId});
    const current=await tx.getBusinessDocument("items",scope.itemId);
    if(!current) throw new ValidationError(`Item ${scope.itemId} was not found.`);
    const next=reconcileCachedStock(current,balance,deps.clock.now());
    await tx.saveBusinessDocument("items",scope.itemId,next);
    return next;
  });
}
