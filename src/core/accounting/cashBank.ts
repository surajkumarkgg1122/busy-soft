import type { AccountingRepository, AtomicAccountingDocument, Money, PostingResult, VoucherLineInput } from "./types";
import { postIdempotentVoucher } from "./atomic";
import { ValidationError } from "./errors";

export interface CashBankDeps { ids:{next(prefix:string):string}; clock:{now():string}; }
export interface CashBankBase { businessId:string; financialYearId:string; date:string; userId:string; idempotencyKey:string; narration?:string; reference?:string; notes?:string; }
export interface CashBankAccountInput {
  businessId:string;
  financialYearId:string;
  accountId:string;
  displayName:string;
  ledgerAccountId:string;
  kind:"cash"|"bank";
  parentAccountId:string;
  openingBalance:Money;
  openingBalanceType:"debit"|"credit";
  openingBalanceDate:string;
  createdBy:string;
  details?:Record<string,unknown>;
}
export interface CashBankEntryInput extends CashBankBase { accountId:string; ledgerAccountId:string; type:"deposit"|"withdrawal"|"cash_deposit"|"cash_withdrawal"; amount:Money; contraAccountId?:string; partyId?:string; }
export interface CashBankTransferInput extends CashBankBase { fromAccountId:string; fromLedgerAccountId:string; toAccountId:string; toLedgerAccountId:string; amount:Money; }

