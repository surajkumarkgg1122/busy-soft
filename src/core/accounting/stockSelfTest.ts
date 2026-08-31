import type { StockMovement } from "./types";
import { assertAvailableStock, balanceFor, buildStockLedger, normalizeWarehouseId, reconcileCachedStock, transferMovements } from "./stock";

const sample=(id:string,direction:"in"|"out",quantity:number,warehouseId?:string):StockMovement=>({id,businessId:"b",financialYearId:"fy",date:"2026-08-31",itemId:"i",warehouseId,direction,quantity,unitCost:100,value:Math.round(quantity*100),sourceType:direction==="in"?"purchase":"sale",sourceId:id,createdBy:"u",createdAt:`2026-08-31T00:00:0${id}`});
const assert=(condition:boolean,message:string)=>{if(!condition)throw new Error(`Stock self-test failed: ${message}`);};

export function runStockSelfTest():void{
  assert(normalizeWarehouseId()==="default","default warehouse normalization");
  const movements=[sample("1","in",10,"w1"),sample("2","in",4,"w2"),sample("3","out",3,"w1")];
  assert(balanceFor(movements,{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"}).quantity===7,"warehouse isolation");
  assert(balanceFor(movements,{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w2"}).quantity===4,"second warehouse isolation");
  assert(assertAvailableStock(movements,{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"},7).quantity===7,"availability from ledger");
  let rejected=false;try{assertAvailableStock(movements,{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"},8);}catch{rejected=true;}assert(rejected,"insufficient stock rejection");
  const ledger=buildStockLedger([sample("2","out",2,"w1"),sample("1","in",10,"w1")],{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"});assert(ledger[ledger.length-1].runningQuantity===8,"running ledger");
  const cache=reconcileCachedStock({stock:999},balanceFor([sample("1","in",5,"w1")],{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"}),"now");assert(cache.stock===5,"cache reconciliation");
  const [out,inMove]=transferMovements({businessId:"b",financialYearId:"fy",date:"2026-08-31",itemId:"i",fromWarehouseId:"w1",toWarehouseId:"w2",quantity:3,unitCost:100,sourceId:"v",createdBy:"u"},"o","n","now");assert(out.direction==="out"&&inMove.direction==="in"&&out.quantity===inMove.quantity,"balanced transfer");
}
