import type { Account, LedgerEntry, Money } from "./types";
import { ValidationError } from "./errors";

export interface GstLedgerAccountMap { outputCgst?:string; outputSgst?:string; outputIgst?:string; outputCess?:string; inputCgst?:string; inputSgst?:string; inputIgst?:string; inputCess?:string; }
export interface GstReconciliation { output:{cgst:Money;sgst:Money;igst:Money;cess:Money;total:Money}; input:{cgst:Money;sgst:Money;igst:Money;cess:Money;total:Money}; netPayable:Money; netCredit:Money; }

function amount(entries:readonly LedgerEntry[],accountId:string|undefined):Money{if(!accountId)return 0;const value=entries.filter(e=>e.accountId===accountId).reduce((sum,e)=>sum+e.credit-e.debit,0);if(!Number.isSafeInteger(value))throw new ValidationError("GST ledger amount exceeds safe integer range.");return value;}
function taxSet(entries:readonly LedgerEntry[],map:GstLedgerAccountMap,prefix:"output"|"input"){
  const cgst=amount(entries,map[`${prefix}Cgst` as keyof GstLedgerAccountMap]);
  const sgst=amount(entries,map[`${prefix}Sgst` as keyof GstLedgerAccountMap]);
  const igst=amount(entries,map[`${prefix}Igst` as keyof GstLedgerAccountMap]);
  const cess=amount(entries,map[`${prefix}Cess` as keyof GstLedgerAccountMap]);
  return {cgst,sgst,igst,cess,total:cgst+sgst+igst+cess};
}

/** GST reporting reads posted ledger entries; it never recalculates invoice tax. */
export function reconcileGstLedger(entries:readonly LedgerEntry[],accounts:GstLedgerAccountMap):GstReconciliation{
  const output=taxSet(entries,accounts,"output");
  const input=taxSet(entries,accounts,"input");
  const net=output.total-input.total;
  return {output,input,netPayable:Math.max(net,0),netCredit:Math.max(-net,0)};
}

/** Optional guard for configured tax accounts. */
export function assertGstAccountsExist(accounts:readonly Account[],map:GstLedgerAccountMap):void{
  const ids=[map.outputCgst,map.outputSgst,map.outputIgst,map.outputCess,map.inputCgst,map.inputSgst,map.inputIgst,map.inputCess].filter((x):x is string=>Boolean(x));
  const known=new Set(accounts.map(a=>a.id));
  for(const id of ids)if(!known.has(id))throw new ValidationError(`Configured GST account ${id} does not exist.`);
}
