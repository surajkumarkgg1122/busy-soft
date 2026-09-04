import type { IdGenerator, Money, StockDirection, StockMovement, StockSourceType } from "./types";
import { ValidationError } from "./errors";
import { normalizeWarehouseId } from "./stock";

export interface StockMovementRequest {
  businessId:string; financialYearId:string; date:string; itemId:string; warehouseId?:string;
  direction:StockDirection; quantity:number; unitCost:Money; sourceType:StockSourceType; sourceId:string; createdBy:string;
  batchId?:string; batchNumber?:string; manufactureDate?:string; expiryDate?:string; serialNumbers?:string[]; unitId?:string; quantityInBaseUnit?:number;
}

function validateTracking(input:StockMovementRequest){
  if(input.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) throw new ValidationError("Expiry date must use YYYY-MM-DD format.");
  if(input.manufactureDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.manufactureDate)) throw new ValidationError("Manufacture date must use YYYY-MM-DD format.");
  if(input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("Stock movement date must use YYYY-MM-DD format.");
  if(input.manufactureDate && input.expiryDate && input.expiryDate < input.manufactureDate) throw new ValidationError("Expiry date cannot be before manufacture date.");
  if(input.batchNumber && !input.batchId) throw new ValidationError("Batch number requires a batch ID.");
  if(input.serialNumbers){
    if(input.serialNumbers.length===0) throw new ValidationError("Serial number list cannot be empty.");
    const normalized=input.serialNumbers.map(x=>x.trim()).filter(Boolean);
    if(normalized.length!==input.serialNumbers.length) throw new ValidationError("Serial numbers cannot be blank.");
    if(new Set(normalized).size!==normalized.length) throw new ValidationError("Serial numbers must be unique within a stock movement.");
    if(!Number.isSafeInteger(input.quantity) || normalized.length!==input.quantity) throw new ValidationError("Serial-tracked stock quantity must be a whole number equal to the number of serial numbers.");
  }
  if(input.quantityInBaseUnit!==undefined && (!Number.isFinite(input.quantityInBaseUnit)||input.quantityInBaseUnit<=0)) throw new ValidationError("Base-unit quantity must be greater than zero.");
}

export function createStockMovement(input:StockMovementRequest,ids:IdGenerator,createdAt:string):StockMovement{
  if(!input.businessId||!input.financialYearId)throw new ValidationError("Stock movement requires business and financial year.");
  if(!input.itemId)throw new ValidationError("Stock movement requires an item.");
  if(input.direction!=="in"&&input.direction!=="out")throw new ValidationError("Invalid stock movement direction.");
  if(!Number.isFinite(input.quantity)||input.quantity<=0)throw new ValidationError("Stock quantity must be greater than zero.");
  if(!Number.isSafeInteger(input.unitCost)||input.unitCost<0)throw new ValidationError("Unit cost must be a non-negative integer minor-unit amount.");
  if(!input.sourceId)throw new ValidationError("Stock movement requires a source voucher.");
  validateTracking(input);
  const value=Math.round(input.quantity*input.unitCost);
  if(!Number.isSafeInteger(value)||value<0)throw new ValidationError("Stock movement value exceeds safe integer range.");
  return{id:ids.next("stk"),businessId:input.businessId,financialYearId:input.financialYearId,date:input.date,itemId:input.itemId,warehouseId:normalizeWarehouseId(input.warehouseId),direction:input.direction,quantity:input.quantity,unitCost:input.unitCost,value,sourceType:input.sourceType,sourceId:input.sourceId,createdBy:input.createdBy,createdAt,...(input.batchId?{batchId:input.batchId}:{}),...(input.batchNumber?{batchNumber:input.batchNumber}:{}),...(input.manufactureDate?{manufactureDate:input.manufactureDate}:{}),...(input.expiryDate?{expiryDate:input.expiryDate}:{}),...(input.serialNumbers?{serialNumbers:[...input.serialNumbers]}:{}),...(input.unitId?{unitId:input.unitId}:{}),...(input.quantityInBaseUnit!==undefined?{quantityInBaseUnit:input.quantityInBaseUnit}:{}),};
}

export function signedQuantity(movement:Pick<StockMovement,"direction"|"quantity">):number{return movement.direction==="in"?movement.quantity:-movement.quantity;}
export function calculateStockBalance(movements:readonly Pick<StockMovement,"direction"|"quantity">[]):number{const value=movements.reduce((sum,m)=>sum+signedQuantity(m),0);if(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER)throw new ValidationError("Stock quantity exceeds safe numeric range.");return value;}
export function calculateStockValue(movements:readonly Pick<StockMovement,"direction"|"quantity"|"unitCost">[]):Money{const value=movements.reduce((sum,m)=>sum+signedQuantity(m)*m.unitCost,0);if(!Number.isSafeInteger(value))throw new ValidationError("Stock value exceeds safe integer range.");return value;}
