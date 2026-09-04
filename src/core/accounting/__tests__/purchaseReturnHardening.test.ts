import { describe, expect, it } from "vitest";
import { validateReturnAgainstOriginal } from "../returns";
import type { StockMovement } from "../types";

const movement=(id:string, quantity:number, unitCost:number, sourceType: StockMovement["sourceType"]): StockMovement => ({
  id, businessId:"biz-1", financialYearId:"fy-2026-27", date:"2026-09-01", itemId:"ITEM-1", direction:sourceType === "purchase" ? "in" : "out", quantity, unitCost, value:quantity*unitCost,
  sourceType, sourceId:sourceType === "purchase" ? "purchase-1" : "return-1", createdBy:"u1", createdAt:`2026-09-01T12:00:0${id}.000Z`,
});

describe("purchase return hardening",()=>{
  it("allows a partial purchase return and resolves the original inventory cost",()=>{
    const original=[movement("1",10,100,"purchase")];
    const result=validateReturnAgainstOriginal([{itemId:"ITEM-1",quantity:3}],original,[]);
    expect(result[0].unitCost).toBe(100);
  });

  it("prevents returning more than the original quantity",()=>{
    const original=[movement("1",10,100,"purchase")];
    expect(()=>validateReturnAgainstOriginal([{itemId:"ITEM-1",quantity:11}],original,[])).toThrow(/exceeds/i);
  });

  it("subtracts quantities already returned so a second return cannot exceed the remaining stock",()=>{
    const original=[movement("1",10,100,"purchase")];
    const prior=[movement("2",6,100,"purchase_return")];
    const result=validateReturnAgainstOriginal([{itemId:"ITEM-1",quantity:4}],original,prior);
    expect(result[0].unitCost).toBe(100);
    expect(()=>validateReturnAgainstOriginal([{itemId:"ITEM-1",quantity:5}],original,prior)).toThrow(/exceeds/i);
  });

  it("preserves FIFO layer cost when a return spans purchase layers",()=>{
    const original=[movement("1",5,100,"purchase"),movement("2",5,120,"purchase")];
    const result=validateReturnAgainstOriginal([{itemId:"ITEM-1",quantity:5}],original,[]);
    expect(result[0].unitCost).toBe(100);
  });
});
