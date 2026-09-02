import type { AccountingRepository, AtomicAccountingDocument, Money, PostingResult, VoucherLineInput } from "./types";
import { postIdempotentVoucher } from "./atomic";
import { ValidationError } from "./errors";

export interface CashBankDeps { ids:{next(prefix:string):string}; clock:{now():string}; }
export interface CashBankBase { businessId:string; financialYearId:string; date:string; userId:string; idempotencyKey:string; narration?:string; reference?:string; notes?:string; }
export interface CashBankAccountInput { accountId:string; displayName:string; ledgerAccountId:string; kind:"cash"|"bank"; openingBalance:Money; openingBalanceDate:string; createdBy:string; }
export interface CashBankEntryInput extends CashBankBase { accountId:string; ledgerAccountId:string; type:"deposit"|"withdrawal"|"cash_deposit"|"cash_withdrawal"; amount:Money; contraAccountId?:string; }
export interface CashBankTransferInput extends CashBankBase { fromAccountId:string; fromLedgerAccountId:string; toAccountId:string; toLedgerAccountId:string; amount:Money; }

function validateBase(i:CashBankBase){
  if(!i.businessId||!i.financialYearId||!i.userId) throw new ValidationError("Business, financial year and user are required.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new ValidationError("Transaction date must be YYYY-MM-DD.");
  if(i.idempotencyKey.length<16||i.idempotencyKey.length>128) throw new ValidationError("A valid idempotency key is required.");
}
function amount(v:Money){ if(!Number.isSafeInteger(v)||v<=0) throw new ValidationError("Amount must be a positive integer minor-unit amount."); }
const dr=(accountId:string,value:Money,extra:Partial<VoucherLineInput>={})=>({accountId,debit:value,credit:0,...extra});
const cr=(accountId:string,value:Money,extra:Partial<VoucherLineInput>={})=>({accountId,debit:0,credit:value,...extra});
const atomic=(x:Omit<AtomicAccountingDocument,"status">):AtomicAccountingDocument=>({...x,status:"posted"});

export async function createCashBankAccount(repo:AccountingRepository,input:CashBankAccountInput,deps:CashBankDeps):Promise<{accountId:string;ledgerAccountId:string}> {
  if(!input.displayName.trim()) throw new ValidationError("Account name is required.");
  if(input.openingBalance<0||!Number.isSafeInteger(input.openingBalance)) throw new ValidationError("Opening balance must be a non-negative minor-unit amount.");
  if(!input.accountId||!input.ledgerAccountId) throw new ValidationError("Account identifiers are required.");
  return repo.runInTransaction(async tx=>{
    const existing=await tx.getBusinessDocument("bankAccounts",input.accountId);
    if(existing) throw new ValidationError("Cash/bank account already exists.");
    const now=deps.clock.now();
    await tx.saveBusinessDocument("bankAccounts",input.accountId,{businessId:input.businessId,accountId:input.accountId,displayName:input.displayName.trim(),kind:input.kind,ledgerAccountId:input.ledgerAccountId,openingBalance:input.openingBalance,openingBalanceDate:input.openingBalanceDate,currentBalance:input.openingBalance,status:"active",createdBy:input.createdBy,createdAt:now,updatedAt:now});
    return {accountId:input.accountId,ledgerAccountId:input.ledgerAccountId};
  });
}

// bankAccounts are already physically scoped to businesses/{businessId}. The repository
// prevents reading another business's bankAccounts. Therefore ownership is established by
// the repository scope; legacy bankAccount documents may contain a stale/missing businessId.
// The linked GL account is still checked by postVoucher against the requested business.
async function getScopedCashBankAccount(tx:any,accountId:string){
  return await tx.getBusinessDocument("bankAccounts",accountId) as Record<string,unknown>|null;
}

export async function postCashBankEntry(repo:AccountingRepository,input:CashBankEntryInput,deps:CashBankDeps):Promise<PostingResult>{
  validateBase(input); amount(input.amount);
  const incoming=input.type==="deposit"||input.type==="cash_deposit";
  return repo.runInTransaction(async tx=>{
    const existing=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);
    if(existing) return {voucher:existing};
    const account=await getScopedCashBankAccount(tx,input.accountId);
    if(!account) throw new ValidationError("Cash/bank account was not found in the active business.");
    if(account.status!=="active") throw new ValidationError("Cash/bank account is inactive.");
    if(String(account.ledgerAccountId)!==input.ledgerAccountId) throw new ValidationError("Cash/bank ledger account mismatch.");
    const contra=input.contraAccountId;
    if(!contra) throw new ValidationError("Counter account is required for cash/bank entries.");
    const lines:VoucherLineInput[]=incoming?[dr(input.ledgerAccountId,input.amount),cr(contra,input.amount)]:[dr(contra,input.amount),cr(input.ledgerAccountId,input.amount)];
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:incoming?"RECEIPT":"PAYMENT",prefix:incoming?"RC":"PY",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"cash_bank",referenceId:input.accountId,lines,idempotencyKey:input.idempotencyKey},deps);
    await tx.saveBusinessDocument("bankAccounts",input.accountId,{businessId:input.businessId,accountId:input.accountId,lastVoucherId:result.voucher.id,lastTransactionAt:input.date,updatedAt:deps.clock.now()});
    await tx.saveAtomicDocument(atomic({id:`${result.voucher.id}:cashbank`,businessId:input.businessId,financialYearId:input.financialYearId,type:"journal",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,date:input.date,createdBy:input.userId,createdAt:deps.clock.now(),payload:{operation:"cash_bank_entry",accountId:input.accountId,type:input.type,amount:input.amount,reference:input.reference??"",notes:input.notes??""}}));
    return result;
  });
}

