import type { Money, StockMovement } from "./types";
import { ValidationError } from "./errors";

export type StockValuationMethod = "FIFO" | "WAC";
export interface ValuationLayer { id:string; date:string; movementId:string; quantity:number; unitCost:Money; value:Money; warehouseId:string; batchId?:string; batchNumber?:string; expiryDate?:string; serialNumbers?:string[]; }
export interface ValuationResult { quantity:number; value:Money; unitCost:Money; layers:ValuationLayer[]; }
export interface IssueAllocation { movementId:string; quantity:number; unitCost:Money; value:Money; warehouseId:string; batchId?:string; batchNumber?:string; expiryDate?:string; }

function validMovement(m:StockMovement){
  if(!Number.isFinite(m.quantity)||m.quantity<=0) throw new ValidationError(`Invalid stock quantity in movement ${m.id}.`);
  if(!Number.isSafeInteger(m.unitCost)||m.unitCost<0) throw new ValidationError(`Invalid unit cost in movement ${m.id}.`);
  if(!Number.isSafeInteger(m.value)||m.value<0) throw new ValidationError(`Invalid stock value in movement ${m.id}.`);
}
function ordered(ms:readonly StockMovement[]){return [...ms].sort((a,b)=>a.date.localeCompare(b.date)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));}

export function buildValuationLayers(movements:readonly StockMovement[], throughDate?:string):ValuationLayer[]{
  const layers:ValuationLayer[]=[];
  for(const m of ordered(movements.filter(x=>!throughDate||x.date<=throughDate))){
    validMovement(m);
    if(m.direction==="in"){
      layers.push({id:`${m.id}:layer`,date:m.date,movementId:m.id,quantity:m.quantity,unitCost:m.unitCost,value:Math.round(m.quantity*m.unitCost),warehouseId:m.warehouseId||"default",...(m.batchId?{batchId:m.batchId}:{}),...(m.batchNumber?{batchNumber:m.batchNumber}:{}),...(m.expiryDate?{expiryDate:m.expiryDate}:{}),...(m.serialNumbers?{serialNumbers:[...m.serialNumbers]}:{})});
      continue;
    }
    let remaining=m.quantity;
    for(const layer of layers){if(remaining<=0)break;const take=Math.min(layer.quantity,remaining);layer.quantity-=take;layer.value=Math.round(layer.quantity*layer.unitCost);remaining-=take;}
    if(remaining>0) throw new ValidationError(`Negative stock is not allowed: movement ${m.id} requires ${remaining} additional units.`);
  }
  return layers.filter(x=>x.quantity>0);
}

export function fifoIssue(movements:readonly StockMovement[],quantity:number,warehouseId?:string,throughDate?:string):ValuationResult{
  if(!Number.isFinite(quantity)||quantity<=0)throw new ValidationError("Issue quantity must be greater than zero.");
  const scope=warehouseId||"default";const layers=buildValuationLayers(movements.filter(m=>(m.warehouseId||"default")===scope),throughDate);const available=layers.reduce((s,l)=>s+l.quantity,0);
  if(available<quantity)throw new ValidationError(`Insufficient stock: available ${available}, required ${quantity}.`);
  let remaining=quantity,value=0;const allocations:IssueAllocation[]=[];
  for(const l of layers){if(remaining<=0)break;const take=Math.min(l.quantity,remaining);const v=Math.round(take*l.unitCost);value+=v;remaining-=take;allocations.push({movementId:l.movementId,quantity:take,unitCost:l.unitCost,value:v,warehouseId:l.warehouseId,...(l.batchId?{batchId:l.batchId}:{}),...(l.batchNumber?{batchNumber:l.batchNumber}:{}),...(l.expiryDate?{expiryDate:l.expiryDate}:{})});}
  return{quantity,value,unitCost:Math.floor(value/quantity),layers:allocations.map((a,i)=>({id:`issue:${i}:${a.movementId}`,date:throughDate||"",movementId:a.movementId,quantity:a.quantity,unitCost:a.unitCost,value:a.value,warehouseId:a.warehouseId,...(a.batchId?{batchId:a.batchId}:{}),...(a.batchNumber?{batchNumber:a.batchNumber}:{}),...(a.expiryDate?{expiryDate:a.expiryDate}:{})}))};
}

export function wacCost(movements:readonly StockMovement[],quantity:number,warehouseId?:string,throughDate?:string):ValuationResult{
  if(!Number.isFinite(quantity)||quantity<=0)throw new ValidationError("Issue quantity must be greater than zero.");
  const scope=warehouseId||"default";const usable=ordered(movements.filter(m=>(m.warehouseId||"default")===scope&&(!throughDate||m.date<=throughDate)));let q=0,v=0;
  for(const m of usable){validMovement(m);if(m.direction==="in"){q+=m.quantity;v+=m.value}else{if(q<m.quantity)throw new ValidationError(`Negative stock is not allowed: movement ${m.id}.`);const cost=q?Math.floor(v/q):0;q-=m.quantity;v-=Math.round(m.quantity*cost);}}
  if(q<quantity)throw new ValidationError(`Insufficient stock: available ${q}, required ${quantity}.`);const unitCost=q?Math.floor(v/q):0;return{quantity,value:Math.round(quantity*unitCost),unitCost,layers:[]};
}

export function issueCost(method:StockValuationMethod,movements:readonly StockMovement[],quantity:number,warehouseId?:string,throughDate?:string){return method==="FIFO"?fifoIssue(movements,quantity,warehouseId,throughDate):wacCost(movements,quantity,warehouseId,throughDate);}

export function reverseMovement(m:StockMovement,id:string,createdAt:string):StockMovement{
  const {serialNumbers,...base}=m;return{...base,id,direction:m.direction==="in"?"out":"in",sourceId:`reversal:${m.sourceId}`,createdAt,...(serialNumbers?{serialNumbers:[...serialNumbers]}:{})};
}