function validateBase(i:CashBankBase){
  if(!i.businessId||!i.financialYearId||!i.userId) throw new ValidationError("Business, financial year and user are required.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(i.date)) throw new ValidationError("Transaction date must be YYYY-MM-DD.");
  if(i.idempotencyKey.length<16||i.idempotencyKey.length>128) throw new ValidationError("A valid idempotency key is required.");
}
function amount(v:Money){ if(!Number.isSafeInteger(v)||v<=0) throw new ValidationError("Amount must be a positive integer minor-unit amount."); }
function openingAmount(v:Money){ if(!Number.isSafeInteger(v)||v<0) throw new ValidationError("Opening balance must be a non-negative integer minor-unit amount."); }
const dr=(accountId:string,value:Money,extra:Partial<VoucherLineInput>={})=>({accountId,debit:value,credit:0,...extra});
const cr=(accountId:string,value:Money,extra:Partial<VoucherLineInput>={})=>({accountId,debit:0,credit:value,...extra});
const atomic=(x:Omit<AtomicAccountingDocument,"status">):AtomicAccountingDocument=>({...x,status:"posted"});

export async function createCashBankAccount(repo:AccountingRepository,input:CashBankAccountInput,deps:CashBankDeps):Promise<{accountId:string;ledgerAccountId:string;openingVoucherId?:string}> {
  if(!input.businessId||!input.financialYearId||!input.createdBy) throw new ValidationError("Business, financial year and user are required.");
  if(!input.displayName.trim()) throw new ValidationError("Account name is required.");
  openingAmount(input.openingBalance);
  if(input.openingBalanceType!=="debit"&&input.openingBalanceType!=="credit") throw new ValidationError("Invalid opening balance type.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.openingBalanceDate)) throw new ValidationError("Opening balance date must be YYYY-MM-DD.");
  if(!input.accountId||!input.ledgerAccountId||!input.parentAccountId) throw new ValidationError("Account identifiers are required.");
  return repo.runInTransaction(async tx=>{
    const existing=await tx.getBusinessDocument("bankAccounts",input.accountId);
    if(existing) throw new ValidationError("Cash/bank account already exists.");
    const fy=await tx.getFinancialYear(input.financialYearId);
    if(!fy||fy.businessId!==input.businessId||fy.locked) throw new ValidationError("Active financial year is required for cash/bank account creation.");
    if(input.openingBalanceDate<fy.startDate||input.openingBalanceDate>fy.endDate) throw new ValidationError(`Opening balance date ${input.openingBalanceDate} is outside the financial year ${fy.startDate} to ${fy.endDate}.`);
    const parent=await tx.getAccount(input.parentAccountId);
    if(!parent||parent.businessId!==input.businessId||parent.type!=="asset"||!parent.active) throw new ValidationError("Cash/Bank parent account is not configured.");
    const now=deps.clock.now();
    await tx.saveBusinessDocument("accounts",input.ledgerAccountId,{id:input.ledgerAccountId,businessId:input.businessId,code:`CB-${input.accountId.slice(-12)}`,name:input.displayName.trim(),type:"asset",parentId:input.parentAccountId,systemAccount:false,active:true,openingDebit:0,openingCredit:0,createdAt:now,updatedAt:now});
    let openingVoucherId:string|undefined;
    if(input.openingBalance>0){
      const openingAccount=await tx.getAccount("acct-opening-balance");
      if(!openingAccount||openingAccount.businessId!==input.businessId||openingAccount.type!=="equity"||!openingAccount.active) throw new ValidationError("Opening balance adjustment account is not configured.");
      const lines:VoucherLineInput[]=input.openingBalanceType==="debit"
        ? [dr(input.ledgerAccountId,input.openingBalance,{description:`Opening balance for ${input.displayName.trim()}`}),cr("acct-opening-balance",input.openingBalance,{description:"Opening balance adjustment"})]
        : [dr("acct-opening-balance",input.openingBalance,{description:"Opening balance adjustment"}),cr(input.ledgerAccountId,input.openingBalance,{description:`Opening balance for ${input.displayName.trim()}`})];
      const key=`cashbank-opening:${input.accountId}:${input.openingBalanceDate}`;
      const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"OPENING",prefix:"OB",date:input.openingBalanceDate,narration:`Opening balance for ${input.displayName.trim()}`,referenceType:"cash_bank_opening",referenceId:input.accountId,createdBy:input.createdBy,lines,idempotencyKey:key},deps);
      openingVoucherId=result.voucher.id;
      await tx.saveAtomicDocument(atomic({id:`${result.voucher.id}:cashbankopening`,businessId:input.businessId,financialYearId:input.financialYearId,type:"opening",voucherId:result.voucher.id,idempotencyKey:key,date:input.openingBalanceDate,createdBy:input.createdBy,createdAt:now,payload:{operation:"cash_bank_opening",accountId:input.accountId,amount:input.openingBalance,balanceType:input.openingBalanceType}}));
    }
    await tx.saveBusinessDocument("bankAccounts",input.accountId,{businessId:input.businessId,accountId:input.accountId,displayName:input.displayName.trim(),kind:input.kind,ledgerAccountId:input.ledgerAccountId,openingBalance:input.openingBalance,openingBalanceType:input.openingBalanceType,openingBalanceDate:input.openingBalanceDate,currentBalance:input.openingBalanceType==="debit"?input.openingBalance:-input.openingBalance,status:"active",...(input.details??{}),createdBy:input.createdBy,createdAt:now,updatedAt:now,...(openingVoucherId?{openingVoucherId}:{})});
    await tx.saveAuditEvent({id:deps.ids.next("audit"),businessId:input.businessId,entityType:"cash_bank_account",entityId:input.accountId,action:"ACCOUNT_CREATED",userId:input.createdBy,timestamp:now,after:{accountId:input.accountId,ledgerAccountId:input.ledgerAccountId,displayName:input.displayName.trim(),kind:input.kind,status:"active",openingBalance:input.openingBalance,openingBalanceType:input.openingBalanceType,...(openingVoucherId?{openingVoucherId}:{})}});
    return {accountId:input.accountId,ledgerAccountId:input.ledgerAccountId,...(openingVoucherId?{openingVoucherId}:{})};
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
    const contraAccount=await tx.getAccount(contra);
    if(!contraAccount||contraAccount.businessId!==input.businessId||!contraAccount.active) throw new ValidationError("Counter account is invalid or inactive.");
    if(input.partyId){
      const party=await tx.getBusinessDocument("parties",input.partyId);
      if(!party) throw new ValidationError("Selected party was not found in the active business.");
      if(String(party.businessId??input.businessId)!==input.businessId) throw new ValidationError("Selected party belongs to another business.");
      if(String(party.ledgerAccountId)!==contra) throw new ValidationError("Selected party is not linked to the selected counter account.");
    }
    const partyLine=input.partyId?{partyId:input.partyId}:{};
    const lines:VoucherLineInput[]=incoming?[dr(input.ledgerAccountId,input.amount),cr(contra,input.amount,partyLine)]:[dr(contra,input.amount,partyLine),cr(input.ledgerAccountId,input.amount)];
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:incoming?"RECEIPT":"PAYMENT",prefix:incoming?"RC":"PY",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"cash_bank",referenceId:input.accountId,lines,idempotencyKey:input.idempotencyKey},deps);
    await tx.saveBusinessDocument("bankAccounts",input.accountId,{businessId:input.businessId,accountId:input.accountId,lastVoucherId:result.voucher.id,lastTransactionAt:input.date,updatedAt:deps.clock.now()});
    await tx.saveAtomicDocument(atomic({id:`${result.voucher.id}:cashbank`,businessId:input.businessId,financialYearId,type:"journal",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,date:input.date,createdBy:input.userId,createdAt:deps.clock.now(),payload:{operation:"cash_bank_entry",accountId:input.accountId,type:input.type,amount:input.amount,partyId:input.partyId??null,reference:input.reference??"",notes:input.notes??""}}));
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
    await tx.saveAtomicDocument(atomic({id:`${result.voucher.id}:cashbanktransfer`,businessId:input.businessId,financialYearId,type:"journal",voucherId:result.voucher.id,idempotencyKey:input.idempotencyKey,date:input.date,createdBy:input.userId,createdAt:now,payload:{operation:"cash_bank_transfer",fromAccountId:input.fromAccountId,toAccountId:input.toAccountId,amount:input.amount,reference:input.reference??"",notes:input.notes??""}}));
    return result;
  });
}