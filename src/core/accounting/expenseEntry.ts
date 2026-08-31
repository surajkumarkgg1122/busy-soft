import type { AccountingRepository, Money, PostingResult, VoucherLineInput } from "./types";
import type { TransactionDeps } from "./transactions";
import { postIdempotentVoucher } from "./atomic";
import { ValidationError } from "./errors";
import { assertMoney } from "./money";

export interface ExpenseEntryInput {
  businessId:string;
  financialYearId:string;
  date:string;
  userId:string;
  expenseAccountId:string;
  amount:Money;
  mode:"cash"|"bank";
  cashAccountId?:string;
  bankAccountId?:string;
  idempotencyKey:string;
  documentId:string;
  documentPayload?:Record<string,unknown>;
  narration?:string;
}
const debit=(accountId:string,amount:Money):VoucherLineInput=>({accountId,debit:amount,credit:0});
const credit=(accountId:string,amount:Money):VoucherLineInput=>({accountId,debit:0,credit:amount});
const required=(v:string|undefined,n:string)=>{if(!v)throw new ValidationError(`Missing ${n}.`);return v;};

export async function postExpenseEntry(repo:AccountingRepository,input:ExpenseEntryInput,deps:TransactionDeps):Promise<PostingResult>{
  if(!input.businessId||!input.financialYearId||!input.userId||!input.documentId)throw new ValidationError("Business, financial year, user and expense document are required.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Expense date must be YYYY-MM-DD.");
  if(!input.idempotencyKey)throw new ValidationError("Expense idempotency key is required.");
  assertMoney(input.amount,"Expense amount");
  if(input.amount<=0)throw new ValidationError("Expense amount must be positive.");
  const settlement=input.mode==="cash"?required(input.cashAccountId,"cash account"):required(input.bankAccountId,"bank account");

  return repo.runInTransaction(async tx=>{
    const existing=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);
    if(existing) return postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"EXPENSE",prefix:"EX",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"expense",referenceId:input.documentId,lines:[],idempotencyKey:input.idempotencyKey},deps);
    if(await tx.getBusinessDocument("expenses",input.documentId))throw new ValidationError(`Expense document ${input.documentId} already exists.`);
    const expenseAccount=await tx.getAccount(input.expenseAccountId);if(!expenseAccount||!expenseAccount.active||expenseAccount.type!=="expense")throw new ValidationError("Expense account does not exist or is inactive.");
    const settlementAccount=await tx.getAccount(settlement);if(!settlementAccount||!settlementAccount.active||settlementAccount.type!=="asset")throw new ValidationError("Cash/bank account does not exist or is inactive.");
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"EXPENSE",prefix:"EX",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"expense",referenceId:input.documentId,lines:[debit(input.expenseAccountId,input.amount),credit(settlement,input.amount)],idempotencyKey:input.idempotencyKey},deps);
    const payload={...(input.documentPayload??{}),businessId:input.businessId,expenseId:input.documentId,accountingVoucherId:result.voucher.id,accountingVoucherNumber:result.voucher.voucherNumber,amountMinor:input.amount,paymentMode:input.mode,postedAt:result.voucher.createdAt};
    await tx.saveBusinessDocument("expenses",input.documentId,payload);
    return result;
  });
}
