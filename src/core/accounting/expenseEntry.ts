import type { AccountingRepository, AuditEvent, Money, PostingResult, VoucherLineInput } from "./types";
import type { TransactionDeps } from "./transactions";
import { postIdempotentVoucher } from "./atomic";
import { ValidationError } from "./errors";
import { assertMoney } from "./money";
import { calculateTax, type TaxCalculationInput } from "./gst";

export interface ExpenseEntryInput {
  businessId:string; financialYearId:string; date:string; userId:string;
  expenseAccountId:string; amount:Money; mode:"cash"|"bank"|"credit";
  cashAccountId?:string; bankAccountId?:string; payableAccountId?:string;
  tax?: Omit<TaxCalculationInput,"taxableValue">;
  idempotencyKey:string; documentId:string; documentPayload?:Record<string,unknown>; narration?:string;
}
const debit=(accountId:string,amount:Money,extra:Partial<VoucherLineInput>={}):VoucherLineInput=>({accountId,debit:amount,credit:0,...extra});
const credit=(accountId:string,amount:Money,extra:Partial<VoucherLineInput>={}):VoucherLineInput=>({accountId,debit:0,credit:amount,...extra});
const required=(v:string|undefined,n:string)=>{if(!v)throw new ValidationError(`Missing ${n}.`);return v;};

export async function postExpenseEntry(repo:AccountingRepository,input:ExpenseEntryInput,deps:TransactionDeps):Promise<PostingResult>{
  required(input.businessId,"business context"); required(input.financialYearId,"financial year"); required(input.userId,"authenticated user"); required(input.documentId,"expense document");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Expense date must be YYYY-MM-DD.");
  if(input.idempotencyKey.length<16||input.idempotencyKey.length>128)throw new ValidationError("Expense idempotency key must be between 16 and 128 characters.");
  assertMoney(input.amount,"Expense amount"); if(input.amount<=0)throw new ValidationError("Expense amount must be positive.");
  if(!["cash","bank","credit"].includes(input.mode))throw new ValidationError("Expense payment mode is invalid.");
  const settlement=input.mode==="cash"?required(input.cashAccountId,"cash account"):input.mode==="bank"?required(input.bankAccountId,"bank account"):required(input.payableAccountId,"payable account");

  return repo.runInTransaction(async tx=>{
    const existingDocument=await tx.getBusinessDocument("expenses",input.documentId);
    if(existingDocument)throw new ValidationError(`Expense document ${input.documentId} already exists.`);
    const expenseAccount=await tx.getAccount(input.expenseAccountId);
    if(!expenseAccount||!expenseAccount.active||expenseAccount.type!=="expense")throw new ValidationError("Expense account does not exist or is inactive.");
    const settlementAccount=await tx.getAccount(settlement);
    if(!settlementAccount||!settlementAccount.active)throw new ValidationError("Expense settlement account does not exist or is inactive.");
    if(input.mode!=="credit"&&settlementAccount.type!=="asset")throw new ValidationError("Cash/bank settlement account must be an active asset account.");
    if(input.mode==="credit"&&settlementAccount.type!=="liability")throw new ValidationError("Credit expense settlement account must be a liability account.");

    const tax=input.tax?calculateTax({taxableValue:input.amount,...input.tax}):null;
    const lines:VoucherLineInput[]=[];
    if(tax){
      if(tax.taxableValue!==input.amount)throw new ValidationError("Expense taxable value must equal the expense amount before tax.");
      lines.push(debit(input.expenseAccountId,input.amount));
      if(tax.cgst){const id=required((input.tax as TaxCalculationInput).taxCode&&input.documentPayload?.inputCgstAccountId as string|undefined,"input CGST account");lines.push(debit(id,tax.cgst));}
      if(tax.sgst){const id=required(input.documentPayload?.inputSgstAccountId as string|undefined,"input SGST account");lines.push(debit(id,tax.sgst));}
      if(tax.igst){const id=required(input.documentPayload?.inputIgstAccountId as string|undefined,"input IGST account");lines.push(debit(id,tax.igst));}
      if(tax.cess){const id=required(input.documentPayload?.inputCessAccountId as string|undefined,"input cess account");lines.push(debit(id,tax.cess));}
      if(tax.roundOff>0){const id=required(input.documentPayload?.roundOffDebitAccountId as string|undefined,"round-off debit account");lines.push(debit(id,tax.roundOff));}
      if(tax.roundOff<0){const id=required(input.documentPayload?.roundOffCreditAccountId as string|undefined,"round-off credit account");lines.push(credit(id,Math.abs(tax.roundOff)));}
      const payable=tax.total;
      lines.push(credit(settlement,payable));
    }else{
      lines.push(debit(input.expenseAccountId,input.amount),credit(settlement,input.amount));
    }
    const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:"EXPENSE",prefix:"EX",date:input.date,narration:input.narration,createdBy:input.userId,referenceType:"expense",referenceId:input.documentId,lines,idempotencyKey:input.idempotencyKey},deps);
    const payload={...(input.documentPayload??{}),businessId:input.businessId,expenseId:input.documentId,accountingVoucherId:result.voucher.id,accountingVoucherNumber:result.voucher.voucherNumber,amountMinor:input.amount,paymentMode:input.mode,postedAt:result.voucher.createdAt,tax:tax??null,status:"posted"};
    await tx.saveBusinessDocument("expenses",input.documentId,payload);
    const audit:AuditEvent={id:deps.ids.next("audit"),businessId:input.businessId,entityType:"expense",entityId:input.documentId,action:"POST",userId:input.userId,timestamp:deps.clock.now(),after:payload};
    await tx.saveAuditEvent(audit);
    return result;
  });
}
