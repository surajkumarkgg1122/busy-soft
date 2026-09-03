import type { AccountingRepository, AuditEvent, VoucherLineInput, PostingResult } from "./types";
import { postIdempotentVoucher } from "./atomic";
import { ValidationError } from "./errors";
export interface ReversalDeps { ids:{next(prefix:string):string}; clock:{now():string}; }
export async function reversePostedVoucher(repo:AccountingRepository,input:{businessId:string;financialYearId:string;voucherId:string;userId:string;idempotencyKey:string;date:string;narration?:string},deps:ReversalDeps):Promise<PostingResult>{
 if(!input.businessId||!input.financialYearId||!input.voucherId||!input.userId)throw new ValidationError("Business, financial year, voucher and user are required.");
 if(input.idempotencyKey.length<16||input.idempotencyKey.length>128)throw new ValidationError("A valid reversal idempotency key is required.");
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date))throw new ValidationError("Reversal date must be YYYY-MM-DD.");
 return repo.runInTransaction(async tx=>{
  const existing=await tx.getVoucherByIdempotencyKey(input.businessId,input.financialYearId,input.idempotencyKey);
  if(existing){
   if(existing.referenceType!=="reversal"||existing.referenceId!==input.voucherId)throw new ValidationError("Reversal idempotency key is already used for another voucher.");
   const lines=await tx.getVoucherLines(existing.id);
   return {voucher:existing,lines,ledgerEntries:lines.map(l=>({...l,financialYearId:existing.financialYearId,date:existing.date,voucherType:existing.voucherType,voucherNumber:existing.voucherNumber,createdAt:existing.createdAt})),stockMovements:await tx.getStockMovementsForSource(existing.id)};
  }

  const original=await tx.getVoucher(input.voucherId);if(!original)throw new ValidationError("Voucher not found.");
  if(original.businessId!==input.businessId||original.financialYearId!==input.financialYearId)throw new ValidationError("Voucher business or financial year mismatch.");
  if(original.status!=="posted")throw new ValidationError("Only a posted voucher can be reversed.");
  if(original.createdBy===input.userId&&original.idempotencyKey===input.idempotencyKey)throw new ValidationError("Invalid reversal context.");
  const lines=await tx.getVoucherLines(original.id);if(!lines.length)throw new ValidationError("Cannot reverse a voucher without its lines.");
  const reversalLines:VoucherLineInput[]=lines.map(l=>({accountId:l.accountId,partyId:l.partyId,itemId:l.itemId,warehouseId:l.warehouseId,description:`Reversal of ${original.voucherNumber}`,debit:l.credit,credit:l.debit,taxCode:l.taxCode}));
  const result=await postIdempotentVoucher(tx,{businessId:input.businessId,financialYearId:input.financialYearId,voucherType:`${original.voucherType}_REVERSAL`,prefix:"RV",date:input.date,narration:input.narration??`Reversal of ${original.voucherNumber}`,createdBy:input.userId,referenceType:"reversal",referenceId:original.id,lines:reversalLines,idempotencyKey:input.idempotencyKey},deps);
  const now=deps.clock.now();
  await tx.saveVoucher({...original,status:"cancelled",cancelledAt:now,cancelledBy:input.userId,reversalOfVoucherId:result.voucher.id,updatedAt:now});

  if(original.referenceType==="cash_bank"&&original.referenceId){
   const account=await tx.getBusinessDocument("bankAccounts",original.referenceId);
   if(account){
    const accountLine=lines.find(l=>l.accountId===String(account.ledgerAccountId));
    const originalDelta=Number(accountLine?.debit??0)-Number(accountLine?.credit??0);
    await tx.saveBusinessDocument("bankAccounts",original.referenceId,{currentBalance:Number(account.currentBalance??0)-originalDelta,lastVoucherId:result.voucher.id,lastTransactionAt:input.date,updatedAt:now});
   }
  } else if(original.referenceType==="cash_bank_transfer"&&original.referenceId){
   const [fromAccountId,toAccountId]=String(original.referenceId).split(":");
   if(fromAccountId&&toAccountId){
    const [from,to]=await Promise.all([tx.getBusinessDocument("bankAccounts",fromAccountId),tx.getBusinessDocument("bankAccounts",toAccountId)]);
    if(from&&to){
     const fromLine=lines.find(l=>l.accountId===String(from.ledgerAccountId));
     const amount=Math.abs(Number(fromLine?.debit??0)-Number(fromLine?.credit??0));
     await tx.saveBusinessDocument("bankAccounts",fromAccountId,{currentBalance:Number(from.currentBalance??0)+amount,lastVoucherId:result.voucher.id,lastTransactionAt:input.date,updatedAt:now});
     await tx.saveBusinessDocument("bankAccounts",toAccountId,{currentBalance:Number(to.currentBalance??0)-amount,lastVoucherId:result.voucher.id,lastTransactionAt:input.date,updatedAt:now});
    }
   }
  }

  const audit:AuditEvent={id:deps.ids.next("audit"),businessId:input.businessId,entityType:"voucher",entityId:original.id,action:"REVERSE",userId:input.userId,timestamp:now,metadata:{originalVoucherId:original.id,reversalVoucherId:result.voucher.id,voucherNumber:original.voucherNumber}};await tx.saveAuditEvent(audit);
  return result;
 });
}
