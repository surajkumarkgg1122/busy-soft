import { describe, expect, it } from "vitest";
import { assertNotExpired, assertSaleQuantityAvailable, assertSerialsAvailable, reconcileInventory, validateStockTracking } from "./inventoryControls";
import type { StockMovement } from "./types";
const base={businessId:"b1",financialYearId:"fy1",itemId:"i1",warehouseId:"w1",createdBy:"u1"};
const movement=(id:string,direction:"in"|"out",quantity:number,unitCost:number,extra:Partial<StockMovement>={}):StockMovement=>({id,...base,date:"2026-04-01",direction,quantity,unitCost,value:quantity*unitCost,sourceType:direction==="in"?"opening":"sale",sourceId:id,createdAt:`2026-04-01T00:00:0${id.length}Z`,...extra});
describe("inventory controls",()=>{
 it("requires valid batch and serial data",()=>{expect(()=>validateStockTracking({mode:"batch",quantity:5,batchNo:"B-01"})).not.toThrow();expect(()=>validateStockTracking({mode:"batch",quantity:5})).toThrow(/batch/i);expect(()=>validateStockTracking({mode:"serial",quantity:2,serialNumbers:["S1","S2"]})).not.toThrow();expect(()=>validateStockTracking({mode:"serial",quantity:2,serialNumbers:["S1","S1"]})).toThrow(/duplicate/i);});
 it("rejects expired stock",()=>expect(()=>assertNotExpired("2026-03-01","2026-04-01")).toThrow());
 it("allows unexpired stock",()=>expect(()=>assertNotExpired("2026-05-01","2026-04-01")).not.toThrow());
 it("prevents re-issuing a serial",()=>{const ms=[movement("1","in",1,100,{serialNumbers:["S1"]}),movement("2","out",1,100,{serialNumbers:["S1"]})];expect(()=>assertSerialsAvailable(ms,["S1"],1)).toThrow();});
 it("detects cached stock variance",()=>{const ms=[movement("1","in",10,100)];const r=reconcileInventory(ms,base,{quantity:9,value:900});expect(r.quantityMatches).toBe(false);expect(r.varianceQuantity).toBe(1);expect(r.varianceValue).toBe(100);});
 it("prevents stock oversell",()=>{expect(()=>assertSaleQuantityAvailable(5,5)).not.toThrow();expect(()=>assertSaleQuantityAvailable(5,6)).toThrow(/insufficient/i);});
});
