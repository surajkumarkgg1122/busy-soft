import { assertBalanced, validateVoucherLines } from "./ledger";
import { calculateTax } from "./gst";
import { valueFifo, valueWeightedAverage } from "./valuation";
import { allocateAgainstOutstanding } from "./party";

export function runAccountingInvariantTests(): { passed: number; failed: number } {
  let passed=0, failed=0;
  const test=(fn:()=>void)=>{try{fn();passed++;}catch{failed++;}};
  test(()=>assertBalanced([{debit:1000,credit:0},{debit:0,credit:1000}]));
  test(()=>{try{assertBalanced([{debit:1000,credit:0},{debit:0,credit:900}]);throw new Error("expected failure");}catch(e){if(e instanceof Error&&e.message==="expected failure")throw e;}});
  test(()=>validateVoucherLines([{lineId:"1",voucherId:"v",businessId:"b",lineNo:1,accountId:"a",debit:11800,credit:0},{lineId:"2",voucherId:"v",businessId:"b",lineNo:2,accountId:"s",debit:0,credit:10000},{lineId:"3",voucherId:"v",businessId:"b",lineNo:3,accountId:"g",debit:0,credit:1800}]));
  test(()=>{const t=calculateTax({taxableValue:10000,rate:18,intraState:true});if(t.cgst!==900||t.sgst!==900||t.total!==11800)throw new Error("GST");});
  test(()=>{const r=allocateAgainstOutstanding(7000,[{voucherId:"a",voucherNumber:"1",date:"2026-04-01",original:5000,allocated:0,outstanding:5000},{voucherId:"b",voucherNumber:"2",date:"2026-04-02",original:10000,allocated:0,outstanding:10000}]);if(r.allocations[0].amount!==5000||r.allocations[1].amount!==2000||r.unallocated!==0)throw new Error("allocation");});
  test(()=>{const r=valueFifo([{id:"1",businessId:"b",financialYearId:"fy",date:"2026-04-01",itemId:"i",direction:"in",quantity:10,unitCost:500,value:5000,sourceType:"purchase",sourceId:"p",createdBy:"u",createdAt:"x"},{id:"2",businessId:"b",financialYearId:"fy",date:"2026-04-02",itemId:"i",direction:"in",quantity:10,unitCost:600,value:6000,sourceType:"purchase",sourceId:"p2",createdBy:"u",createdAt:"x"},{id:"3",businessId:"b",financialYearId:"fy",date:"2026-04-03",itemId:"i",direction:"out",quantity:12,unitCost:0,value:0,sourceType:"sale",sourceId:"s",createdBy:"u",createdAt:"x"}]);if(r.quantity!==8||r.value!==4800)throw new Error("FIFO");});
  test(()=>{const r=valueWeightedAverage([{id:"1",businessId:"b",financialYearId:"fy",date:"2026-04-01",itemId:"i",direction:"in",quantity:10,unitCost:500,value:5000,sourceType:"purchase",sourceId:"p",createdBy:"u",createdAt:"x"},{id:"2",businessId:"b",financialYearId:"fy",date:"2026-04-02",itemId:"i",direction:"in",quantity:10,unitCost:600,value:6000,sourceType:"purchase",sourceId:"p2",createdBy:"u",createdAt:"x"},{id:"3",businessId:"b",financialYearId:"fy",date:"2026-04-03",itemId:"i",direction:"out",quantity:12,unitCost:0,value:0,sourceType:"sale",sourceId:"s",createdBy:"u",createdAt:"x"}]);if(r.quantity!==8||r.value!==4800)throw new Error("WAC");});
  return {passed,failed};
}
