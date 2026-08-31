import type { AccountingRepository } from "@/core/accounting/types";
import { assertAuthorized, assertTrustedPostingBoundary, type AccountingPermission } from "@/core/accounting/authorization";
import { assertTrustedContext, type TrustedCommandContext } from "../context";
import { normalizeApplicationError } from "../errors";
import { postOpeningStock, type OpeningStockCommand } from "@/core/accounting/openingStock";
import { postStockAdjustment, postStockTransfer, type StockAdjustmentCommand, type StockTransferCommand } from "@/core/accounting/stockOperations";
import type { StockLedgerRow } from "@/core/accounting/stock";
import { getStockLedger } from "@/core/accounting/stockOperations";

export interface InventoryApplicationDeps { repo: AccountingRepository; ids:{next(prefix:string):string}; clock:{now():string}; }

async function execute<T>(ctx: TrustedCommandContext, permission: AccountingPermission, action:()=>Promise<T>):Promise<T>{
  try { assertTrustedContext(ctx); assertTrustedPostingBoundary(ctx); assertAuthorized(ctx, permission); return await action(); }
  catch(error){ throw normalizeApplicationError(error); }
}

export function executeOpeningStock(deps:InventoryApplicationDeps,ctx:TrustedCommandContext,input:Omit<OpeningStockCommand,"businessId"|"financialYearId"|"createdBy"|"idempotencyKey"> & {idempotencyKey:string}) {
  return execute(ctx,"OPENING_CREATE",()=>postOpeningStock(deps.repo,{...input,businessId:ctx.businessId,financialYearId:ctx.financialYearId,createdBy:ctx.userId,idempotencyKey:ctx.idempotencyKey},deps));
}

export function executeStockAdjustment(deps:InventoryApplicationDeps,ctx:TrustedCommandContext,input:Omit<StockAdjustmentCommand,"businessId"|"financialYearId"|"createdBy"|"idempotencyKey"> & {idempotencyKey:string}) {
  return execute(ctx,"INVENTORY_ADJUST",()=>postStockAdjustment(deps.repo,{...input,businessId:ctx.businessId,financialYearId:ctx.financialYearId,createdBy:ctx.userId,idempotencyKey:ctx.idempotencyKey},deps));
}

export function executeStockTransfer(deps:InventoryApplicationDeps,ctx:TrustedCommandContext,input:Omit<StockTransferCommand,"businessId"|"financialYearId"|"createdBy"|"idempotencyKey"> & {idempotencyKey:string}) {
  return execute(ctx,"INVENTORY_TRANSFER",()=>postStockTransfer(deps.repo,{...input,businessId:ctx.businessId,financialYearId:ctx.financialYearId,createdBy:ctx.userId,idempotencyKey:ctx.idempotencyKey},deps));
}

export function executeStockLedger(deps:InventoryApplicationDeps,ctx:TrustedCommandContext,itemId:string,warehouseId?:string,throughDate?:string):Promise<StockLedgerRow[]> {
  return execute(ctx,"INVENTORY_VIEW",()=>getStockLedger(deps.repo,{businessId:ctx.businessId,financialYearId:ctx.financialYearId,itemId,warehouseId},throughDate));
}
