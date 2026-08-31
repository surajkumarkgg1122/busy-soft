import type { AccountingRepository, Money, PostingResult, VoucherLineInput, StockMovement, ReturnDocument, Voucher } from "./types";
import { createStockMovement } from "./inventory";
import { calculateTax } from "./gst";
import { postIdempotentVoucher } from "./atomic";
import { ValidationError } from "./errors";
import { assertMoney, assertQuantity } from "./money";

export interface ReturnDeps { ids:{next(prefix:string):string}; clock:{now():string}; }
export interface ReturnItem { itemId:string; quantity:number; warehouseId?:string; }
export interface ReturnBase { businessId:string; financialYearId:string; date:string; userId:string; partyId?:string; taxableValue?:Money; taxRate:number; intraState:boolean; cessRate?:number; narration?:string; originalVoucherId:string; idempotencyKey:string; mode:"credit"|"cash"|"bank"; }
export interface ReturnAccounts { party?:string; cash?:string; bank?:string; salesReturn?:string; sales?:string; purchases?:string; inventory?:string; cogs?:string; inputCgst?:string; inputSgst?:string; inputIgst?:string; inputCess?:string; outputCgst?:string; outputSgst?:string; outputIgst?:string; outputCess?:string; }

const req=(v:string|undefined,n:string)=>{if(!v)throw new ValidationError(`Missing ${n} account.`);return v;};
const dr=(accountId:string,amount:Money,partyId?:string):VoucherLineInput=>({accountId,debit:amount,credit:0,partyId});
const cr=(accountId:string,amount:Money,partyId?:string):VoucherLineInput=>({accountId,debit:0,credit:amount,partyId});

function validateItems(items:readonly ReturnItem[]):void{
  if(!items.length)throw new ValidationError("At least one return item is required.");
  const seen=new Set<string>();
  for(const item of items){
    if(!item.itemId)throw new ValidationError("Return item ID is required.");
    assertQuantity(item.quantity);
    const k=`${item.itemId}:${item.warehouseId??""}`;
    if(seen.has(k))throw new ValidationError("Duplicate return item/warehouse lines are not allowed.");
    seen.add(k);
  }
}

