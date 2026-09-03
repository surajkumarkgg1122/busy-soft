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
export interface SalesWorkspaceData { customers: Record<string, unknown>[]; items: Record<string, unknown>[]; sales: Record<string, unknown>[]; bankAccounts: Record<string, unknown>[]; }

function currentFinancialYearId(date:string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `fy-${start}-${String(start + 1).slice(-2)}`;
}

async function getAuthToken(): Promise<string> {
  if (!firebaseAuth?.currentUser) throw new ValidationError("You must be signed in.");
  return firebaseAuth.currentUser.getIdToken();
}

export async function getSalesWorkspaceData(businessId:string): Promise<SalesWorkspaceData> {
  if (!businessId) throw new ValidationError("Business ID is required.");
  if (typeof window === "undefined") throw new ValidationError("Sales workspace data must be requested from the application client.");
  const token = await getAuthToken();
  const response = await fetch(`/api/accounting/sales/data?businessId=${encodeURIComponent(businessId)}`, { method:"GET", headers:{Authorization:`Bearer ${token}`}, cache:"no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new ValidationError(String(payload?.error ?? `Sales workspace failed (${response.status}).`));
  const data = payload.data as SalesWorkspaceData;
  return {
    ...data,
    items: data.items.map((item) => ({
      ...item,
      // Item master stores monetary prices in paise; Sales calculations use rupees.
      purchasePrice: typeof item.purchasePrice === "number" ? item.purchasePrice / 100 : item.purchasePrice,
      salePrice: typeof item.salePrice === "number" ? item.salePrice / 100 : item.salePrice,
      mrp: typeof item.mrp === "number" ? item.mrp / 100 : item.mrp,
    })),
  };
}

async function createSaleFromBrowser(ctx:CreateSaleContext,input:CreateSaleInput):Promise<PostingResult>{
  const token = await getAuthToken();
  const response = await fetch("/api/accounting/sales",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({...input,businessId:ctx.businessId,idempotencyKey:ctx.idempotencyKey})});
  const payload = await response.json().catch(()=>({error:"Invalid server response."}));
  if(!response.ok||!payload.success)throw new ValidationError(String(payload.error??"Could not post sale."));
  return payload.result as PostingResult;
}

export async function createSale(deps:SalesApplicationDeps,ctx:CreateSaleContext,input:CreateSaleInput):Promise<PostingResult>{
  if(!ctx.businessId||!ctx.userId||!ctx.financialYearId)throw new ValidationError("Authenticated business, user and financial year are required.");
  if(!ctx.idempotencyKey)throw new ValidationError("Idempotency key is required.");
  if(typeof window!=="undefined")return createSaleFromBrowser(ctx,input);
  assertTrustedPostingBoundary(ctx);assertAuthorized(ctx,"SALE_CREATE");
  if(input.paymentMode==="bank"&&(input.paidAmount??0)>0&&!input.bankAccountId)throw new ValidationError("Bank account is required for bank/online payment.");
  return postSaleEntry(deps.repo,{...input,accountMap:{party:input.accountMap.party!,sales:input.accountMap.sales!,cash:input.accountMap.cash,bank:input.accountMap.bank,outputCgst:input.accountMap.outputCgst,outputSgst:input.accountMap.outputSgst,outputIgst:input.accountMap.outputIgst,outputCess:input.accountMap.outputCess,inventory:input.accountMap.inventory!,cogs:input.accountMap.cogs!},idempotencyKey:ctx.idempotencyKey,businessId:ctx.businessId,userId:ctx.userId,financialYearId:ctx.financialYearId},deps);
}

export { currentFinancialYearId };
