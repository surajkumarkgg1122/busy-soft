import type { AccountingRepository, Money, PostingResult, VoucherLineInput, PartyAllocation } from "./types";
import { postIdempotentVoucher } from "./atomic";
import { ValidationError } from "./errors";
import { assertMoney } from "./money";
import type { TransactionDeps } from "./transactions";

export interface SettlementAccounts { party:string; cash:string; bank:string; }
export interface SettlementInput {
  businessId:string; financialYearId:string; date:string; userId:string; partyId:string;
  amount:Money; mode:"cash"|"bank"; accountMap:SettlementAccounts;
  idempotencyKey:string; narration?:string;
}
export interface ReceiptAllocationInput { fromVoucherId:string; amount:Money; }
const debit=(accountId:string,amount:Money,partyId?:string):VoucherLineInput=>({accountId,debit:amount,credit:0,...(partyId?{partyId}: {})});
const credit=(accountId:string,amount:Money,partyId?:string):VoucherLineInput=>({accountId,debit:0,credit:amount,...(partyId?{partyId}: {})});
function validate(input:SettlementInput){if(!input.businessId||!input.financialYearId||!input.userId||!input.partyId)throw new ValidationError("Settlement business, financial year, user and party are required.");if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Settlement date must be YYYY-MM-DD.");if(!input.idempotencyKey)throw new ValidationError("Settlement idempotency key is required.");assertMoney(input.amount,"Settlement amount");if(input.amount<=0)throw new ValidationError("Settlement amount must be positive.");}
export async function postReceiptIdempotent(repo:AccountingRepository,input:SettlementInput,deps:TransactionDeps):Promise<PostingResult>{validate(input);return repo.runInTransaction(tx=>postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"RECEIPT",prefix:"RC",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"receipt",referenceId:input.partyId,lines:[debit(input.mode==="cash"?input.accountMap.cash:input.accountMap.bank,input.amount),credit(input.accountMap.party,input.amount,input.partyId)],idempotencyKey:input.idempotencyKey},deps));}
export async function postPaymentIdempotent(repo:AccountingRepository,input:SettlementInput,deps:TransactionDeps):Promise<PostingResult>{validate(input);return repo.runInTransaction(tx=>postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"PAYMENT",prefix:"PY",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"payment",referenceId:input.partyId,lines:[debit(input.accountMap.party,input.amount,input.partyId),credit(input.mode==="cash"?input.accountMap.cash:input.accountMap.bank,input.amount)],idempotencyKey:input.idempotencyKey},deps));}

export async function postReceiptWithAllocations(repo:AccountingRepository,input:SettlementInput,allocations:ReceiptAllocationInput[],deps:TransactionDeps):Promise<PostingResult>{
  validate(input);
  for(const allocation of allocations){if(!allocation.fromVoucherId)throw new ValidationError("Bill voucher is required for an allocation.");if(!Number.isSafeInteger(allocation.amount)||allocation.amount<=0)throw new ValidationError("Bill allocation must be a positive minor-unit amount.");}
  const allocationTotal=allocations.reduce((sum,a)=>sum+a.amount,0);
  if(allocationTotal>input.amount)throw new ValidationError("Bill allocations cannot exceed the amount received.");
  const unique=new Set<string>();
  if(unique.size!==allocations.length)throw new ValidationError("A bill cannot be allocated more than once in the same receipt.");
  return repo.runInTransaction(async tx=>{
    const existing=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);
    if(existing)throw new ValidationError("A receipt with this idempotency key is already posted.");
    const voucherResult=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"RECEIPT",prefix:"RC",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"receipt",referenceId:input.partyId,lines:[debit(input.mode==="cash"?input.accountMap.cash:input.accountMap.bank,input.amount),credit(input.accountMap.party,input.amount,input.partyId)],idempotencyKey:input.idempotencyKey},deps);
    const now=deps.clock.now();
    for(const allocation of allocations){
      const bill=await tx.getVoucher(allocation.fromVoucherId);if(!bill||bill.status!=="posted"||bill.voucherType!=="SALE")throw new ValidationError(`Selected bill ${allocation.fromVoucherId} is not a posted sales invoice.`);
      const billLines=await tx.getVoucherLines(bill.id);const partyLine=billLines.find(line=>line.partyId===input.partyId&&line.debit>0);if(!partyLine)throw new ValidationError(`Selected bill ${bill.voucherNumber} does not belong to this customer or has no receivable balance.`);
      const prior=await tx.getPartyAllocationsForVoucher(bill.id);const allocated=prior.filter(a=>a.fromVoucherId===bill.id).reduce((sum,a)=>sum+a.amount,0);const outstanding=partyLine.debit-allocated;
      if(allocation.amount>outstanding)throw new ValidationError(`Allocation for ${bill.voucherNumber} exceeds its outstanding balance.`);
      const record:PartyAllocation={id:deps.ids.next("allocation"),businessId:input.businessId,partyId:input.partyId,fromVoucherId:bill.id,toVoucherId:voucherResult.voucher.id,amount:allocation.amount,date:input.date,createdBy:input.userId,createdAt:now,idempotencyKey:`${input.idempotencyKey}-${bill.id}`};
      await tx.savePartyAllocations([record]);
    }
    return voucherResult;
  });
}
