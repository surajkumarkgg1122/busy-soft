import { describe, expect, it } from "vitest";
import type { StockMovement } from "./types";
import { fifoIssue, wacCost, buildValuationLayers, reverseMovement } from "./inventoryValuation";

const m=(id:string,date:string,direction:"in"|"out",quantity:number,unitCost:number,warehouseId="default"):StockMovement=>({id,businessId:"b",financialYearId:"fy",date,itemId:"i",warehouseId,direction,quantity,unitCost,value:quantity*unitCost,sourceType:direction==="in"?"purchase":"sale",sourceId:id,createdBy:"u",createdAt:`${date}T00:00:00.000Z`});

describe("inventory valuation",()=>{
 it("builds FIFO layers and consumes oldest stock first",()=>{const ms=[m("p1","2026-01-01","in",10,100),m("p2","2026-01-02","in",10,120)];const r=fifoIssue(ms,12);expect(r.value).toBe(1240);expect(r.layers.map(x=>x.quantity)).toEqual([10,2]);});
 it("rejects negative stock",()=>{expect(()=>fifoIssue([m("p1","2026-01-01","in",5,100)],6)).toThrow(/Insufficient stock/);});
 it("calculates WAC issue cost",()=>{const ms=[m("p1","2026-01-01","in",10,100),m("p2","2026-01-02","in",10,120)];expect(wacCost(ms,5).value).toBe(550);});
 it("keeps warehouses isolated",()=>{const ms=[m("p1","2026-01-01","in",10,100,"A"),m("p2","2026-01-01","in",10,200,"B")];expect(buildValuationLayers(ms).reduce((s,x)=>s+x.quantity,0)).toBe(20);expect(()=>fifoIssue(ms,11,"A")).toThrow();});
 it("creates a reversal with the opposite direction",()=>{const x=m("p1","2026-01-01","in",4,100);const r=reverseMovement(x,"rev1","2026-01-02T00:00:00.000Z");expect(r.direction).toBe("out");expect(r.sourceId).toBe("reversal:p1");});
});
