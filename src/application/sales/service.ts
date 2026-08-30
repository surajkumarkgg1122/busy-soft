import type { AccountingRepository } from "@/core/accounting/types";
import type { AccountingPermission } from "@/core/accounting/authorization";
import { executeSale } from "@/application/core";
import { ValidationError } from "@/core/accounting/errors";
import { assertMoney, assertQuantity } from "@/core/accounting/money";
export interface SalesApplicationDeps { repo: AccountingRepository; ids:{next(prefix:string):string}; clock:{now():string}; }
export interface CreateSaleContext { businessId:string; userId:string; financialYearId:string; idempotencyKey:string; permissions:AccountingPermission[]; role?:string; }
export interface CreateSaleItem { itemId:string; quantity:number; unitCost?:number; warehouseId?:string; }
export interface CreateSaleInput { date:string; customerId?:string; mode:"credit"|"cash"|"bank"; taxableValue:number; taxRate:number; intraState:boolean; cessRate?:number; accountMap:Record<string,string|undefined>; itemMovements:CreateSaleItem[]; narration?:string; totalCost?:number; documentId?:string; documentPayload?:Record<string,unknown>; }
function validate(input:CreateSaleInput){if(!input.date||!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Sale date must be YYYY-MM-DD.");assertMoney(input.taxableValue,"Taxable value");if(input.taxRate<0||input.taxRate>100)throw new ValidationError("Invalid tax rate.");if(!input.itemMovements.length)throw new ValidationError("At least one sale item is required.");for(const line of input.itemMovements){if(!line.itemId)throw new ValidationError("Item is required.");assertQuantity(line.quantity);if(line.unitCost!==undefined)assertMoney(line.unitCost,"Unit cost");}}
export async function createSale(deps:SalesApplicationDeps,ctx:CreateSaleContext,input:CreateSaleInput){if(!ctx.businessId||!ctx.userId||!ctx.financialYearId)throw new ValidationError("Authenticated business, user and financial year are required.");if(!ctx.idempotencyKey)throw new ValidationError("Idempotency key is required.");validate(input);return executeSale(deps,{...ctx},input);}
