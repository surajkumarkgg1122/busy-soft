import type { Account, LedgerEntry, Money, StockMovement, Voucher } from "./types";
import { ValidationError } from "./errors";
import { buildProfitLoss, buildBalanceSheet, buildTrialBalance, buildPartyStatement } from "./reports";
import { buildPartyReconciliation } from "./party";
import { balanceFor, buildStockLedger } from "./stock";
import { reconcileGstLedger, type GstLedgerAccountMap } from "./taxReporting";

export interface ReportPeriod { fromDate?:string; toDate?:string; }
export interface RegisterRow { voucherId:string; voucherNumber:string; date:string; voucherType:string; narration?:string; totalDebit:Money; totalCredit:Money; status:Voucher["status"]; }
export interface CashFlow { operating:Money; investing:Money; financing:Money; netChange:Money; }
export interface ReportReconciliation { balanced:boolean; discrepancies:string[]; }

function validPeriod(p:ReportPeriod){ if(p.fromDate&&p.toDate&&p.fromDate>p.toDate) throw new ValidationError("Report fromDate cannot be after toDate."); }
function inPeriod(date:string,p:ReportPeriod){return(!p.fromDate||date>=p.fromDate)&&(!p.toDate||date<=p.toDate);}
function register(vouchers:readonly Voucher[],p:ReportPeriod,types?:string[]):RegisterRow[]{validPeriod(p);const allowed=types?new Set(types):undefined;return vouchers.filter(v=>(v.status==="posted"||v.status==="cancelled")&&inPeriod(v.date,p)&&(!allowed||allowed.has(v.voucherType))).sort((a,b)=>a.date.localeCompare(b.date)||a.voucherNumber.localeCompare(b.voucherNumber)).map(v=>({voucherId:v.id,voucherNumber:v.voucherNumber,date:v.date,voucherType:v.voucherType,narration:v.narration,totalDebit:v.totalDebit,totalCredit:v.totalCredit,status:v.status}));}

export function buildDayBook(vouchers:readonly Voucher[],period:ReportPeriod={}):RegisterRow[]{return register(vouchers,period);}
export function buildJournalRegister(vouchers:readonly Voucher[],period:ReportPeriod={}):RegisterRow[]{return register(vouchers,period,["JOURNAL","journal"]);}
export function buildSalesRegister(vouchers:readonly Voucher[],period:ReportPeriod={}):RegisterRow[]{return register(vouchers,period,["SALE","SALES"]);}
export function buildPurchaseRegister(vouchers:readonly Voucher[],period:ReportPeriod={}):RegisterRow[]{return register(vouchers,period,["PURCHASE","PURCHASE_BILL"]);}
export function buildReturnRegister(vouchers:readonly Voucher[],period:ReportPeriod={}):RegisterRow[]{return register(vouchers,period,["SALE_RETURN","PURCHASE_RETURN","SALE_RETURN_REVERSAL","PURCHASE_RETURN_REVERSAL"]);}

export function buildLedger(entries:readonly LedgerEntry[],accountId:string,period:ReportPeriod={}){validPeriod(period);return entries.filter(e=>e.accountId===accountId&&inPeriod(e.date,period)).sort((a,b)=>a.date.localeCompare(b.date)||a.lineNo-b.lineNo||a.voucherId.localeCompare(b.voucherId));}
export function buildCashBook(entries:readonly LedgerEntry[],cashAccountIds:readonly string[],period:ReportPeriod={}){validPeriod(period);const ids=new Set(cashAccountIds);return entries.filter(e=>ids.has(e.accountId)&&inPeriod(e.date,period)).sort((a,b)=>a.date.localeCompare(b.date)||a.lineNo-b.lineNo||a.voucherId.localeCompare(b.voucherId));}
export function buildBankBook(entries:readonly LedgerEntry[],bankAccountIds:readonly string[],period:ReportPeriod={}){return buildCashBook(entries,bankAccountIds,period);}

