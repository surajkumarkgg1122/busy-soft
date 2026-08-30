import { postSale, postPurchase } from "@/core/accounting/transactions";
import { postSaleReturn, postPurchaseReturn } from "@/core/accounting/returns";
import { assertAuthorized, assertTrustedPostingBoundary, type AccountingPermission } from "@/core/accounting/authorization";
import { assertTrustedContext, type TrustedCommandContext } from "./context";
import { normalizeApplicationError } from "./errors";

export type AccountingCommandName = "SALE_CREATE" | "PURCHASE_CREATE" | "RETURN_CREATE";
export type CommandContext = TrustedCommandContext;
export interface ApplicationDeps { repo: import("@/core/accounting/types").AccountingRepository; ids: { next(prefix:string):string }; clock:{ now():string }; }
export interface CommandResult<T=unknown> { value:T; idempotencyKey:string; }

function requiredPermission(command: AccountingCommandName): AccountingPermission {
  switch (command) {
    case "SALE_CREATE": return "SALE_CREATE";
    case "PURCHASE_CREATE": return "PURCHASE_CREATE";
    case "RETURN_CREATE": return "RETURN_CREATE";
  }
}

async function execute<T>(deps:ApplicationDeps, ctx:CommandContext, command:AccountingCommandName, action:()=>Promise<T>):Promise<CommandResult<T>> {
  try {
    assertTrustedContext(ctx);
    assertTrustedPostingBoundary(ctx);
    assertAuthorized(ctx, requiredPermission(command));
    // Idempotency is deliberately resolved inside the Core's atomic repository
    // transaction. Never replace this with a client-side read/then-write check.
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
