import type { IdGenerator, Money, StockDirection, StockMovement, StockSourceType } from "./types";
import { ValidationError } from "./errors";
import { normalizeWarehouseId } from "./stock";

export interface StockMovementRequest { businessId:string; financialYearId:string; date:string; itemId:string; warehouseId?:string; direction:StockDirection; quantity:number; unitCost:Money; sourceType:StockSourceType; sourceId:string; createdBy:string; }
export function createStockMovement(input:StockMovementRequest,ids:IdGenerator,createdAt:string):StockMovement{
  if(!input.businessId||!input.financialYearId)throw new ValidationError("Stock movement requires business and financial year.");
  if(!input.itemId)throw new ValidationError("Stock movement requires an item.");
  if(!Number.isFinite(input.quantity)||input.quantity<=0)throw new ValidationError("Stock quantity must be greater than zero.");
  if(!Number.isSafeInteger(input.unitCost)||input.unitCost<0)throw new ValidationError("Unit cost must be a non-negative integer minor-unit amount.");
  if(!input.sourceId)throw new ValidationError("Stock movement requires a source voucher.");
  const value=Math.round(input.quantity*input.unitCost);
  if(!Number.isSafeInteger(value)||value<0)throw new ValidationError("Stock movement value exceeds safe integer range.");
  return{id:ids.next("stk"),businessId:input.businessId,financialYearId:input.financialYearId,date:input.date,itemId:input.itemId,warehouseId:normalizeWarehouseId(input.warehouseId),direction:input.direction,quantity:input.quantity,unitCost:input.unitCost,value,sourceType:input.sourceType,sourceId:input.sourceId,createdBy:input.createdBy,createdAt};
}
export function signedQuantity(movement:Pick<StockMovement,"direction"|"quantity">):number{return movement.direction==="in"?movement.quantity:-movement.quantity;}
export function calculateStockBalance(movements:readonly Pick<StockMovement,"direction"|"quantity">[]):number{const value=movements.reduce((sum,m)=>sum+signedQuantity(m),0);if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw new ValidationError("Stock quantity exceeds safe numeric range.");return value;}
export function calculateStockValue(movements:readonly Pick<StockMovement,"direction"|"quantity"|"unitCost">[]):Money{const value=movements.reduce((sum,m)=>sum+signedQuantity(m)*m.unitCost,0);if(!Number.isSafeInteger(value))throw new ValidationError("Stock value exceeds safe integer range.");return value;}
