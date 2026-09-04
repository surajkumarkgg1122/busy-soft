import { describe, expect, it } from "vitest";
import { reconcileGstLedger } from "../taxReporting";
import type { LedgerEntry } from "../types";

const entry=(accountId:string,debit:number,credit:number):LedgerEntry=>({lineId:`l-${accountId}-${debit}-${credit}`,voucherId:"v1",businessId:"b1",financialYearId:"fy1",lineNo:1,accountId,debit,credit,date:"2026-09-04",voucherType:"TEST",voucherNumber:"T-1",createdAt:"2026-09-04T00:00:00.000Z"});

describe("GST ledger reconciliation",()=>{
  it("reconciles output and input GST from posted ledger values without recalculating invoices",()=>{
    const r=reconcileGstLedger([
      entry("out-cgst",0,900),entry("out-sgst",0,900),entry("out-cess",0,100),
      entry("in-cgst",450,0),entry("in-sgst",450,0),entry("in-cess",50,0),
    ],{outputCgst:"out-cgst",outputSgst:"out-sgst",outputCess:"out-cess",inputCgst:"in-cgst",inputSgst:"in-sgst",inputCess:"in-cess"});
    expect(r.output.total).toBe(1900); expect(r.input.total).toBe(950); expect(r.netPayable).toBe(950); expect(r.netCredit).toBe(0);
  });
  it("does not manufacture tax from missing accounts",()=>{
    const r=reconcileGstLedger([entry("other",0,1000)],{});
    expect(r.output.total).toBe(0); expect(r.input.total).toBe(0); expect(r.netPayable).toBe(0);
  });
});
