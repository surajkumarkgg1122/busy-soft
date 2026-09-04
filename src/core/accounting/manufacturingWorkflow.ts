import { ValidationError } from "./errors";
import type { Money } from "./types";

/** Workflow/domain helpers only. Posting remains owned by productionEntry.ts and the inventory/accounting engines. */
export type ProductionStage = "draft" | "released" | "reserved" | "material_issued" | "wip" | "produced" | "completed" | "cancelled";

export interface ProductionByProduct { itemId:string; quantity:number; unitCost:Money; }
export interface ProductionScrap { itemId:string; quantity:number; unitCost:Money; reason:string; }
export interface ProductionActualCost { material:Money; labour:Money; electricity:Money; machine:Money; overhead:Money; other:Money; }
export interface ProductionVariance { standardCost:Money; actualCost:Money; variance:Money; favourable:boolean; }
export interface JobWorkInput { vendorPartyId:string; process:string; quantity:number; expectedReturnQuantity:number; outwardItemId:string; }

const transitions:Record<ProductionStage,readonly ProductionStage[]>={
  draft:["released","cancelled"],
  released:["reserved","material_issued","cancelled"],
  reserved:["material_issued","cancelled"],
  material_issued:["wip","produced","cancelled"],
  wip:["produced","cancelled"],
  produced:["completed","cancelled"],
  completed:[],
  cancelled:[],
};

export function assertProductionTransition(from:ProductionStage,to:ProductionStage):void{
  if(!transitions[from]?.includes(to)) throw new ValidationError(`Invalid production transition: ${from} -> ${to}.`);
}

export function calculateProductionVariance(standardCost:Money,actualCost:Money):ProductionVariance{
  if(!Number.isSafeInteger(standardCost)||standardCost<0)throw new ValidationError("Standard production cost must be a non-negative integer.");
  if(!Number.isSafeInteger(actualCost)||actualCost<0)throw new ValidationError("Actual production cost must be a non-negative integer.");
  const variance=actualCost-standardCost;
  return{standardCost,actualCost,variance,favourable:variance<=0};
}

export function validateByProducts(items:readonly ProductionByProduct[]):ProductionByProduct[]{
  const seen=new Set<string>();
  return items.map((item,index)=>{
    const itemId=String(item.itemId??"").trim();
    if(!itemId||seen.has(itemId))throw new ValidationError(`By-product ${index+1} has an invalid or duplicate item.`);
    if(!Number.isFinite(item.quantity)||item.quantity<=0)throw new ValidationError(`By-product ${itemId} quantity must be greater than zero.`);
    if(!Number.isSafeInteger(item.unitCost)||item.unitCost<0)throw new ValidationError(`By-product ${itemId} cost must be a non-negative integer.`);
    seen.add(itemId);return{itemId,quantity:item.quantity,unitCost:item.unitCost};
  });
}

export function validateScrap(items:readonly ProductionScrap[]):ProductionScrap[]{
  return items.map((item,index)=>{
    const itemId=String(item.itemId??"").trim();
    const reason=String(item.reason??"").trim();
    if(!itemId)throw new ValidationError(`Scrap ${index+1} requires an item.`);
    if(!reason)throw new ValidationError(`Scrap ${itemId} requires a reason.`);
    if(!Number.isFinite(item.quantity)||item.quantity<=0)throw new ValidationError(`Scrap ${itemId} quantity must be greater than zero.`);
    if(!Number.isSafeInteger(item.unitCost)||item.unitCost<0)throw new ValidationError(`Scrap ${itemId} cost must be a non-negative integer.`);
    return{itemId,quantity:item.quantity,unitCost:item.unitCost,reason};
  });
}

export function validateJobWork(input:JobWorkInput):JobWorkInput{
  if(!input.vendorPartyId?.trim())throw new ValidationError("Job-work vendor party is required.");
  if(!input.process?.trim())throw new ValidationError("Job-work process is required.");
  if(!Number.isFinite(input.quantity)||input.quantity<=0)throw new ValidationError("Job-work quantity must be greater than zero.");
  if(!Number.isFinite(input.expectedReturnQuantity)||input.expectedReturnQuantity<=0)throw new ValidationError("Expected job-work return quantity must be greater than zero.");
  if(!input.outwardItemId?.trim())throw new ValidationError("Job-work outward item is required.");
  if(input.expectedReturnQuantity>input.quantity)throw new ValidationError("Expected job-work return quantity cannot exceed outward quantity.");
  return{...input,vendorPartyId:input.vendorPartyId.trim(),process:input.process.trim(),outwardItemId:input.outwardItemId.trim()};
}

export function sumActualCost(cost:ProductionActualCost):Money{
  const values=[cost.material,cost.labour,cost.electricity,cost.machine,cost.overhead,cost.other];
  if(values.some(v=>!Number.isSafeInteger(v)||v<0))throw new ValidationError("Production actual-cost components must be non-negative integer amounts.");
  const total=values.reduce((sum,value)=>sum+value,0);
  if(!Number.isSafeInteger(total))throw new ValidationError("Production actual cost exceeds safe integer range.");
  return total;
}
