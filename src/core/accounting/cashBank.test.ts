import { describe, expect, it } from "vitest";
import { InMemoryAccountingRepository, fixedClock, testIds } from "./inMemoryRepository";
import { createCashBankAccount, postCashBankEntry, postCashBankTransfer } from "./cashBank";
import { reversePostedVoucher } from "./voucherReversal";

const setup=()=>{
  const repo=new InMemoryAccountingRepository();
  const now=fixedClock("2026-09-01T12:00:00.000Z");
  const ids=testIds("cb");
  const businessId="biz-1",financialYearId="fy-2026-27";
  repo.financialYears.set(financialYearId,{id:financialYearId,businessId,name:"FY 2026-27",startDate:"2026-04-01",endDate:"2027-03-31",locked:false});
  const accounts:[string,string,"asset"|"expense"|"equity",number][]=[
    ["acct-bank","Bank Group","asset",0],
    ["acct-cash","Cash Group","asset",0],
    ["acct-opening-balance","Opening Balance","equity",0],
    ["bank-a","Bank A","asset",100000],
    ["bank-b","Bank B","asset",50000],
    ["cash-a","Cash","asset",25000],
    ["expense","Expense","expense",0],
    ["acct-debtors","Sundry Debtors","asset",0],
    ["acct-creditors","Sundry Creditors","asset",0],
  ];
  for(const [id,name,type,openingDebit] of accounts) repo.accounts.set(id,{id,businessId,code:id,name,type,parentId:null,systemAccount:id.startsWith("acct-"),active:true,openingDebit,openingCredit:0,createdAt:now.now(),updatedAt:now.now()});
  repo.businessDocuments.set("bankAccounts/bank-a",{accountId:"bank-a",businessId,displayName:"Bank A",kind:"bank",ledgerAccountId:"bank-a",status:"active",openingBalance:100000,currentBalance:100000});
  repo.businessDocuments.set("bankAccounts/bank-b",{accountId:"bank-b",businessId,displayName:"Bank B",kind:"bank",ledgerAccountId:"bank-b",status:"active",openingBalance:50000,currentBalance:50000});
  repo.businessDocuments.set("bankAccounts/cash-a",{accountId:"cash-a",businessId,displayName:"Cash",kind:"cash",ledgerAccountId:"cash-a",status:"active",openingBalance:25000,currentBalance:25000});
  repo.businessDocuments.set("parties/CUST-001",{id:"CUST-001",businessId,name:"Customer One",kind:"customer",ledgerAccountId:"acct-debtors"});
  return{repo,now,ids,businessId,financialYearId};
};
const depsFrom=(s:ReturnType<typeof setup>)=>({ids:s.ids,clock:s.now});