export async function postCashBankTransfer(repo:AccountingRepository,input:CashBankTransferInput,deps:CashBankDeps):Promise<PostingResult>{
  validateBase(input); amount(input.amount);
  if(input.fromAccountId===input.toAccountId) throw new ValidationError("Source and destination accounts must be different.");
  return repo.runInTransaction(async tx=>{
    const existing=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);
    if(existing) return {voucher:existing};
    const from=await getScopedCashBankAccount(tx,input.fromAccountId);
    const to=await getScopedCashBankAccount(tx,input.toAccountId);
    if(!from||!to) throw new ValidationError("Both cash/bank accounts must belong to the active business.");
    if(from.status!=="active"||to.status!=="active") throw new ValidationError("Both cash/bank accounts must be active.");
    if(String(from.ledgerAccountId)!==input.fromLedgerAccountId||String(to.ledgerAccountId)!==input.toLedgerAccountId) throw new ValidationError("Cash/bank ledger account mismatch.");
    const lines=[cr(input.fromLedgerAccountId,input.amount),dr(input.toLedgerAccountId,input.amount)];
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"CONTRA",prefix:"CT",date:input.date,narration:input.narration??`Transfer ${input.fromAccountId} to ${input.toAccountId}`,createdBy:input.userId,referenceType:"cash_bank_transfer",referenceId:`${input.fromAccountId}:${input.toAccountId}`,lines,idempotencyKey:input.idempotencyKey},deps);
    const now=deps.clock.now();
    await tx.saveBusinessDocument("bankAccounts",input.fromAccountId,{businessId:input.businessId,accountId:input.fromAccountId,lastVoucherId:result.voucher.id,lastTransactionAt:input.date,updatedAt:now});
    await tx.saveBusinessDocument("bankAccounts",input.toAccountId,{businessId:input.businessId,accountId:input.toAccountId,lastVoucherId:result.voucher.id,lastTransactionAt:input.date,updatedAt:now});
    await tx.saveAtomicDocument(atomic({id:`${result.voucher.id}:cashbanktransfer`,businessId:input.businessId,financialYearId:input.financialYearId,type:"journal",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,date:input.date,createdBy:input.userId,createdAt:now,payload:{operation:"cash_bank_transfer",fromAccountId:input.fromAccountId,toAccountId:input.toAccountId,amount:input.amount,reference:input.reference??"",notes:input.notes??""}}));
    return result;
  });
}
