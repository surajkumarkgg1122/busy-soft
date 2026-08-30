import { ValidationError } from "@/core/accounting/errors";
import type { AccountingRepository } from "@/core/accounting/types";
import { postSale, postPurchase } from "@/core/accounting/transactions";
import { postSaleReturn, postPurchaseReturn } from "@/core/accounting/returns";
import { authorizeAccountingCommand, type AuthorizationContext } from "@/core/accounting/authorization";

export type AccountingCommandName = "SALE_CREATE" | "PURCHASE_CREATE" | "RETURN_CREATE";
export interface CommandContext extends AuthorizationContext { idempotencyKey: string; }
export interface ApplicationDeps { repo: AccountingRepository; ids: { next(prefix:string):string }; clock:{ now():string }; }
export interface CommandResult<T=unknown> { value:T; idempotencyKey:string; }

function validateContext(ctx: CommandContext){
  if(!ctx.businessId || !ctx.userId) throw new ValidationError("Authenticated business and user are required.");
  if(!ctx.idempotencyKey || ctx.idempotencyKey.length < 8 || ctx.idempotencyKey.length > 128) throw new ValidationError("A valid idempotency key is required.");
}

async function execute<T>(deps:ApplicationDeps, ctx:CommandContext, command:AccountingCommandName, action:()=>Promise<T>):Promise<CommandResult<T>>{
  validateContext(ctx);
  authorizeAccountingCommand(ctx, command);
  const existing = await deps.repo.findIdempotencyResult?.(ctx.businessId, ctx.idempotencyKey);
  if(existing) return { value: existing as T, idempotencyKey: ctx.idempotencyKey };
  const value = await action();
  await deps.repo.saveIdempotencyResult?.(ctx.businessId, ctx.idempotencyKey, value);
  return { value, idempotencyKey: ctx.idempotencyKey };
}

export async function executeSale(deps:ApplicationDeps,ctx:CommandContext,input:any){return execute(deps,ctx,"SALE_CREATE",()=>postSale(deps.repo,{...input,businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey},deps));}
export async function executePurchase(deps:ApplicationDeps,ctx:CommandContext,input:any){return execute(deps,ctx,"PURCHASE_CREATE",()=>postPurchase(deps.repo,{...input,businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey},deps));}
export async function executeSaleReturn(deps:ApplicationDeps,ctx:CommandContext,input:any){return execute(deps,ctx,"RETURN_CREATE",()=>postSaleReturn(deps.repo,{...input,businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey},deps));}
export async function executePurchaseReturn(deps:ApplicationDeps,ctx:CommandContext,input:any){return execute(deps,ctx,"RETURN_CREATE",()=>postPurchaseReturn(deps.repo,{...input,businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey},deps));}