describe("cash bank accounting",()=>{
  it("creates the GL account, master record and canonical opening voucher",async()=>{
    const s=setup();
    const result=await createCashBankAccount(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,accountId:"bank-c",displayName:"Bank C",ledgerAccountId:"bank-c",kind:"bank",parentAccountId:"acct-bank",openingBalance:250000,openingBalanceType:"debit",openingBalanceDate:"2026-09-01",createdBy:"u1"},depsFrom(s));
    expect(result.openingVoucherId).toEqual(expect.any(String));
    expect(s.repo.accounts.get("bank-c")).toMatchObject({name:"Bank C",type:"asset",parentId:"acct-bank",openingDebit:0});
    expect(s.repo.businessDocuments.get("bankAccounts/bank-c")).toMatchObject({displayName:"Bank C",kind:"bank",ledgerAccountId:"bank-c",status:"active",openingBalance:250000,openingBalanceType:"debit",openingVoucherId:result.openingVoucherId,currentBalance:250000});
    const opening=await s.repo.getVoucherLines(result.openingVoucherId!);
    expect(opening.find(l=>l.accountId==="bank-c")?.debit).toBe(250000);
    expect(opening.find(l=>l.accountId==="acct-opening-balance")?.credit).toBe(250000);
  });

  it("rejects duplicate account creation",async()=>{
    const s=setup();
    const input={businessId:s.businessId,financialYearId:s.financialYearId,accountId:"bank-a",displayName:"Duplicate",ledgerAccountId:"bank-new",kind:"bank" as const,parentAccountId:"acct-bank",openingBalance:0,openingBalanceType:"debit" as const,openingBalanceDate:"2026-09-01",createdBy:"u1"};
    await expect(createCashBankAccount(s.repo,input,depsFrom(s))).rejects.toThrow(/already exists/i);
  });

  it("posts a party receipt exactly once and keeps the party on the accounting line",async()=>{
    const s=setup();
    const input={businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-idempotency-123",accountId:"bank-a",ledgerAccountId:"bank-a",type:"deposit" as const,amount:10000,contraAccountId:"acct-debtors",partyId:"CUST-001",narration:"Customer receipt"};
    const a=await postCashBankEntry(s.repo,input,depsFrom(s));
    const b=await postCashBankEntry(s.repo,input,depsFrom(s));
    expect(a.voucher.id).toBe(b.voucher.id);
    expect(s.repo.vouchers.size).toBe(1);
    const lines=await s.repo.getVoucherLines(a.voucher.id);
    expect(lines.find(l=>l.accountId==="acct-debtors")?.partyId).toBe("CUST-001");
    expect(lines.find(l=>l.accountId==="bank-a")?.debit).toBe(10000);
    expect(a.ledgerEntries.find(l=>l.accountId==="bank-a")?.financialYearId).toBe(s.financialYearId);
    expect(s.repo.businessDocuments.get("bankAccounts/bank-a")?.currentBalance).toBe(110000);
  });

  it("rejects a party linked to the wrong counter account",async()=>{
    const s=setup();
    await expect(postCashBankEntry(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-party-mismatch",accountId:"bank-a",ledgerAccountId:"bank-a",type:"deposit",amount:1000,contraAccountId:"expense",partyId:"CUST-001"},depsFrom(s))).rejects.toThrow(/counter account/i);
  });

  it("posts withdrawal with the bank credited",async()=>{
    const s=setup();
    const result=await postCashBankEntry(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-withdraw-123456",accountId:"bank-a",ledgerAccountId:"bank-a",type:"withdrawal",amount:7000,contraAccountId:"expense",narration:"Withdrawal"},depsFrom(s));
    const lines=await s.repo.getVoucherLines(result.voucher.id);
    expect(lines.find(l=>l.accountId==="bank-a")?.credit).toBe(7000);
    expect(lines.find(l=>l.accountId==="expense")?.debit).toBe(7000);
    expect(s.repo.businessDocuments.get("bankAccounts/bank-a")?.currentBalance).toBe(93000);
  });

  it("posts an atomic contra transfer between cash bank ledgers and updates both balances",async()=>{
    const s=setup();
    const result=await postCashBankTransfer(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-transfer-123456",fromAccountId:"bank-a",fromLedgerAccountId:"bank-a",toAccountId:"bank-b",toLedgerAccountId:"bank-b",amount:2500},depsFrom(s));
    const lines=await s.repo.getVoucherLines(result.voucher.id);
    expect(lines.find(l=>l.accountId==="bank-a")?.credit).toBe(2500);
    expect(lines.find(l=>l.accountId==="bank-b")?.debit).toBe(2500);
    expect(result.voucher.voucherType).toBe("CONTRA");
    expect(result.ledgerEntries.filter(l=>l.accountId==="bank-a")[0]?.financialYearId).toBe(s.financialYearId);
    expect(result.ledgerEntries.filter(l=>l.accountId==="bank-b")[0]?.financialYearId).toBe(s.financialYearId);
    expect(s.repo.businessDocuments.get("bankAccounts/bank-a")?.currentBalance).toBe(97500);
    expect(s.repo.businessDocuments.get("bankAccounts/bank-b")?.currentBalance).toBe(52500);
  });

  it("preserves account master data after a transfer",async()=>{
    const s=setup();
    await postCashBankTransfer(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-transfer-master-1234",fromAccountId:"bank-a",fromLedgerAccountId:"bank-a",toAccountId:"bank-b",toLedgerAccountId:"bank-b",amount:2500},depsFrom(s));
    expect(s.repo.businessDocuments.get("bankAccounts/bank-a")).toMatchObject({displayName:"Bank A",kind:"bank",ledgerAccountId:"bank-a",status:"active",lastVoucherId:expect.any(String),currentBalance:97500});
    expect(s.repo.businessDocuments.get("bankAccounts/bank-b")).toMatchObject({displayName:"Bank B",kind:"bank",ledgerAccountId:"bank-b",status:"active",lastVoucherId:expect.any(String),currentBalance:52500});
  });

  it("rejects inactive source or destination",async()=>{
    const s=setup();
    s.repo.businessDocuments.set("bankAccounts/bank-b",{...s.repo.businessDocuments.get("bankAccounts/bank-b")!,status:"inactive"});
    await expect(postCashBankTransfer(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-transfer-inactive",fromAccountId:"bank-a",fromLedgerAccountId:"bank-a",toAccountId:"bank-b",toLedgerAccountId:"bank-b",amount:1000},depsFrom(s))).rejects.toThrow(/active/i);
  });

  it("rejects ledger mismatches and same-account transfers",async()=>{
    const s=setup();
    await expect(postCashBankTransfer(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-transfer-mismatch",fromAccountId:"bank-a",fromLedgerAccountId:"wrong-ledger",toAccountId:"bank-b",toLedgerAccountId:"bank-b",amount:1000},depsFrom(s))).rejects.toThrow(/ledger account mismatch/i);
    await expect(postCashBankTransfer(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-transfer-same-account",fromAccountId:"bank-a",fromLedgerAccountId:"bank-a",toAccountId:"bank-a",toLedgerAccountId:"bank-a",amount:1000},depsFrom(s))).rejects.toThrow(/different/i);
  });

  it("reverses a cash/bank voucher without mutating its original posting",async()=>{
    const s=setup();
    const posted=await postCashBankEntry(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,date:"2026-09-01",userId:"u1",idempotencyKey:"cb-reversal-original",accountId:"bank-a",ledgerAccountId:"bank-a",type:"deposit",amount:10000,contraAccountId:"expense",narration:"Deposit"},depsFrom(s));
    const reversal=await reversePostedVoucher(s.repo,{businessId:s.businessId,financialYearId:s.financialYearId,voucherId:posted.voucher.id,userId:"u2",idempotencyKey:"cb-reversal-123456",date:"2026-09-02"},depsFrom(s));
    expect(reversal.voucher.voucherType).toBe("RECEIPT_REVERSAL");
    expect(reversal.ledgerEntries.find(l=>l.accountId==="bank-a")?.financialYearId).toBe(s.financialYearId);
    expect(s.repo.vouchers.get(posted.voucher.id)?.status).toBe("cancelled");
    const reverseLines=await s.repo.getVoucherLines(reversal.voucher.id);
    expect(reverseLines.find(l=>l.accountId==="bank-a")?.credit).toBe(10000);
    expect(reverseLines.find(l=>l.accountId==="expense")?.debit).toBe(10000);
  });
});