function key(m:Pick<StockMovement,"itemId"|"warehouseId">){return`${m.itemId}:${m.warehouseId??""}`;}
function totalQty(ms:readonly StockMovement[],k:string){return ms.filter(m=>key(m)===k).reduce((s,m)=>s+m.quantity,0);}
function resolveLayerCost(original:readonly StockMovement[],prior:readonly StockMovement[],item:ReturnItem):Money{
  const k=key(item);const layers=original.filter(m=>key(m)===k).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));let skip=totalQty(prior,k),need=item.quantity,value=0;
  for(const layer of layers){if(skip>=layer.quantity){skip-=layer.quantity;continue;}const available=layer.quantity-skip;const take=Math.min(need,available);value+=take*layer.unitCost;need-=take;skip=0;if(!need)break;}
  if(need>0)throw new ValidationError(`Return quantity for ${item.itemId} exceeds remaining original quantity.`);return Math.round(value/item.quantity);
}
export function validateReturnAgainstOriginal(items:readonly ReturnItem[],original:readonly StockMovement[],prior:readonly StockMovement[]):Array<ReturnItem&{unitCost:Money}>{
  const originalKeys=new Set(original.map(key));const used=new Map<string,number>();for(const movement of prior){const k=key(movement);used.set(k,(used.get(k)??0)+movement.quantity);}
  return items.map(item=>{const k=key(item);if(!originalKeys.has(k))throw new ValidationError(`Item ${item.itemId} was not found on the original document.`);const remaining=totalQty(original,k)-(used.get(k)??0);if(remaining<=0||item.quantity>remaining)throw new ValidationError(`Return quantity for ${item.itemId} exceeds remaining quantity ${Math.max(0,remaining)}.`);return{...item,unitCost:resolveLayerCost(original,prior,item)};});
}
function taxLines(t:{cgst:Money;sgst:Money;igst:Money;cess:Money},accounts:ReturnAccounts,sale:boolean):VoucherLineInput[]{const out:VoucherLineInput[]=[];if(t.cgst)out.push(sale?dr(req(accounts.outputCgst,"output CGST"),t.cgst):cr(req(accounts.inputCgst,"input CGST"),t.cgst));if(t.sgst)out.push(sale?dr(req(accounts.outputSgst,"output SGST"),t.sgst):cr(req(accounts.inputSgst,"input SGST"),t.sgst));if(t.igst)out.push(sale?dr(req(accounts.outputIgst,"output IGST"),t.igst):cr(req(accounts.inputIgst,"input IGST"),t.igst));if(t.cess)out.push(sale?dr(req(accounts.outputCess,"output cess"),t.cess):cr(req(accounts.inputCess,"input cess"),t.cess));return out;}
async function validateOriginal(tx:{getVoucher(id:string):Promise<Voucher|null>},input:ReturnBase,sale:boolean):Promise<Voucher>{const original=await tx.getVoucher(input.originalVoucherId);if(!original)throw new ValidationError("Original voucher was not found.");if(original.businessId!==input.businessId||original.financialYearId!==input.financialYearId)throw new ValidationError("Original voucher business or financial year mismatch.");if(original.status!=="posted")throw new ValidationError("Only a posted voucher can be returned.");const expected=sale?"SALE":"PURCHASE";if(original.voucherType!==expected)throw new ValidationError(`Original voucher must be a ${expected} voucher.`);return original;}
function deriveTax(lines:VoucherLineInput[],accounts:ReturnAccounts,sale:boolean){
  const taxableAccount=sale?accounts.sales:accounts.inventory;let taxable=0,cgst=0,sgst=0,igst=0,cess=0;
  for(const line of lines){if(line.accountId===taxableAccount)taxable+=sale?line.credit:line.debit;if(line.accountId===(sale?accounts.outputCgst:accounts.inputCgst))cgst+=sale?line.credit:line.debit;if(line.accountId===(sale?accounts.outputSgst:accounts.inputSgst))sgst+=sale?line.credit:line.debit;if(line.accountId===(sale?accounts.outputIgst:accounts.inputIgst))igst+=sale?line.credit:line.debit;if(line.accountId===(sale?accounts.outputCess:accounts.inputCess))cess+=sale?line.credit:line.debit;}
  const rate=taxable>0?Number((((cgst+sgst+igst)/taxable)*100).toFixed(6)):0;const cessRate=taxable>0?Number(((cess/taxable)*100).toFixed(6)):0;return{rate,intraState:cgst>0||sgst>0,cessRate};
}

