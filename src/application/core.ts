import { postSale, postPurchase } from "@/core/accounting/transactions";
import { postSaleReturn, postPurchaseReturn } from "@/core/accounting/returns";
import { authorizeAccountingCommand, type AuthorizationContext } from "@/core/accounting/authorization";
import { assertTrustedContext, type TrustedCommandContext } from "./context";
import { normalizeApplicationError } from "./errors";

export type AccountingCommandName = "SALE_CREATE" | "PURCHASE_CREATE" | "RETURN_CREATE";
export type CommandContext = TrustedCommandContext;
export interface ApplicationDeps { repo: import("@/core/accounting/types").AccountingRepository; ids: { next(prefix:string):string }; clock:{ now():string }; }
export interface CommandResult<T=unknown> { value:T; idempotencyKey:string; }

async function execute<T>(deps:ApplicationDeps, ctx:CommandContext, command:AccountingCommandName, action:()=>Promise<T>):Promise<CommandResult<T>> {
  try {
    assertTrustedContext(ctx);
    authorizeAccountingCommand(ctx, command);
    // Do not perform a non-atomic read/then-write here. The Accounting Core
    // performs the idempotency check inside its repository transaction.
    const value = await action();
    return { value, idempotencyKey: ctx.idempotencyKey.trim() };
  } catch (error) {
    throw normalizeApplicationError(error);
  }
}

export function executeSale(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"SALE_CREATE",()=>postSale(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executePurchase(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"PURCHASE_CREATE",()=>postPurchase(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executeSaleReturn(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"RETURN_CREATE",()=>postSaleReturn(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
export function executePurchaseReturn(deps:ApplicationDeps,ctx:CommandContext,input:unknown){return execute(deps,ctx,"RETURN_CREATE",()=>postPurchaseReturn(deps.repo,{...(input as object),businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey,financialYearId:ctx.financialYearId} as never,deps));}
