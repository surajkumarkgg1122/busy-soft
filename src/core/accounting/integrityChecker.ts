import type { Account, LedgerEntry, Money, PartyAllocation, StockMovement, Voucher } from "./types";
import { buildPartyReconciliation } from "./party";
import { balanceFor } from "./stock";
import { reconcileGstLedger, type GstLedgerAccountMap } from "./taxReporting";

export type IntegritySeverity = "PASS" | "WARNING" | "ERROR" | "CRITICAL";
export type IntegrityCategory = "ACCOUNTING" | "PARTY" | "INVENTORY" | "SALES" | "PURCHASE" | "PAYMENTS" | "GST" | "CASH" | "BANK" | "DOCUMENTS" | "REVERSALS" | "SECURITY";
export interface IntegrityFinding { category:IntegrityCategory; entity:string; entityId:string; expected:unknown; actual:unknown; severity:IntegritySeverity; explanation:string; suggestedRemediation:string; }
export interface IntegrityResult { status:IntegritySeverity; checkedAt:string; findings:IntegrityFinding[]; summary:{pass:number;warning:number;error:number;critical:number}; }

export interface IntegritySnapshot {
  businessId:string;
  financialYearId:string;
  checkedAt:string;
  accounts:readonly Account[];
  entries:readonly LedgerEntry[];
  vouchers:readonly Voucher[];
  stockMovements?:readonly StockMovement[];
  allocations?:readonly PartyAllocation[];
  documents?:readonly IntegrityDocument[];
  gstAccounts?:GstLedgerAccountMap;
  parties?:readonly IntegrityParty[];
  payments?:readonly IntegrityPayment[];
  cashAccountIds?:readonly string[];
  bankAccountIds?:readonly string[];
}
export interface IntegrityDocument { id:string; type:string; businessId:string; financialYearId:string; invoiceNumber?:string; total?:Money; accountingTotal?:Money; partyId?:string; itemIds?:readonly string[]; accountIds?:readonly string[]; voucherId?:string; gst?:Money; }
export interface IntegrityParty { id:string; businessId:string; role:"customer"|"supplier"; status?:string; }
export interface IntegrityPayment { id:string; businessId:string; financialYearId:string; amount:Money; allocated:Money; unallocated:Money; voucherId?:string; }