/** Cash flow is ledger-derived. Classification is intentionally conservative; production should use configured cash-flow categories rather than guessing from account names. */
export function buildCashFlow(accounts:readonly Account[],entries:readonly LedgerEntry[],period:ReportPeriod={}):CashFlow{
  validPeriod(period);const accountById=new Map(accounts.map(a=>[a.id,a]));let operating=0,investing=0,financing=0;
  for(const e of entries.filter(x=>inPeriod(x.date,period))){const account=accountById.get(e.accountId);if(!account||account.type!=="asset")continue;const delta=e.debit-e.credit;const counterpart=entries.filter(x=>x.voucherId===e.voucherId&&x.lineNo!==e.lineNo);const types=new Set(counterpart.map(x=>accountById.get(x.accountId)?.type));if(types.has("equity")||types.has("liability"))financing+=delta;else if(types.has("asset"))investing+=delta;else operating+=delta;}
  return{operating,investing,financing,netChange:operating+investing+financing};
}

export function reconcileReports(input:{accounts:readonly Account[];entries:readonly LedgerEntry[];stockMovements?:readonly StockMovement[];period?:ReportPeriod;party?:{partyId:string;role:"customer"|"supplier";allocations:Parameters<typeof buildPartyReconciliation>[1]};gstAccounts?:GstLedgerAccountMap}):ReportReconciliation{
  const p=input.period??{};const discrepancies:string[]=[];const tb=buildTrialBalance(input.accounts,input.entries,p);const pl=buildProfitLoss(input.accounts,input.entries,p);const bs=buildBalanceSheet(input.accounts,input.entries,p);
  if(!tb.balanced)discrepancies.push(`Trial Balance difference ${tb.difference}`);if(!bs.balanced)discrepancies.push(`Balance Sheet difference ${bs.difference}`);if(pl.profit!==pl.income-pl.contraRevenue-pl.expense)discrepancies.push("Profit & Loss arithmetic mismatch");
  if(input.party){const r=buildPartyReconciliation(input.entries,input.party.allocations,input.party.partyId,input.party.role);if(!r.reconciled)discrepancies.push(`Party ${input.party.partyId} ledger/outstanding mismatch`);}
  if(input.gstAccounts){const tax=reconcileGstLedger(input.entries,input.gstAccounts);if(tax.output.total<0||tax.input.total<0)discrepancies.push("GST ledger has an invalid negative tax balance for a configured account direction");}
  if(input.stockMovements){const byScope=new Map<string,StockMovement[]>();for(const m of input.stockMovements){const key=`${m.businessId}|${m.financialYearId}|${m.itemId}|${m.warehouseId??"default"}`;(byScope.get(key)??byScope.set(key,[]).get(key)!).push(m);}for(const [key,movements] of byScope){const [businessId,financialYearId,itemId,warehouseId]=key.split("|");const balance=balanceFor(movements,{businessId,financialYearId,itemId,warehouseId},p.toDate);const ledger=buildStockLedger(movements,{businessId,financialYearId,itemId,warehouseId},p.toDate);const last=ledger[ledger.length-1];if(last&&(last.runningQuantity!==balance.quantity||last.runningValue!==balance.value))discrepancies.push(`Stock summary/ledger mismatch for ${itemId} in ${warehouseId}`);}}
  return{balanced:discrepancies.length===0,discrepancies};
}

export function reconcileStockSummary(movements:readonly StockMovement[],scope:{businessId:string;financialYearId:string;itemId:string;warehouseId?:string},asOf?:string){const balance=balanceFor(movements,scope,asOf);const ledger=buildStockLedger(movements,scope,asOf);const last=ledger[ledger.length-1];return{balance,ledger,reconciled:!last||(last.runningQuantity===balance.quantity&&last.runningValue===balance.value)};}

export { buildProfitLoss, buildBalanceSheet, buildTrialBalance, buildPartyStatement, reconcileGstLedger };
