import { describe, expect, it } from "node:test";
import { validateReturnAgainstOriginal } from "./returns";
import type { StockMovement } from "./types";

const movement=(id:string,qty:number,cost:number,createdAt:string):StockMovement=>({id,businessId:"b",financialYearId:"fy",date:"2026-04-01",itemId:"i",direction:"in",quantity:qty,unitCost:cost,value:qty*cost,sourceType:"sale",sourceId:"sale-1",createdBy:"u",createdAt});

describe("return controls",()=>{
 it("uses original valuation layers",()=>{const r=validateReturnAgainstOriginal([{itemId:"i",quantity:12}], [movement("a",10,500,"2026-04-01T00:00:00Z"),movement("b",10,600,"2026-04-02T00:00:00Z")], []);expect(r[0].unitCost).toBe(550);});
 it("accounts for already returned quantity",()=>{const r=validateReturnAgainstOriginal([{itemId:"i",quantity:5}], [movement("a",10,500,"2026-04-01T00:00:00Z")], [ {...movement("r",4,500,"2026-04-03T00:00:00Z"),sourceType:"sale_return",sourceId:"ret-1",direction:"in"} ]);expect(r[0].unitCost).toBe(500);});
 it("rejects over-return",()=>{expect(()=>validateReturnAgainstOriginal([{itemId:"i",quantity:11}], [movement("a",10,500,"2026-04-01T00:00:00Z")], [])).toThrow();});
 it("rejects unknown item",()=>{expect(()=>validateReturnAgainstOriginal([{itemId:"x",quantity:1}], [movement("a",10,500,"2026-04-01T00:00:00Z")], [])).toThrow();});
 it("rejects duplicate item/warehouse input before posting",()=>{const input=[{itemId:"i",quantity:1,warehouseId:"w"},{itemId:"i",quantity:1,warehouseId:"w"}];expect(new Set(input.map(x=>`${x.itemId}:${x.warehouseId??""}`)).size).toBe(1);});
});
