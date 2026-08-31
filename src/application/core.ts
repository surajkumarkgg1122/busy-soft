import { postSale, postPurchase, postReceipt, postPayment, postContra, postJournal, postExpense } from "@/core/accounting/transactions";
import { postReceiptIdempotent, postPaymentIdempotent } from "@/core/accounting/settlements";
import { postSaleReturn, postPurchaseReturn } from "@/core/accounting/returns";
import { assertAuthorized, assertTrustedPostingBoundary, type AccountingPermission } from "@/core/accounting/authorization";
import { assertTrustedContext, type TrustedCommandContext } from "./context";
import { normalizeApplicationError } from "./errors";

export type AccountingCommandName = "SALE_CREATE" | "PURCHASE_CREATE" | "RETURN_CREATE" | "RECEIPT_CREATE" | "PAYMENT_CREATE" | "CONTRA_CREATE" | "JOURNAL_CREATE" | "EXPENSE_CREATE";
export type CommandContext = TrustedCommandContext;
export interface ApplicationDeps { repo: import("@/core/accounting/types").AccountingRepository; ids: { next(prefix:string):string }; clock:{ now():string }; }
export interface CommandResult<T=unknown> { value:T; idempotencyKey:string; }

function requiredPermission(command: AccountingCommandName): AccountingPermission {
  switch(command){
    case "SALE_CREATE": return "SALE_CREATE";
    case "PURCHASE_CREATE": return "PURCHASE_CREATE";
    case "RETURN_CREATE": return "RETURN_CREATE";
    case "RECEIPT_CREATE": return "RECEIPT_CREATE";
    case "PAYMENT_CREATE": return "PAYMENT_CREATE";
    case "CONTRA_CREATE": return "CONTRA_CREATE";
    case "JOURNAL_CREATE": return "JOURNAL_CREATE";
    case "EXPENSE_CREATE": return "JOURNAL_CREATE";
  }
}

async function execute<T>(deps:ApplicationDeps,ctx:CommandContext,command:AccountingCommandName,action:()=>Promise<T>):Promise<CommandResult<T>>{
  try{assertTrustedContext(ctx);assertTrustedPostingBoundary(ctx);assertAuthorized(ctx,requiredPermission(command));const value=await action();return{value,idempotencyKey:ctx.idempotencyKey.trim()};}catch(error){throw normalizeApplicationError(error);}
}

export function executeSale(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"SALE_CREATE",()=>postSale(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executePurchase(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"PURCHASE_CREATE",()=>postPurchase(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executeSaleReturn(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"RETURN_CREATE",()=>postSaleReturn(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executePurchaseReturn(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"RETURN_CREATE",()=>postPurchaseReturn(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executeReceipt(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"RECEIPT_CREATE",()=>postReceiptIdempotent(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}
export function executePayment(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"PAYMENT_CREATE",()=>postPaymentIdempotent(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}
export function executeContra(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"CONTRA_CREATE",()=>postContra(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}
export function executeJournal(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"JOURNAL_CREATE",()=>postJournal(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId} as never,(input as {lines:unknown[]}).lines as never,deps,"JOURNAL","JV"));}
export function executeExpense(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"EXPENSE_CREATE",()=>postExpense(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId} as never,deps));}
