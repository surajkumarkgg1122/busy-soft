import type { AccountingRepository, AccountingTransaction, LedgerEntry, Money, PartyAllocation } from "./types";
import { ValidationError } from "./errors";

export type PartyRole = "customer" | "supplier";
export interface OutstandingDocument { voucherId:string; voucherNumber:string; date:string; dueDate?:string; original:Money; allocated:Money; outstanding:Money; }
export interface PartyReconciliation { partyId:string; ledgerDebit:Money; ledgerCredit:Money; ledgerNet:Money; allocated:Money; billOutstanding:Money; advance:Money; reconciled:boolean; }

function safeMoney(value:Money,name:string):Money { if(!Number.isSafeInteger(value)||value<0) throw new ValidationError(`${name} must be a non-negative integer minor-unit amount.`); return value; }
export function validateAllocation(input:Omit<PartyAllocation,"id">):void {
  if(!input.businessId||!input.partyId||!input.fromVoucherId||!input.toVoucherId||input.fromVoucherId===input.toVoucherId) throw new ValidationError("Invalid party allocation references.");
  safeMoney(input.amount,"Allocation amount"); if(input.amount<=0) throw new ValidationError("Allocation amount must be positive.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError("Allocation date must be YYYY-MM-DD.");
  if(!input.userId) throw new ValidationError("Allocation creator is required.");
  if(!input.idempotencyKey) throw new ValidationError("Allocation idempotency key is required.");
}
export function calculatePartyNet(entries:readonly Pick<LedgerEntry,"partyId"|"debit"|"credit">[],partyId:string):Money { return entries.filter(e=>e.partyId===partyId).reduce((s,e)=>s+e.debit-e.credit,0); }
export function calculatePartyLedger(entries:readonly LedgerEntry[],partyId:string){const own=entries.filter(e=>e.partyId===partyId);return{debit:own.reduce((s,e)=>s+e.debit,0),credit:own.reduce((s,e)=>s+e.credit,0),net:calculatePartyNet(entries,partyId)};}
export function allocateAgainstOutstanding(requested:Money,documents:readonly OutstandingDocument[]){safeMoney(requested,"Requested allocation");let remaining=requested;const allocations:Array<{voucherId:string;amount:Money}>=[];for(const d of documents){safeMoney(d.outstanding,`Outstanding amount for ${d.voucherNumber}`);if(remaining<=0)break;if(d.outstanding<=0)continue;const amount=Math.min(remaining,d.outstanding);allocations.push({voucherId:d.voucherId,amount});remaining-=amount;}return{allocations,unallocated:remaining};}

export async function validateAndBuildAllocations(tx:AccountingTransaction,input:{businessId:string;partyId:string;fromVoucherId:string;toVoucherId:string;amount:Money;date:string;userId:string;id:string;createdAt:string;idempotencyKey:string}):Promise<PartyAllocation>{
  validateAllocation(input); const from=await tx.getVoucher(input.fromVoucherId),to=await tx.getVoucher(input.toVoucherId);
  if(!from||!to) throw new ValidationError("Both allocation vouchers must exist.");
  const fy=await tx.getFinancialYear(from.financialYearId); if(!fy||fy.businessId!==input.businessId||fy.locked) throw new ValidationError("Allocation financial year is unavailable or locked.");
  if(from.businessId!==input.businessId||to.businessId!==input.businessId) throw new ValidationError("Allocation voucher business mismatch.");
  if(from.status!=="posted"||to.status!=="posted") throw new ValidationError("Only posted vouchers can be allocated.");
  if(from.financialYearId!==to.financialYearId) throw new ValidationError("Allocation vouchers must belong to the same financial year.");
  if(input.date<fy.startDate||input.date>fy.endDate) throw new ValidationError("Allocation date is outside the financial year.");
  const partyRaw=await tx.getBusinessDocument("parties",input.partyId); if(!partyRaw) throw new ValidationError("Party not found.");
  if(String(partyRaw.businessId||"")!==input.businessId) throw new ValidationError("Party business mismatch.");
  if(String(partyRaw.status||"active")==="inactive") throw new ValidationError("Inactive party cannot receive new allocations.");
  const fromLines=await tx.getVoucherLines(from.id),toLines=await tx.getVoucherLines(to.id);
  const fromParty=fromLines.filter(l=>l.partyId===input.partyId).reduce((s,l)=>s+l.debit-l.credit,0),toParty=toLines.filter(l=>l.partyId===input.partyId).reduce((s,l)=>s+l.debit-l.credit,0);
  if(fromParty===0||toParty===0||Math.sign(fromParty)===Math.sign(toParty)) throw new ValidationError("Allocation requires opposite outstanding party directions.");
  const sourceUsed=(await tx.getPartyAllocationsForVoucher(from.id)).filter(a=>a.partyId===input.partyId).reduce((s,a)=>s+a.amount,0),targetUsed=(await tx.getPartyAllocationsForVoucher(to.id)).filter(a=>a.partyId===input.partyId).reduce((s,a)=>s+a.amount,0);
  if(sourceUsed+input.amount>Math.abs(fromParty)) throw new ValidationError("Allocation exceeds the source voucher outstanding amount.");
  if(targetUsed+input.amount>Math.abs(toParty)) throw new ValidationError("Allocation exceeds the target voucher outstanding amount.");
  return{id:input.id,businessId:input.businessId,partyId:input.partyId,fromVoucherId:input.fromVoucherId,toVoucherId:input.toVoucherId,amount:input.amount,date:input.date,createdBy:input.userId,createdAt:input.createdAt,idempotencyKey:input.idempotencyKey};
}

export function buildPartyReconciliation(entries:readonly LedgerEntry[],allocations:readonly PartyAllocation[],partyId:string,role:PartyRole):PartyReconciliation{
  const own=entries.filter(e=>e.partyId===partyId); const ledgerDebit=own.reduce((s,e)=>s+e.debit,0),ledgerCredit=own.reduce((s,e)=>s+e.credit,0),ledgerNet=ledgerDebit-ledgerCredit;
  const byVoucher=new Map<string,number>(); for(const a of allocations.filter(a=>a.partyId===partyId)){byVoucher.set(a.fromVoucherId,(byVoucher.get(a.fromVoucherId)||0)+a.amount);byVoucher.set(a.toVoucherId,(byVoucher.get(a.toVoucherId)||0)+a.amount);}
  const voucherNet=new Map<string,number>(); for(const e of own)voucherNet.set(e.voucherId,(voucherNet.get(e.voucherId)||0)+e.debit-e.credit);
  let billOutstanding=0,advance=0,allocated=0; for(const [voucherId,net] of voucherNet){const used=byVoucher.get(voucherId)||0; allocated+=used; const remaining=Math.max(Math.abs(net)-used,0); const receivableDirection=role==="customer"?net>0:net<0; if(receivableDirection)billOutstanding+=remaining;else advance+=remaining;}
  const expectedNet=role==="customer"?billOutstanding+allocated/2-advance:advance-billOutstanding-allocated/2;
  return{partyId,ledgerDebit,ledgerCredit,ledgerNet,allocated:allocated/2,billOutstanding,advance,reconciled:expectedNet===ledgerNet};
}

export async function postPartyAllocation(repo:AccountingRepository,input:{businessId:string;partyId:string;fromVoucherId:string;toVoucherId:string;amount:Money;date:string;userId:string;idempotencyKey:string},deps:{ids:{next(prefix:string):string};clock:{now():string}}):Promise<PartyAllocation>{
  if(!input.idempotencyKey) throw new ValidationError("Allocation idempotency key is required.");
  return repo.runInTransaction(async tx=>{
    const from=await tx.getVoucher(input.fromVoucherId); if(!from) throw new ValidationError("Source voucher not found.");
    const existing=await tx.getAtomicDocumentByIdempotencyKey(input.businessId,from.financialYearId,input.idempotencyKey);
    if(existing){
      if(existing.type!=="party_allocation") throw new ValidationError("Idempotency key is already used by another accounting document.");
      const payload=existing.payload||{}; if(String(payload.partyId||"")!==input.partyId||String(payload.toVoucherId||"")!==input.toVoucherId||Number(payload.amount)!==input.amount||String(existing.date)!==input.date) throw new ValidationError("Allocation idempotency key was already used with a different payload.");
      const allocationId=String(payload.allocationId||""); const saved=allocationId?await tx.getBusinessDocument("partyAllocations",allocationId):null; if(!saved) throw new ValidationError("Existing allocation record is incomplete."); return saved as unknown as PartyAllocation;
    }
    const allocation=await validateAndBuildAllocations(tx,{...input,id:deps.ids.next("alloc"),createdAt:deps.clock.now()});
    await tx.savePartyAllocations([allocation]);
    await tx.saveAtomicDocument({id:deps.ids.next("acctdoc"),businessId:input.businessId,financialYearId:from.financialYearId,type:"party_allocation",voucherId:input.fromVoucherId,idempotencyKey:input.idempotencyKey,status:"posted",date:input.date,createdBy:input.userId,createdAt:deps.clock.now(),payload:{kind:"partyAllocation",allocationId:allocation.id,partyId:input.partyId,toVoucherId:input.toVoucherId,amount:input.amount}});
    await tx.saveAuditEvent({id:deps.ids.next("audit"),businessId:input.businessId,entityType:"partyAllocation",entityId:allocation.id,action:"ALLOCATED",userId:input.userId,timestamp:deps.clock.now(),after:allocation as unknown as Record<string,unknown>});
    return allocation;
  });
}
