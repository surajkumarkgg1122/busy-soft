import type { AccountingRepository, Money } from "@/core/accounting/types";
import type { AccountingPermission } from "@/core/accounting/authorization";
import { assertAuthorized, assertTrustedPostingBoundary } from "@/core/accounting/authorization";
import { postSaleEntry } from "@/core/accounting/saleEntry";
import { ValidationError } from "@/core/accounting/errors";
export interface SalesApplicationDeps { repo: AccountingRepository; ids:{next(prefix:string):string}; clock:{now():string}; }
export interface CreateSaleContext { businessId:string; userId:string; financialYearId:string; idempotencyKey:string; permissions:AccountingPermission[]; role?:string; }
export interface CreateSaleItem { itemId:string; quantity:number; warehouseId?:string; }
export interface CreateSaleInput { date:string; customerId?:string; paymentMode:"cash"|"bank"|"credit"; grossValue:Money; discountPercent?:number; discountAmount?:Money; paidAmount?:Money; bankAccountId?:string; taxRate:number; intraState:boolean; cessRate?:number; accountMap:Record<string,string|undefined>; itemMovements:CreateSaleItem[]; narration?:string; documentId?:string; documentPayload?:Record<string,unknown>; }
export async function createSale(deps:SalesApplicationDeps,ctx:CreateSaleContext,input:CreateSaleInput){
 if(!ctx.businessId||!ctx.userId||!ctx.financialYearId)throw new ValidationError("Authenticated business, user and financial year are required.");
 if(!ctx.idempotencyKey)throw new ValidationError("Idempotency key is required.");
 assertTrustedPostingBoundary(ctx);assertAuthorized(ctx,"SALE_CREATE");
 if(input.paymentMode==="bank"&&!input.bankAccountId&&((input.paidAmount??0)>0))throw new ValidationError("Bank account is required for bank/online payment.");
 if(input.paymentMode==="credit"&&(input.paidAmount??0)>0)throw new ValidationError("Use Cash or Bank mode when receiving a partial payment.");
 return postSaleEntry(deps.repo,{...input,accountMap:{party:input.accountMap.party!,sales:input.accountMap.sales!,cash:input.accountMap.cash,bank:input.accountMap.bank,outputCgst:input.accountMap.outputCgst,outputSgst:input.accountMap.outputSgst,outputIgst:input.accountMap.outputIgst,outputCess:input.accountMap.outputCess,inventory:input.accountMap.inventory!,cogs:input.accountMap.cogs!},idempotencyKey:ctx.idempotencyKey,businessId:ctx.businessId,userId:ctx.userId,financialYearId:ctx.financialYearId},deps);
}
