import type { Money, StockMovement } from "./types";
import { ValidationError } from "./errors";

export type StockValuationMethod = "fifo" | "weighted_average";
export interface ValuationResult { quantity: number; value: Money; unitCost: Money; }

export function valueWeightedAverage(movements: readonly StockMovement[]): ValuationResult {
  let qty=0; let value=0;
  for (const m of movements) {
    if (m.direction === "in") { qty += m.quantity; value += m.value; }
    else { if (m.quantity > qty) throw new ValidationError("Stock cannot go negative under weighted-average valuation."); const avg=qty ? value/qty : 0; value -= Math.round(m.quantity*avg); qty -= m.quantity; }
  }
  if (qty < 0 || !Number.isSafeInteger(Math.round(value))) throw new ValidationError("Invalid stock valuation result.");
  return { quantity: qty, value: Math.max(0, Math.round(value)), unitCost: qty ? Math.round(value/qty) : 0 };
}

export function valueFifo(movements: readonly StockMovement[]): ValuationResult {
  const lots: Array<{quantity:number;unitCost:Money}> = [];
  for (const m of movements) {
    if (m.direction === "in") lots.push({quantity:m.quantity,unitCost:m.unitCost});
    else { let remaining=m.quantity; while(remaining>0 && lots.length){const lot=lots[0];const take=Math.min(remaining,lot.quantity);lot.quantity-=take;remaining-=take;if(lot.quantity===0)lots.shift();} if(remaining>0) throw new ValidationError("Stock cannot go negative under FIFO valuation."); }
  }
  const quantity=lots.reduce((s,l)=>s+l.quantity,0); const value=lots.reduce((s,l)=>s+l.quantity*l.unitCost,0);
  return {quantity,value,unitCost:quantity?Math.round(value/quantity):0};
}
