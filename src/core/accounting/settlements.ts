import type { AccountingRepository, Money, PostingResult, VoucherLineInput } from "./types";
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
const debit=(accountId:string,amount:Money,partyId?:string):VoucherLineInput=>({accountId,debit:amount,credit:0,...(partyId?{partyId}: {})});
const credit=(accountId:string,amount:Money,partyId?:string):VoucherLineInput=>({accountId,debit:0,credit:amount,...(partyId?{partyId}: {})});
function validate(input:SettlementInput){if(!input.businessId||!input.financialYearId||!input.userId||!input.partyId)throw new ValidationError("Settlement business, financial year, user and party are required.");if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Settlement date must be YYYY-MM-DD.");if(!input.idempotencyKey)throw new ValidationError("Settlement idempotency key is required.");assertMoney(input.amount,"Settlement amount");if(input.amount<=0)throw new ValidationError("Settlement amount must be positive.");}
export async function postReceiptIdempotent(repo:AccountingRepository,input:SettlementInput,deps:TransactionDeps):Promise<PostingResult>{validate(input);return repo.runInTransaction(tx=>postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"RECEIPT",prefix:"RC",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"receipt",referenceId:input.partyId,lines:[debit(input.mode==="cash"?input.accountMap.cash:input.accountMap.bank,input.amount),credit(input.accountMap.party,input.amount,input.partyId)],idempotencyKey:input.idempotencyKey},deps));}
export async function postPaymentIdempotent(repo:AccountingRepository,input:SettlementInput,deps:TransactionDeps):Promise<PostingResult>{validate(input);return repo.runInTransaction(tx=>postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"PAYMENT",prefix:"PY",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"payment",referenceId:input.partyId,lines:[debit(input.accountMap.party,input.amount,input.partyId),credit(input.mode==="cash"?input.accountMap.cash:input.accountMap.bank,input.amount)],idempotencyKey:input.idempotencyKey},deps));}