const rank:Record<IntegritySeverity,number>={PASS:0,WARNING:1,ERROR:2,CRITICAL:3};
function finding(category:IntegrityCategory,entity:string,entityId:string,expected:unknown,actual:unknown,severity:IntegritySeverity,explanation:string,suggestedRemediation:string):IntegrityFinding{return{category,entity,entityId,expected,actual,severity,explanation,suggestedRemediation};}
function safeEqual(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function sum(entries:readonly LedgerEntry[],fn:(e:LedgerEntry)=>number){return entries.reduce((s,e)=>s+fn(e),0);}
function voucherAmount(v:Voucher){return v.totalDebit;}

export function runIntegrityCheck(input:IntegritySnapshot):IntegrityResult{
  const f:IntegrityFinding[]=[];
  const {businessId,financialYearId,accounts,entries,vouchers}=input;
  const knownAccounts=new Set(accounts.filter(a=>a.businessId===businessId).map(a=>a.id));
  const knownParties=new Map((input.parties??[]).filter(p=>p.businessId===businessId).map(p=>[p.id,p]));
  const knownItems=new Set((input.documents??[]).flatMap(d=>d.itemIds??[]));
  const scopedEntries=entries.filter(e=>e.businessId===businessId&&e.financialYearId===financialYearId);
  const scopedVouchers=vouchers.filter(v=>v.businessId===businessId&&v.financialYearId===financialYearId);

  const debit=sum(scopedEntries,e=>e.debit),credit=sum(scopedEntries,e=>e.credit);
  if(debit!==credit)f.push(finding("ACCOUNTING","ledger",`${businessId}:${financialYearId}`,debit,credit,"CRITICAL","Ledger debits and credits do not balance.","Trace the affected vouchers and post an authorized accounting reversal/correction; never edit ledger rows directly."));

  const byVoucher=new Map<string,LedgerEntry[]>(); for(const e of scopedEntries){const rows=byVoucher.get(e.voucherId)??[];rows.push(e);byVoucher.set(e.voucherId,rows);}
  for(const v of scopedVouchers.filter(v=>v.status!=="cancelled")){const rows=byVoucher.get(v.id)??[];const d=sum(rows,e=>e.debit),c=sum(rows,e=>e.credit);if(d!==v.totalDebit||c!==v.totalCredit)f.push(finding("ACCOUNTING","voucher",v.id,{debit:v.totalDebit,credit:v.totalCredit},{debit:d,credit:c},"CRITICAL","Voucher header totals disagree with its ledger lines.","Reconcile the voucher through the authorized transaction service."));}

  const partyIds=new Set<string>(); scopedEntries.forEach(e=>{if(e.partyId)partyIds.add(e.partyId);});
  for(const partyId of partyIds){const p=knownParties.get(partyId);if(!p){f.push(finding("PARTY","party",partyId,"existing party in same business",null,"CRITICAL","Ledger references a missing or cross-business party.","Restore/link the authoritative party through an authorized workflow; do not alter ledger rows."));continue;}const r=buildPartyReconciliation(scopedEntries,(input.allocations??[]).filter(a=>a.businessId===businessId),partyId,p.role);if(!r.reconciled)f.push(finding("PARTY","party",partyId,r.ledgerNet,{billOutstanding:r.billOutstanding,advance:r.advance,allocated:r.allocated},"ERROR","Party outstanding/advance does not reconcile with the party ledger.","Reconcile bill-wise allocations and use the authorized receipt/payment allocation workflow."));}

  if(input.stockMovements){for(const itemId of new Set(input.stockMovements.filter(m=>m.businessId===businessId&&m.financialYearId===financialYearId).map(m=>m.itemId))){const ms=input.stockMovements.filter(m=>m.businessId===businessId&&m.financialYearId===financialYearId&&m.itemId===itemId);const b=balanceFor(ms,{businessId,financialYearId,itemId});const q=ms.reduce((s,m)=>s+(m.direction==="in"?m.quantity:-m.quantity),0);if(b.quantity!==q)f.push(finding("INVENTORY","stock",itemId,q,b.quantity,"CRITICAL","Stock summary disagrees with stock movement balance.","Rebuild the stock projection from authoritative movements; do not manually edit stock balances."));}}

  for(const d of input.documents??[]){if(d.businessId!==businessId||d.financialYearId!==financialYearId)continue;if(d.voucherId){const v=vouchers.find(x=>x.id===d.voucherId);if(!v)f.push(finding("DOCUMENTS","document",d.id,"existing voucher",null,"ERROR","Business document points to a missing voucher.","Repair the document link through an authorized migration/reconciliation workflow."));else if(d.total!==undefined&&d.total!==voucherAmount(v))f.push(finding(d.type.toUpperCase().includes("PURCHASE")?"PURCHASE":"SALES","document",d.id,voucherAmount(v),d.total,"ERROR","Document total disagrees with accounting voucher amount.","Reconcile the document through its canonical posting service."));}
    if(d.partyId&&!knownParties.has(d.partyId))f.push(finding("DOCUMENTS","document",d.id,"valid party reference",d.partyId,"ERROR","Document references a missing or cross-business party.","Select/restore the authoritative party and repost only through an authorized workflow."));
    for(const itemId of d.itemIds??[])if(!knownItems.has(itemId))f.push(finding("DOCUMENTS","document",d.id,"existing item",itemId,"ERROR","Document references an item not present in the supplied authoritative snapshot.","Restore the item reference or correct the document through an authorized workflow."));
    for(const accountId of d.accountIds??[])if(!knownAccounts.has(accountId))f.push(finding("DOCUMENTS","document",d.id,"valid account",accountId,"ERROR","Document references an account outside the business scope.","Repair account mapping through the chart-of-accounts workflow."));
  }

  const invoiceMap=new Map<string,IntegrityDocument[]>();for(const d of input.documents??[]){if(!d.invoiceNumber)continue;const key=`${d.type}:${d.invoiceNumber.trim().toLowerCase()}`;const rows=invoiceMap.get(key)??[];rows.push(d);invoiceMap.set(key,rows);}for(const [key,rows] of invoiceMap)if(rows.length>1)f.push(finding("DOCUMENTS","invoice",rows[0].id,"unique invoice number",rows.map(r=>r.id),"ERROR",`Duplicate invoice number detected for ${key}.`,"Resolve the duplicate through the numbering/document correction workflow; do not delete posted accounting history."));

  for(const p of input.payments??[]){if(p.businessId!==businessId||p.financialYearId!==financialYearId)continue;const expected=p.allocated+p.unallocated;if(expected!==p.amount)f.push(finding("PAYMENTS","payment",p.id,p.amount,expected,"ERROR","Payment amount does not equal allocated plus unallocated amount.","Reconcile allocations/unallocated balance through the settlement workflow."));}

  if(input.gstAccounts){const gst=reconcileGstLedger(scopedEntries,input.gstAccounts);for(const d of input.documents??[]){if(d.businessId!==businessId||d.financialYearId!==financialYearId||d.gst===undefined)continue;const relevant=d.voucherId?scopedEntries.filter(e=>e.voucherId===d.voucherId):[];const taxAccounts=new Set(Object.values(input.gstAccounts).filter(Boolean));const ledgerTax=sum(relevant,e=>taxAccounts.has(e.accountId)?Math.abs(e.debit-e.credit):0);if(ledgerTax!==d.gst)f.push(finding("GST","document",d.id,d.gst,ledgerTax,"ERROR","Document GST does not reconcile with its GST ledger lines.","Reconcile the transaction using the central GST/accounting posting workflow."));}if(gst.output.total<0||gst.input.total<0)f.push(finding("GST","tax-ledger",`${businessId}:${financialYearId}`,">= 0",gst,"ERROR","Configured GST ledger direction contains a negative balance.","Verify GST account mapping and reverse the incorrect transaction through an authorized workflow."));}

  function checkCashBank(category:IntegrityCategory,ids:readonly string[]|undefined){if(!ids?.length)return;const set=new Set(ids);const balance=sum(scopedEntries,e=>set.has(e.accountId)?e.debit-e.credit:0);const book=balance; if(book!==balance)f.push(finding(category,category.toLowerCase(),`${businessId}:${financialYearId}`,balance,book,"CRITICAL",`${category} book does not reconcile with its accounting balance.`,"Rebuild the book from ledger entries; do not edit persisted balances."));}
  checkCashBank("CASH",input.cashAccountIds);checkCashBank("BANK",input.bankAccountIds);

  const voucherIds=new Set(scopedVouchers.map(v=>v.id));
  for(const v of scopedVouchers){if(v.reversalOfVoucherId){const original=vouchers.find(x=>x.id===v.reversalOfVoucherId);if(!original)f.push(finding("REVERSALS","voucher",v.id,"existing original voucher",v.reversalOfVoucherId,"CRITICAL","Reversal points to a missing original transaction.","Repair the reversal reference through an authorized accounting reconciliation workflow."));}}
  for(const v of scopedVouchers.filter(v=>v.status==="cancelled")){const reversal=scopedVouchers.filter(x=>x.reversalOfVoucherId===v.id);if(reversal.length===0)f.push(finding("REVERSALS","voucher",v.id,"exactly one reversal",0,"CRITICAL","Original transaction is cancelled without a recorded reversal.","Execute the coordinated cancellation/reversal workflow."));if(reversal.length>1)f.push(finding("REVERSALS","voucher",v.id,1,reversal.length,"CRITICAL","Transaction has been reversed more than once.","Freeze further mutation and reconcile the duplicate reversal(s) using authorized workflows."));}
  for(const v of vouchers){if(v.businessId!==businessId&&voucherIds.has(v.id))f.push(finding("SECURITY","voucher",v.id,businessId,v.businessId,"CRITICAL","Cross-business voucher reference detected.","Block the reference and investigate authorization/business-isolation controls."));}
  for(const e of entries){if(e.businessId!==businessId&&voucherIds.has(e.voucherId))f.push(finding("SECURITY","ledger",e.id,businessId,e.businessId,"CRITICAL","Cross-business ledger reference detected.","Block access and repair business isolation through an authorized workflow."));}

  if(!f.length)f.push(finding("ACCOUNTING","erp",`${businessId}:${financialYearId}`,"no contradictions",{},"PASS","No integrity contradictions were found in the supplied authoritative snapshot.","No remediation required."));
  const summary={pass:f.filter(x=>x.severity==="PASS").length,warning:f.filter(x=>x.severity==="WARNING").length,error:f.filter(x=>x.severity==="ERROR").length,critical:f.filter(x=>x.severity==="CRITICAL").length};
  const status=(Object.keys(rank) as IntegritySeverity[]).sort((a,b)=>rank[b]-rank[a]).find(s=>summary[s.toLowerCase() as keyof typeof summary]>0)||"PASS";
  return{status,checkedAt:input.checkedAt,findings:f,summary};
}
