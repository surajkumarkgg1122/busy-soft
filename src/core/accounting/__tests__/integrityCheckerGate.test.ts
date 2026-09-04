import { describe, expect, it } from "vitest";
import { runIntegrityCheck } from "../integrityChecker";
import type { Account, LedgerEntry, Voucher } from "../types";

const account=(id:string):Account=>({id,businessId:"biz-qa",code:id,name:id,type:"asset",parentId:null,systemAccount:true,active:true,openingDebit:0,openingCredit:0,createdAt:"2026-08-30T00:00:00.000Z",updatedAt:"2026-08-30T00:00:00.000Z"});
const voucher:Voucher={id:"v1",businessId:"biz-qa",financialYearId:"fy-2026-27",voucherType:"JOURNAL",voucherNumber:"JV-000001",date:"2026-08-30",status:"posted",createdBy:"u1",createdAt:"2026-08-30T00:00:00.000Z",updatedAt:"2026-08-30T00:00:00.000Z",totalDebit:1000,totalCredit:1000};
const entry=(id:string,debit:number,credit:number):LedgerEntry=>({lineId:id,id,voucherId:"v1",businessId:"biz-qa",financialYearId:"fy-2026-27",accountId:"cash",lineNo:1,debit,credit,date:"2026-08-30",voucherType:"JOURNAL",voucherNumber:"JV-000001",createdAt:"2026-08-30T00:00:00.000Z"});

describe("ERP integrity release gate",()=>{
 it("passes a clean authoritative snapshot",()=>{const r=runIntegrityCheck({businessId:"biz-qa",financialYearId:"fy-2026-27",checkedAt:"2026-08-30T12:00:00.000Z",accounts:[account("cash")],entries:[],vouchers:[]});expect(r.status).toBe("PASS");expect(r.summary.critical).toBe(0);expect(r.summary.error).toBe(0);});
 it("fails critically when accounting voucher and ledger do not reconcile",()=>{const r=runIntegrityCheck({businessId:"biz-qa",financialYearId:"fy-2026-27",checkedAt:"2026-08-30T12:00:00.000Z",accounts:[account("cash")],entries:[entry("e1",900,0)],vouchers:[voucher]});expect(r.status).toBe("CRITICAL");expect(r.summary.critical).toBeGreaterThan(0);});
 it("detects cross-business documents instead of silently ignoring them",()=>{const r=runIntegrityCheck({businessId:"biz-qa",financialYearId:"fy-2026-27",checkedAt:"2026-08-30T12:00:00.000Z",accounts:[account("cash")],entries:[],vouchers:[],documents:[{id:"doc-1",type:"sale",businessId:"biz-other",financialYearId:"fy-2026-27",voucherId:"missing"}]});expect(r.status).toBe("CRITICAL");expect(r.findings.some(f=>f.category==="SECURITY"&&f.severity==="CRITICAL")).toBe(true);});
});
