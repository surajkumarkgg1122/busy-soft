import { describe, expect, it } from "vitest";
import { assertProductionTransition, calculateProductionVariance, sumActualCost, validateByProducts, validateJobWork, validateScrap } from "../manufacturingWorkflow";

describe("manufacturing workflow hardening",()=>{
  it("enforces the production lifecycle",()=>{
    expect(()=>assertProductionTransition("draft","released")).not.toThrow();
    expect(()=>assertProductionTransition("released","reserved")).not.toThrow();
    expect(()=>assertProductionTransition("reserved","material_issued")).not.toThrow();
    expect(()=>assertProductionTransition("material_issued","wip")).not.toThrow();
    expect(()=>assertProductionTransition("wip","produced")).not.toThrow();
    expect(()=>assertProductionTransition("produced","completed")).not.toThrow();
    expect(()=>assertProductionTransition("completed","wip")).toThrow();
  });

  it("calculates production variance without mutating accounting truth",()=>{
    expect(calculateProductionVariance(10000,10800)).toEqual({standardCost:10000,actualCost:10800,variance:800,favourable:false});
    expect(calculateProductionVariance(10000,9500).favourable).toBe(true);
  });

  it("validates by-products and scrap as production outputs/adjustments",()=>{
    expect(validateByProducts([{itemId:"bp-1",quantity:2,unitCost:500}])).toHaveLength(1);
    expect(()=>validateByProducts([{itemId:"bp-1",quantity:0,unitCost:500}])).toThrow();
    expect(validateScrap([{itemId:"scrap-1",quantity:1,unitCost:0,reason:"process waste"}])).toHaveLength(1);
    expect(()=>validateScrap([{itemId:"scrap-1",quantity:1,unitCost:0,reason:""}])).toThrow();
  });

  it("validates job-work quantities and vendor/process references",()=>{
    expect(validateJobWork({vendorPartyId:"party-1",process:"cutting",quantity:10,expectedReturnQuantity:9,outwardItemId:"raw-1"}).expectedReturnQuantity).toBe(9);
    expect(()=>validateJobWork({vendorPartyId:"party-1",process:"cutting",quantity:10,expectedReturnQuantity:11,outwardItemId:"raw-1"})).toThrow();
  });

  it("sums actual manufacturing cost safely",()=>{
    expect(sumActualCost({material:5000,labour:1000,electricity:500,machine:250,overhead:750,other:0})).toBe(7500);
    expect(()=>sumActualCost({material:-1,labour:0,electricity:0,machine:0,overhead:0,other:0})).toThrow();
  });
});
