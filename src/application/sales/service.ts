import type { AccountingRepository, Money, PostingResult } from "@/core/accounting/types";
import type { AccountingPermission } from "@/core/accounting/authorization";
import { assertAuthorized, assertTrustedPostingBoundary } from "@/core/accounting/authorization";
import { postSaleEntry } from "@/core/accounting/saleEntry";
import { ValidationError } from "@/core/accounting/errors";
import { firebaseAuth } from "@/lib/firebase";

export interface SalesApplicationDeps { repo: AccountingRepository; ids:{next(prefix:string):string}; clock:{now():string}; }
export interface CreateSaleContext { businessId:string; userId:string; financialYearId:string; idempotencyKey:string; permissions:AccountingPermission[]; role?:string; }
export interface CreateSaleItem { itemId:string; quantity:number; warehouseId?:string; }
export interface CreateSaleInput { date:string; customerId?:string; paymentMode:"cash"|"bank"|"credit"; grossValue:Money; discountPercent?:number; discountAmount?:Money; paidAmount?:Money; bankAccountId?:string; taxRate:number; intraState:boolean; cessRate?:number; accountMap:Record<string,string|undefined>; itemMovements:CreateSaleItem[]; narration?:string; documentId?:string; documentPayload?:Record<string,unknown>; }

async function createSaleFromBrowser(ctx:CreateSaleContext,input:CreateSaleInput):Promise<PostingResult>{
  if(!firebaseAuth?.currentUser)throw new ValidationError("You must be signed in to post a sale.");
  const token=await firebaseAuth.currentUser.getIdToken();
  const response=await fetch("/api/accounting/sales",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({...input,businessId:ctx.businessId,idempotencyKey:ctx.idempotencyKey})});
  const payload=await response.json().catch(()=>({error:"Invalid server response."}));
  if(!response.ok||!payload.success)throw new ValidationError(String(payload.error??"Could not post sale."));
  return payload.result as PostingResult;
}

export async function createSale(deps:SalesApplicationDeps,ctx:CreateSaleContext,input:CreateSaleInput):Promise<PostingResult>{
  if(!ctx.businessId||!ctx.userId||!ctx.financialYearId)throw new ValidationError("Authenticated business, user and financial year are required.");
  if(!ctx.idempotencyKey)throw new ValidationError("Idempotency key is required.");
  if(typeof window!=="undefined")return createSaleFromBrowser(ctx,input);
  assertTrustedPostingBoundary(ctx);assertAuthorized(ctx,"SALE_CREATE");
  if(input.paymentMode==="bank"&&!input.bankAccountId&&((input.paidAmount??0)>0))throw new ValidationError("Bank account is required for bank/online payment.");
  return postSaleEntry(deps.repo,{...input,accountMap:{party:input.accountMap.party!,sales:input.accountMap.sales!,cash:input.accountMap.cash,bank:input.accountMap.bank,outputCgst:input.accountMap.outputCgst,outputSgst:input.accountMap.outputSgst,outputIgst:input.accountMap.outputIgst,outputCess:input.accountMap.outputCess,inventory:input.accountMap.inventory!,cogs:input.accountMap.cogs!},idempotencyKey:ctx.idempotencyKey,businessId:ctx.businessId,userId:ctx.userId,financialYearId:ctx.financialYearId},deps);
}