async function postReturn(repo:AccountingRepository,input:ReturnBase&{accountMap:ReturnAccounts;items:ReturnItem[]},deps:ReturnDeps,sale:boolean):Promise<PostingResult>{
  if(!input.originalVoucherId||!input.idempotencyKey)throw new ValidationError("Original voucher and idempotency key are required for a return.");if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Return date must be YYYY-MM-DD.");if(input.mode==="credit"&&!input.partyId)throw new ValidationError("Party is required for a credit return.");if(input.taxableValue===undefined)throw new ValidationError("Return taxable value is required.");assertMoney(input.taxableValue,"Return taxable value");if(input.taxableValue<=0)throw new ValidationError("Return taxable value must be positive.");validateItems(input.items);
  return repo.runInTransaction(async tx=>{
    const existing=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);if(existing)return postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:sale?"SALE_RETURN":"PURCHASE_RETURN",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:sale?"sale_return":"purchase_return",referenceId:input.originalVoucherId,lines:[],idempotencyKey:input.idempotencyKey},deps);
    const original=await validateOriginal(tx,input,sale);const originalLines=await tx.getVoucherLines(original.id);const gst=deriveTax(originalLines,input.accountMap,sale);if(Math.abs(input.taxRate-gst.rate)>0.000001)throw new ValidationError("Return tax rate must match the original voucher tax rate.");if(Boolean(input.intraState)!==gst.intraState)throw new ValidationError("Return GST type must match the original voucher.");const expectedCessRate=input.cessRate??0;if(Math.abs(expectedCessRate-gst.cessRate)>0.000001)throw new ValidationError("Return cess rate must match the original voucher cess rate.");
    const originalMovements=(await tx.getStockMovementsForSource(original.id)).filter(m=>m.sourceType===(sale?"sale":"purchase"));if(!originalMovements.length)throw new ValidationError("Original document has no stock movements to return.");const priorReturns=await tx.getVouchersByReference(sale?"sale_return":"purchase_return",original.id);const priorMovements=(await Promise.all(priorReturns.map(v=>tx.getStockMovementsForSource(v.id)))).flat();const items=validateReturnAgainstOriginal(input.items,originalMovements,priorMovements);const inventoryValue=items.reduce((sum,item)=>sum+Math.round(item.quantity*item.unitCost),0);if(!Number.isSafeInteger(inventoryValue)||inventoryValue<=0)throw new ValidationError("Return inventory value is invalid.");
    const returnTaxable=input.taxableValue;const tax=calculateTax({taxableValue:returnTaxable,rate:gst.rate,intraState:gst.intraState,cessRate:gst.cessRate});const settlement=input.mode==="credit"?req(input.accountMap.party,"party"):input.mode==="cash"?req(input.accountMap.cash,"cash"):req(input.accountMap.bank,"bank");const settlementParty=input.mode==="credit"?input.partyId:undefined;
    let lines:VoucherLineInput[];
    if(sale){const inventory=req(input.accountMap.inventory,"inventory");const cogs=req(input.accountMap.cogs,"COGS");lines=[dr(req(input.accountMap.salesReturn,"sales return / contra revenue"),returnTaxable),cr(settlement,tax.total,settlementParty),...taxLines(tax,input.accountMap,true),dr(inventory,inventoryValue),cr(cogs,inventoryValue)];}
    else{if(returnTaxable!==inventoryValue)throw new ValidationError("Purchase return taxable value must equal the returned inventory value to preserve inventory accounting.");lines=[cr(req(input.accountMap.inventory,"inventory"),inventoryValue),dr(settlement,tax.total,settlementParty),...taxLines(tax,input.accountMap,false)];}
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:sale?"SALE_RETURN":"PURCHASE_RETURN",prefix:sale?"SR":"PR",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:sale?"sale_return":"purchase_return",referenceId:original.id,lines,idempotencyKey:input.idempotencyKey},deps);
    const movements=items.map(item=>createStockMovement({businessId:input.businessId,financialYearId:input.financialYearId,date:input.date,itemId:item.itemId,warehouseId:item.warehouseId,direction:sale?"in":"out",quantity:item.quantity,unitCost:item.unitCost,value:Math.round(item.quantity*item.unitCost),sourceType:sale?"sale_return":"purchase_return",sourceId:result.voucher.id,createdBy:input.userId},deps.ids,deps.clock.now()));await tx.saveStockMovements(movements);
    const document:ReturnDocument={id:deps.ids.next("ret"),businessId:input.businessId,financialYearId:input.financialYearId,type:sale?"SALE_RETURN":"PURCHASE_RETURN",voucherId:result.voucher.id,originalVoucherId:original.id,partyId:input.partyId??"",date:input.date,createdBy:input.userId,items,taxableValue:returnTaxable,taxTotal:tax.total,createdAt:deps.clock.now()};await tx.saveReturnDocument(document);return{...result,stockMovements:movements};
  });
}
export function postSaleReturn(repo:AccountingRepository,input:ReturnBase&{accountMap:ReturnAccounts;items:ReturnItem[]},deps:ReturnDeps){return postReturn(repo,input,deps,true);}
export function postPurchaseReturn(repo:AccountingRepository,input:ReturnBase&{accountMap:ReturnAccounts;items:ReturnItem[]},deps:ReturnDeps){return postReturn(repo,input,deps,false);}
