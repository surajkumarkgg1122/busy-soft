import type { AccountingRepository, PostingResult } from "@/core/accounting/types";
import type { AccountingPermission } from "@/core/accounting/authorization";
import { assertAuthorized, assertTrustedPostingBoundary } from "@/core/accounting/authorization";
import { postPurchase, type PurchasePostingInput, type TransactionDeps } from "@/core/accounting/transactions";
import { ValidationError } from "@/core/accounting/errors";
import { firebaseAuth } from "@/lib/firebase";

export interface PurchaseApplicationDeps { repo:AccountingRepository; ids:{next(prefix:string):string}; clock:{now():string}; }
export interface CreatePurchaseContext { businessId:string; userId:string; financialYearId:string; idempotencyKey:string; permissions:AccountingPermission[]; role?:string; }
export type CreatePurchaseInput=Omit<PurchasePostingInput,"businessId"|"userId"|"financialYearId"|"idempotencyKey">;

async function getAuthToken():Promise<string>{if(!firebaseAuth?.currentUser)throw new ValidationError("You must be signed in.");return firebaseAuth.currentUser.getIdToken();}

async function createPurchaseFromBrowser(ctx:CreatePurchaseContext,input:CreatePurchaseInput):Promise<PostingResult>{
  const token=await getAuthToken();
  const response=await fetch("/api/accounting/purchases",{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({...input,businessId:ctx.businessId,financialYearId:ctx.financialYearId,idempotencyKey:ctx.idempotencyKey})});
  const payload=await response.json().catch(()=>({error:"Invalid server response."}));
  if(!response.ok||!payload.success)throw new ValidationError(String(payload.error??"Could not post purchase."));
  return payload.result as PostingResult;
}

export async function createPurchase(deps:PurchaseApplicationDeps,ctx:CreatePurchaseContext,input:CreatePurchaseInput):Promise<PostingResult>{
  if(!ctx.businessId||!ctx.userId||!ctx.financialYearId)throw new ValidationError("Authenticated business, user and financial year are required.");
  if(!ctx.idempotencyKey)throw new ValidationError("Idempotency key is required.");
  if(typeof window!=="undefined")return createPurchaseFromBrowser(ctx,input);
  assertTrustedPostingBoundary(ctx);assertAuthorized(ctx,"PURCHASE_CREATE");
  return postPurchase(deps.repo,{...input,businessId:ctx.businessId,userId:ctx.userId,financialYearId:ctx.financialYearId,idempotencyKey:ctx.idempotencyKey},{ids:deps.ids,clock:deps.clock} as TransactionDeps);
}
