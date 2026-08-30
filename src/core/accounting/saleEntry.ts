import type { AccountingRepository, Money, VoucherLineInput, PostingResult, AtomicAccountingDocument } from "./types";
import { postIdempotentVoucher } from "./atomic";
import { createStockMovement } from "./inventory";
import { calculateTax } from "./gst";
import { calculateOutgoingAllocations, type StockValuationMethod } from "./valuation";
import { ValidationError } from "./errors";
import { assertMoney, assertQuantity } from "./money";
import type { TransactionDeps } from "./transactions";

export interface SaleEntryInput { businessId:string; financialYearId:string; date:string; userId:string; customerId?:string; grossValue:Money; discountPercent?:number; discountAmount?:Money; taxRate:number; intraState:boolean; cessRate?:number; paymentMode:"cash"|"bank"|"credit"; paidAmount?:Money; bankAccountId?:string; accountMap:{party:string;cash?:string;bank?:string;sales:string;outputCgst?:string;outputSgst?:string;outputIgst?:string;outputCess?:string;inventory:string;cogs:string}; itemMovements:Array<{itemId:string;quantity:number;warehouseId?:string}>; valuationMethod?:StockValuationMethod; narration?:string; idempotencyKey:string; documentId?:string; documentPayload?:Record<string,unknown>; }
const debit=(accountId:string,amount:Money,extra:Partial<VoucherLineInput>={})=>({accountId,debit:amount,credit:0,...extra});
const credit=(accountId:string,amount:Money,extra:Partial<VoucherLineInput>={})=>({accountId,debit:0,credit:amount,...extra});
const required=(v:string|undefined,n:string)=>{if(!v)throw new ValidationError(`Missing ${n} account.`);return v};
const atomicDocument=(x:Omit<AtomicAccountingDocument,"status">):AtomicAccountingDocument=>({...x,status:"posted"});
function discount(gross:Money,pct:number,amount:Money){if(pct<0||pct>100)throw new ValidationError("Discount percentage must be between 0 and 100.");assertMoney(amount,"Discount amount");const byPercent=Math.round(gross*pct/100);const total=byPercent+amount;if(total>gross)throw new ValidationError("Discount cannot exceed sale value.");return{byPercent,total,taxable:gross-total};}
export async function postSaleEntry(repo:AccountingRepository,input:SaleEntryInput,deps:TransactionDeps):Promise<PostingResult>{
 if(!input.businessId||!input.financialYearId||!input.userId)throw new ValidationError("Business, financial year and user are required.");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Transaction date must be YYYY-MM-DD.");
 if(!input.idempotencyKey)throw new ValidationError("Idempotency key is required.");
 if(!Number.isSafeInteger(input.grossValue)||input.grossValue<=0)throw new ValidationError("Sale value must be positive.");
 const d=discount(input.grossValue,input.discountPercent??0,input.discountAmount??0); if(d.taxable<=0)throw new ValidationError("Sale taxable value must be greater than zero.");
 if(input.paymentMode==="credit"&&!input.customerId)throw new ValidationError("Customer is required for a credit sale.");
 const paid=input.paidAmount??(input.paymentMode==="credit"?0:d.taxable); if(!Number.isSafeInteger(paid)||paid<0||paid>d.taxable)throw new ValidationError("Paid amount must be between zero and the invoice total.");
 const outstanding=d.taxable-paid; if(outstanding>0&&!input.customerId)throw new ValidationError("Customer is required when payment is partial.");
 if(paid>0&&input.paymentMode==="bank"&&!input.bankAccountId)throw new ValidationError("Bank account is required for online/bank payment.");
 if(!input.itemMovements.length)throw new ValidationError("At least one sale item is required.");
 const seen=new Set<string>();for(const item of input.itemMovements){if(!item.itemId)throw new ValidationError("Item is required.");assertQuantity(item.quantity);const k=`${item.itemId}:${item.warehouseId??""}`;if(seen.has(k))throw new ValidationError(`Duplicate stock line: ${k}`);seen.add(k);}
 return repo.runInTransaction(async tx=>{
  const pre=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);if(pre)throw new ValidationError("A sale with this idempotency key is already posted.");
  if(input.documentId){const existing=await tx.getBusinessDocument("sales",input.documentId);if(existing)throw new ValidationError(`Invoice document ${input.documentId} already exists.`);}
  const valued=[] as Array<{item:(typeof input.itemMovements)[number];allocations:ReturnType<typeof calculateOutgoingAllocations>}>;let totalCost=0;
  for(const item of input.itemMovements){const allocations=calculateOutgoingAllocations(await tx.getStockMovementsForItem(item.itemId,item.warehouseId,input.date),item.quantity,input.valuationMethod??"fifo");totalCost+=allocations.reduce((s,a)=>s+a.value,0);valued.push({item,allocations});}
  const tax=calculateTax({taxableValue:d.taxable,rate:input.taxRate,intraState:input.intraState,cessRate:input.cessRate}); const lines:VoucherLineInput[]=[];
  if(paid>0)lines.push(debit(required(input.paymentMode==="cash"?input.accountMap.cash:input.paymentMode==="bank"?input.bankAccountId:input.accountMap.party,input.paymentMode==="cash"?"cash account":input.paymentMode==="bank"?"bank account":"party"),paid));
  if(outstanding>0)lines.push(debit(required(input.accountMap.party,"party account"),outstanding,{partyId:input.customerId}));
  lines.push(credit(input.accountMap.sales,d.taxable)); if(tax.cgst)lines.push(credit(required(input.accountMap.outputCgst,"output CGST"),tax.cgst)); if(tax.sgst)lines.push(credit(required(input.accountMap.outputSgst,"output SGST"),tax.sgst)); if(tax.igst)lines.push(credit(required(input.accountMap.outputIgst,"output IGST"),tax.igst)); if(tax.cess)lines.push(credit(required(input.accountMap.outputCess,"output cess"),tax.cess)); if(totalCost>0)lines.push(debit(input.accountMap.cogs,totalCost),credit(input.accountMap.inventory,totalCost));
  const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"SALE",prefix:"SI",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"sale",referenceId:input.documentId??input.idempotencyKey,lines,idempotencyKey:input.idempotencyKey},deps);
  const movements=valued.flatMap(v=>v.allocations.map(a=>createStockMovement({businessId:input.businessId,financialYearId:input.financialYearId,date:input.date,itemId:v.item.itemId,warehouseId:v.item.warehouseId,direction:"out",quantity:a.quantity,unitCost:a.unitCost,value:a.value,sourceType:"sale",sourceId:result.voucher.id,createdBy:input.userId},deps.ids,deps.clock.now()))); await tx.saveStockMovements(movements);
  const payload={...(input.documentPayload??{}),businessId:input.businessId,saleId:input.documentId??result.voucher.id,invoiceNumber:input.documentPayload?.invoiceNumber??result.voucher.voucherNumber,accountingVoucherId:result.voucher.id,accountingVoucherNumber:result.voucher.voucherNumber,grossValue:input.grossValue,discountPercent:input.discountPercent??0,discountAmount:d.total,paidAmount:paid,outstandingAmount:outstanding,paymentMode:input.paymentMode,bankAccountId:input.bankAccountId??null};
  await tx.saveAtomicDocument(atomicDocument({id:input.documentId??result.voucher.id,businessId:input.businessId,financialYearId:input.financialYearId,type:"sale",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,date:input.date,createdBy:input.userId,createdAt:deps.clock.now(),payload})); if(input.documentId)await tx.saveBusinessDocument("sales",input.documentId,payload); return{...result,stockMovements:movements};
 });
}
