import { describe, expect, it } from "vitest";
import type { StockMovement } from "./types";
import { assertAvailableStock, balanceFor, buildStockLedger, normalizeWarehouseId, reconcileCachedStock, transferMovements } from "./stock";

const m=(id:string,direction:"in"|"out",quantity:number,warehouseId?:string):StockMovement=>({id,businessId:"b",financialYearId:"fy",date:"2026-08-31",itemId:"i",warehouseId,direction,quantity,unitCost:100,value:quantity*100,sourceType:direction==="in"?"purchase":"sale",sourceId:id,createdBy:"u",createdAt:`2026-08-31T00:00:0${id}`});

describe("authoritative stock",()=>{
  it("uses default warehouse consistently",()=>expect(normalizeWarehouseId()).toBe("default"));
  it("isolates warehouses",()=>{const ms=[m("1","in",10,"w1"),m("2","in",4,"w2")];expect(balanceFor(ms,{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"}).quantity).toBe(10);expect(balanceFor(ms,{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w2"}).quantity).toBe(4);});
  it("rejects only when ledger availability is insufficient",()=>{const ms=[m("1","in",10,"w1"),m("2","out",3,"w1")];expect(assertAvailableStock(ms,{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"},7).quantity).toBe(7);expect(()=>assertAvailableStock(ms,{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"},8)).toThrow(/Insufficient stock/);});
  it("builds a deterministic running ledger",()=>{const rows=buildStockLedger([m("2","out",2,"w1"),m("1","in",10,"w1")],{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"});expect(rows.map(r=>r.runningQuantity)).toEqual([10,8]);});
  it("reconciles cache from ledger balance",()=>{const result=reconcileCachedStock({stock:999},balanceFor([m("1","in",5,"w1")],{businessId:"b",financialYearId:"fy",itemId:"i",warehouseId:"w1"}),"now");expect(result.stock).toBe(5);expect(result.stockReconciliationSource).toBe("stockMovements");});
  it("creates balanced transfer movements",()=>{const [out,inMove]=transferMovements({businessId:"b",financialYearId:"fy",date:"2026-08-31",itemId:"i",fromWarehouseId:"w1",toWarehouseId:"w2",quantity:3,unitCost:100,sourceId:"v",createdBy:"u"},"o","n","now");expect(out.direction).toBe("out");expect(inMove.direction).toBe("in");expect(out.quantity).toBe(inMove.quantity);});
});
