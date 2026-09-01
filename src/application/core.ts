import type { AccountingRepository } from "@/core/accounting/types";
import type { AccountingPermission, AuthorizationContext } from "@/core/accounting/authorization";
import { assertAuthorized, assertTrustedPostingBoundary } from "@/core/accounting/authorization";
import { postPurchase, postExpense } from "@/core/accounting/transactions";
import { postReceiptIdempotent, postPaymentIdempotent } from "@/core/accounting/settlements";
import { postExpenseEntry } from "@/core/accounting/expenseEntry";
import { postSaleEntry, type SaleEntryInput } from "@/core/accounting/saleEntry";
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

/** Canonical application-layer sale command. The domain sale engine is postSaleEntry. */
export function executeSale(deps:ApplicationDeps,ctx:CommandContext,input:unknown){
  const source=input as Record<string,unknown>;
  const accountMap=(source.accountMap??{}) as Record<string,string|undefined>;
  const paymentMode=source.mode as "cash"|"bank"|"credit";
  const canonical:SaleEntryInput={
    businessId:ctx.businessId,
    financialYearId:ctx.financialYearId,
    date:String(source.date??""),
    userId:ctx.userId,
    customerId:typeof source.customerId==="string"?source.customerId:undefined,
    grossValue:Number(source.taxableValue),
    taxRate:Number(source.taxRate),
    intraState:Boolean(source.intraState),
    cessRate:source.cessRate===undefined?undefined:Number(source.cessRate),
    paymentMode,
    paidAmount:paymentMode==="credit"?0:undefined,
    bankAccountId:paymentMode==="bank"?accountMap.bank:undefined,
    accountMap:{
      party:accountMap.party!,sales:accountMap.sales!,cash:accountMap.cash,bank:accountMap.bank,
      outputCgst:accountMap.outputCgst,outputSgst:accountMap.outputSgst,outputIgst:accountMap.outputIgst,
      outputCess:accountMap.outputCess,inventory:accountMap.inventory!,cogs:accountMap.cogs!,
    },
    itemMovements:Array.isArray(source.itemMovements)?(source.itemMovements as Array<{itemId:string;quantity:number;warehouseId?:string}>):[],
    valuationMethod:source.valuationMethod as SaleEntryInput["valuationMethod"],
    narration:typeof source.narration==="string"?source.narration:undefined,
    idempotencyKey:ctx.idempotencyKey,
    documentId:typeof source.documentId==="string"?source.documentId:undefined,
    documentPayload:source.documentPayload as Record<string,unknown>|undefined,
  };
  return execute(ctx,"SALE_CREATE",()=>postSaleEntry(deps.repo,canonical,deps));
}

export function executePurchase(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"PURCHASE_CREATE",()=>postPurchase(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executeSaleReturn(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"RETURN_CREATE",()=>postSaleReturn(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executePurchaseReturn(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"RETURN_CREATE",()=>postPurchaseReturn(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executeReceipt(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"RECEIPT_CREATE",()=>postReceiptIdempotent(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}
export function executePayment(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"PAYMENT_CREATE",()=>postPaymentIdempotent(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}
export function executeExpense(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"EXPENSE_CREATE",()=>postExpenseEntry(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey} as never,deps));}

/** @deprecated Use executeExpense. Retained only as a compatibility shim for existing integrations. */
export function executeLegacyExpense(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(ctx,"EXPENSE_CREATE",()=>postExpense(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId} as never,deps));}

export function assertCommandContext(ctx:AuthorizationContext):void{assertTrustedPostingBoundary(ctx);}
