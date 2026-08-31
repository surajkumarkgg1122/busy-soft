import type { AccountingRepository } from "@/core/accounting/types";
import type { AccountingPermission, AuthorizationContext } from "@/core/accounting/authorization";
import { assertAuthorized, assertTrustedPostingBoundary } from "@/core/accounting/authorization";
import { postSale, postPurchase, postExpense } from "@/core/accounting/transactions";
import { postReceiptIdempotent, postPaymentIdempotent } from "@/core/accounting/settlements";
import { postExpenseEntry } from "@/core/accounting/expenseEntry";
import { postSaleReturn, postPurchaseReturn } from "@/core/accounting/returns";
import { assertTrustedContext, type TrustedCommandContext } from "./context";
import { normalizeApplicationError } from "./errors";

export interface ApplicationDeps { repo: AccountingRepository; ids:{next(prefix:string):string}; clock:{now():string}; }
export interface CommandResult<T=unknown>{value:T;idempotencyKey:string;}
export type CommandContext=TrustedCommandContext;
export type AccountingCommandName="SALE_CREATE"|"PURCHASE_CREATE"|"RETURN_CREATE"|"RECEIPT_CREATE"|"PAYMENT_CREATE"|"CONTRA_CREATE"|"JOURNAL_CREATE"|"EXPENSE_CREATE";

function requiredPermission(command:AccountingCommandName):AccountingPermission{
  switch(command){
    case "SALE_CREATE":return "SALE_CREATE";
    case "PURCHASE_CREATE":return "PURCHASE_CREATE";
    case "RETURN_CREATE":return "RETURN_CREATE";
    case "RECEIPT_CREATE":return "RECEIPT_CREATE";
    case "PAYMENT_CREATE":return "PAYMENT_CREATE";
    case "CONTRA_CREATE":return "CONTRA_CREATE";
    case "JOURNAL_CREATE":return "JOURNAL_CREATE";
    case "EXPENSE_CREATE":return "JOURNAL_CREATE";
  }
}

async function execute<T>(ctx:CommandContext,command:AccountingCommandName,action:()=>Promise<T>):Promise<CommandResult<T>>{
  try{assertTrustedContext(ctx);assertTrustedPostingBoundary(ctx);assertAuthorized(ctx,requiredPermission(command));return{value:await action(),idempotencyKey:ctx.idempotencyKey.trim()};}catch(error){throw normalizeApplicationError(error);}
}

export function executeSale(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"SALE_CREATE",()=>postSale(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executePurchase(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"PURCHASE_CREATE",()=>postPurchase(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executeSaleReturn(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"RETURN_CREATE",()=>postSaleReturn(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executePurchaseReturn(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"RETURN_CREATE",()=>postPurchaseReturn(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executeReceipt(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"RECEIPT_CREATE",()=>postReceiptIdempotent(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}
export function executePayment(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"PAYMENT_CREATE",()=>postPaymentIdempotent(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}
export function executeExpense(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"EXPENSE_CREATE",()=>postExpenseEntry(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}
export function executeLegacyExpense(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"EXPENSE_CREATE",()=>postExpense(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId} as never,deps));}

export function assertCommandContext(ctx:AuthorizationContext):void{assertTrustedPostingBoundary(ctx);}
