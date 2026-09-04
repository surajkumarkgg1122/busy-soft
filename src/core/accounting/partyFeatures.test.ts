import { describe, expect, it } from "vitest";
import { addCreditDays, calculateBillWiseOutstanding, findPotentialDuplicates, summarizeAgeing, validatePartyFeatureProfile, validatePaymentTerms } from "./partyFeatures";

describe("party features", () => {
  it("calculates due dates from payment terms", () => { expect(addCreditDays("2026-01-31",30)).toBe("2026-03-02"); });
  it("rejects invalid payment terms", () => {
    expect(() => validatePaymentTerms({id:"t",name:"",creditDays:10,active:true})).toThrow();
    expect(() => validatePaymentTerms({id:"t",name:"Net 30",creditDays:31,earlyPaymentDiscountPercent:5,earlyPaymentDiscountDays:40,active:true})).toThrow();
  });
  it("requires a single default address and primary contact", () => {
    const base={id:"a",label:"Billing",type:"billing" as const,line1:"1 Main",city:"Patna",state:"Bihar",pincode:"800001",country:"India",isDefault:false};
    expect(() => validatePartyFeatureProfile({addresses:[base],contacts:[]})).toThrow();
    expect(() => validatePartyFeatureProfile({addresses:[{...base,isDefault:true}],contacts:[{id:"c1",name:"A",isPrimary:true,active:true},{id:"c2",name:"B",isPrimary:true,active:true}]})).toThrow();
  });
  it("calculates bill-wise outstanding and ageing buckets", () => {
    const bills=calculateBillWiseOutstanding([
      {voucherId:"v1",voucherNumber:"S-1",partyId:"p",date:"2026-01-01",dueDate:"2026-02-01",originalAmount:10000,allocatedAmount:2000,kind:"invoice"},
      {voucherId:"v2",voucherNumber:"S-2",partyId:"p",date:"2026-03-01",dueDate:"2026-03-31",originalAmount:5000,allocatedAmount:0,kind:"invoice"}
    ],"2026-03-15");
    expect(bills).toHaveLength(1); expect(bills[0].outstanding).toBe(8000); expect(bills[0].invoiceAgeDays).toBe(73); expect(bills[0].overdueDays).toBe(42); expect(bills[0].bucket).toBe("31-60"); expect(summarizeAgeing(bills,"2026-03-15").total).toBe(8000);
  });
  it("never flags a duplicate without a meaningful matching field", () => {
    expect(findPotentialDuplicates({name:"New Party"},[{id:"p1",name:"Other Party"}])).toEqual([]);
    expect(findPotentialDuplicates({name:"ACME",gstin:"10ABCDE1234F1Z5"},[{id:"p1",name:"ACME Industries",gstin:"10ABCDE1234F1Z5"}])[0].score).toBe(100);
  });
});
