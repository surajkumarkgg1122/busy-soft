import type { AccountingRepository, AtomicAccountingDocument, PostingResult, VoucherLineInput } from "./types";
import { ValidationError } from "./errors";
import { postIdempotentVoucher } from "./atomic";
import { createStockMovement } from "./inventory";
import { normalizeWarehouseId } from "./stock";

export interface OpeningStockDeps { ids:{next(prefix:string):string}; clock:{now():string}; }
export interface OpeningStockCommand { businessId:string; financialYearId:string; date:string; itemId:string; warehouseId?:string; quantity:number; unitCost:number; createdBy:string; idempotencyKey:string; accountMap:{inventory:string;openingEquity:string}; }
const req=(v:string|undefined,n:string)=>{if(!v)throw new ValidationError(`Missing ${n} account.`);return v;};
const dr=(accountId:string,amount:number,itemId:string,warehouseId:string):VoucherLineInput=>({accountId,debit:amount,credit:0,itemId,warehouseId});
const cr=(accountId:string,amount:number,itemId:string,warehouseId:string):VoucherLineInput=>({accountId,debit:0,credit:amount,itemId,warehouseId});

export async function postOpeningStock(repo:AccountingRepository,input:OpeningStockCommand,deps:OpeningStockDeps):Promise<PostingResult>{
  if(!input.businessId||!input.financialYearId||!input.itemId||!input.createdBy)throw new ValidationError("Opening stock context is incomplete.");
  if(!input.idempotencyKey)throw new ValidationError("Opening stock idempotency key is required.");
  if(!Number.isFinite(input.quantity)||input.quantity<=0)throw new ValidationError("Opening stock quantity must be greater than zero.");
  if(!Number.isSafeInteger(input.unitCost)||input.unitCost<0)throw new ValidationError("Opening stock unit cost must be a non-negative integer.");
  const warehouseId=normalizeWarehouseId(input.warehouseId);
  return repo.runInTransaction(async tx=>{
    const pre=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);
    if(pre)return postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"OPENING_STOCK",prefix:"OS",date:input.date,createdBy:input.createdBy,narration:`Opening stock ${input.itemId}`,lines:[],idempotencyKey:input.idempotencyKey},deps);
    const value=Math.round(input.quantity*input.unitCost);
    if(!Number.isSafeInteger(value)||value<=0)throw new ValidationError("Opening stock value is invalid.");
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"OPENING_STOCK",prefix:"OS",date:input.date,createdBy:input.createdBy,narration:`Opening stock ${input.itemId}`,lines:[dr(req(input.accountMap.inventory,"inventory"),value,input.itemId,warehouseId),cr(req(input.accountMap.openingEquity,"opening equity"),value,input.itemId,warehouseId)],idempotencyKey:input.idempotencyKey},deps);
    const movement=createStockMovement({businessId:input.businessId,financialYearId:input.financialYearId,date:input.date,itemId:input.itemId,warehouseId,direction:"in",quantity:input.quantity,unitCost:input.unitCost,sourceType:"opening",sourceId:result.voucher.id,createdBy:input.createdBy},deps.ids,deps.clock.now());
    await tx.saveStockMovements([movement]);
    const document:AtomicAccountingDocument={id:`${result.voucher.id}:stock`,businessId:input.businessId,financialYearId:input.financialYearId,type:"journal",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,status:"posted",date:input.date,createdBy:input.createdBy,createdAt:deps.clock.now(),payload:{operation:"opening_stock",itemId:input.itemId,warehouseId,quantity:input.quantity,unitCost:input.unitCost,value}};
    await tx.saveAtomicDocument(document);
    return {...result,stockMovements:[movement]};
  });
}
