import { ValidationError } from "./errors";
import { assertQuantity, assertMoney } from "./money";

export type StockTrackingMode = "none" | "batch" | "serial";

export interface StockTrackingInput {
  mode: StockTrackingMode;
  quantity: number;
  batchNo?: string;
  serialNumbers?: string[];
  expiryDate?: string;
  unitCost?: number;
}

export function validateStockTracking(input:StockTrackingInput):void {
  assertQuantity(input.quantity);
  if(input.unitCost!==undefined)assertMoney(input.unitCost,"Unit cost");
  if(input.mode==="batch"&&!input.batchNo?.trim())throw new ValidationError("Batch-tracked stock requires a batch number.");
  if(input.mode!=="serial"&&input.serialNumbers?.length)throw new ValidationError("Serial numbers are allowed only for serial-tracked stock.");
  if(input.mode==="serial"){
    if(!input.serialNumbers?.length)throw new ValidationError("Serial-tracked stock requires serial numbers.");
    if(input.serialNumbers.length!==Math.floor(input.quantity))throw new ValidationError("Serial number count must equal the stock quantity.");
    const normalized=input.serialNumbers.map(v=>v.trim()).filter(Boolean);
    if(normalized.length!==input.serialNumbers.length)throw new ValidationError("Serial numbers cannot be empty.");
    if(new Set(normalized).size!==normalized.length)throw new ValidationError("Duplicate serial numbers are not allowed.");
  }
  if(input.expiryDate!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate))throw new ValidationError("Expiry date must be YYYY-MM-DD.");
}

export function assertSaleQuantityAvailable(available:number,requested:number):void {
  assertQuantity(requested);
  if(!Number.isFinite(available)||available<0)throw new ValidationError("Available stock is invalid.");
  if(requested>available)throw new ValidationError(`Insufficient stock. Available: ${available}. Requested: ${requested}.`);
}
