import { describe, expect, it } from "vitest";
import { createStockMovement, calculateStockBalance, calculateStockValue } from "../inventory";
import { balanceFor, buildStockLedger, assertAvailableStock } from "../stock";
import { valueFifo, valueWeightedAverage, calculateOutgoingCost } from "../valuation";
import { InMemoryAccountingRepository, fixedClock, testIds } from "../inMemoryRepository";

const ids=testIds("inventory");
const clock=fixedClock("2026-09-04T10:00:00.000Z");
const movement=(input:Parameters<typeof createStockMovement>[0])=>createStockMovement(input,ids,clock.now());

const base={businessId:"biz-1",financialYearId:"fy-2026-27",date:"2026-09-04",itemId:"ITEM-1",warehouseId:"default",createdBy:"u1"};

describe("inventory engine hardening",()=>{
  it("reconciles stock summary and ledger from authoritative movements",()=>{
    const opening=movement({...base,direction:"in",quantity:10,unitCost:100,sourceType:"opening",sourceId:"opening-1"});
    const purchase=movement({...base,direction:"in",quantity:5,unitCost:120,sourceType:"purchase",sourceId:"purchase-1"});
    const sale=movement({...base,direction:"out",quantity:4,unitCost:100,sourceType:"sale",sourceId:"sale-1"});
    const ms=[opening,purchase,sale];
    expect(calculateStockBalance(ms)).toBe(11);
    expect(calculateStockValue(ms)).toBe(1600);
    const summary=balanceFor(ms,{businessId:base.businessId,financialYearId:base.financialYearId,itemId:base.itemId,warehouseId:base.warehouseId});
    const ledger=buildStockLedger(ms,{businessId:base.businessId,financialYearId:base.financialYearId,itemId:base.itemId,warehouseId:base.warehouseId});
    expect(summary.quantity).toBe(ledger.at(-1)?.runningQuantity);
    expect(summary.value).toBe(ledger.at(-1)?.runningValue);
  });

  it("rejects negative stock before an outbound movement",()=>{
    const inMovement=movement({...base,direction:"in",quantity:2,unitCost:100,sourceType:"opening",sourceId:"opening-2"});
    expect(()=>assertAvailableStock([inMovement],base,3,base.date)).toThrow(/Insufficient stock/i);
  });

  it("keeps FIFO and weighted-average valuation deterministic",()=>{
    const a=movement({...base,direction:"in",quantity:10,unitCost:100,sourceType:"purchase",sourceId:"p-1"});
    const b=movement({...base,direction:"in",quantity:5,unitCost:160,sourceType:"purchase",sourceId:"p-2"});
    expect(valueFifo([a,b]).value).toBe(1800);
    expect(valueWeightedAverage([a,b]).value).toBe(1800);
    expect(calculateOutgoingCost([a,b],12,"fifo").cost).toBe(1320);
    expect(calculateOutgoingCost([a,b],12,"weighted_average").cost).toBe(1440);
  });

  it("rejects invalid tracking and serial quantities",()=>{
    expect(()=>movement({...base,direction:"in",quantity:2,unitCost:100,sourceType:"purchase",sourceId:"p-3",serialNumbers:["S1"]})).toThrow(/serial/i);
    expect(()=>movement({...base,direction:"in",quantity:1,unitCost:100,sourceType:"purchase",sourceId:"p-4",manufactureDate:"2026-09-05",expiryDate:"2026-09-04"})).toThrow(/Expiry/i);
  });

  it("keeps business and financial-year scope isolated",()=>{
    const a=movement({...base,direction:"in",quantity:10,unitCost:100,sourceType:"opening",sourceId:"scope-1"});
    const other=movement({...base,businessId:"biz-2",direction:"in",quantity:50,unitCost:100,sourceType:"opening",sourceId:"scope-2"});
    expect(balanceFor([a,other],{businessId:"biz-1",financialYearId:base.financialYearId,itemId:base.itemId,warehouseId:"default"}).quantity).toBe(10);
  });

  it("serializes concurrent inventory transactions in the in-memory repository",async()=>{
    const repo=new InMemoryAccountingRepository();
    const a=repo.runInTransaction(async tx=>{await new Promise(r=>setTimeout(r,5));await tx.saveBusinessDocument("test","a",{value:1});return 1;});
    const b=repo.runInTransaction(async tx=>{await tx.saveBusinessDocument("test","b",{value:2});return 2;});
    await expect(Promise.all([a,b])).resolves.toEqual([1,2]);
    expect(repo.businessDocuments.get("test/a")?.value).toBe(1);
    expect(repo.businessDocuments.get("test/b")?.value).toBe(2);
  });
});
