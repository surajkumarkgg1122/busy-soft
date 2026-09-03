import { NextResponse } from "next/server";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { executeExpense } from "@/application/core";
import { reversePostedVoucher } from "@/core/accounting/voucherReversal";
import { ValidationError } from "@/core/accounting/errors";

export const runtime = "nodejs";
type Membership={status?:string;role?:string;permissions?:Record<string,unknown>};
type AdminDb=ReturnType<typeof getAdminServices>["db"];
const deps=()=>({ids:{next:(prefix:string)=>`${prefix}-${crypto.randomUUID()}`},clock:{now:()=>new Date().toISOString()}});
function jsonError(message:string,status:number){return NextResponse.json({success:false,error:message},{status});}
function fyId(date:string){const y=Number(date.slice(0,4));const m=Number(date.slice(5,7));const s=m>=4?y:y-1;return `fy-${s}-${String(s+1).slice(-2)}`;}
function validDate(value:unknown,name="Expense date"){const v=String(value??"");if(!/^\d{4}-\d{2}-\d{2}$/.test(v))throw new ValidationError(`${name} must be YYYY-MM-DD.`);return v;}
async function authorize(request:Request,businessId:string,action:"view"|"create"|"edit"){
  const {auth,db}=getAdminServices();const h=request.headers.get("authorization")??"";if(!h.startsWith("Bearer "))throw new Error("AUTH_REQUIRED");
  const token=await auth.verifyIdToken(h.slice(7));if(!businessId)throw new Error("BUSINESS_REQUIRED");const businessRef=db.collection("businesses").doc(businessId);const snap=await businessRef.collection("members").doc(token.uid).get();
  if(!snap.exists)throw new Error("NOT_MEMBER");const m=snap.data() as Membership;if(m.status!=="active")throw new Error("INACTIVE_MEMBER");const p=(m.permissions?.expenses??{}) as Record<string,unknown>;if(!(m.role==="owner"||m.role==="admin"||p[action]===true))throw new Error("PERMISSION_DENIED");return{db,businessRef,userId:token.uid};
}
async function accountIdForCategory(db:AdminDb,businessId:string,category:string){
  const slug=category.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"general";const id=`acct-expense-${slug}`;const ref=db.collection("businesses").doc(businessId).collection("accounts").doc(id);const snap=await ref.get();
  if(!snap.exists){const now=new Date().toISOString();await ref.create({id,businessId,code:`EXP-${slug.slice(0,12).toUpperCase()}`,name:`${category} Expense`,type:"expense",parentId:null,systemAccount:false,active:true,openingDebit:0,openingCredit:0,createdAt:now,updatedAt:now});}
  return id;
}
async function assetAccount(db:AdminDb,businessId:string,id:string){const snap=await db.collection("businesses").doc(businessId).collection("accounts").doc(id).get();if(!snap.exists)throw new ValidationError(`Payment account ${id} does not exist.`);const a=snap.data() as {active?:boolean;type?:string};if(a.active===false||a.type!=="asset")throw new ValidationError(`Payment account ${id} is not an active asset account.`);}

export async function GET(request:Request){
  try{
    const url=new URL(request.url);const businessId=url.searchParams.get("businessId")?.trim()??"";const{businessRef}=await authorize(request,businessId,"view");
    const [snap,categories,bankAccounts]=await Promise.all([businessRef.collection("expenses").get(),businessRef.collection("accounts").where("type","==","expense").get(),businessRef.collection("bankAccounts").where("status","==","active").get()]);
    const cash=await businessRef.collection("accounts").doc("acct-cash").get();
    const paymentAccounts=[...(cash.exists?[{id:"acct-cash",name:String(cash.data()?.name??"Cash in Hand"),kind:"cash"}]:[]),...bankAccounts.docs.map(d=>({id:d.id,name:String(d.data()?.displayName??d.data()?.bankName??d.id),kind:String(d.data()?.kind??"bank"),ledgerAccountId:String(d.data()?.ledgerAccountId??"")}))];
    return NextResponse.json({success:true,data:{expenses:snap.docs.map(d=>({expenseId:d.id,...d.data()})),categories:categories.docs.map(d=>({id:d.id,name:String(d.data().name??""),code:String(d.data().code??"")})),paymentAccounts}});
  }catch(e){const m=e instanceof Error?e.message:"Could not load expenses.";const s=/AUTH|required.*token|credential/i.test(m)?401:/MEMBER|PERMISSION|INACTIVE/.test(m)?403:/BUSINESS/.test(m)?400:500;return jsonError(s===500?"Could not load expenses.":m.replaceAll("_"," "),s);}
}

export async function POST(request:Request){
  try{
    const body=await request.json() as Record<string,unknown>;const businessId=String(body.businessId??"");const action=String(body.action??"create");
    const isEdit=Boolean(body.expenseId)&&action!=="reverse";const{db,userId}=await authorize(request,businessId,isEdit||action==="reverse"?"edit":"create");
    const ref=db.collection("businesses").doc(businessId);
    if(action==="reverse"){
      const expenseId=String(body.expenseId??"");if(!expenseId)throw new ValidationError("Expense ID is required.");const doc=await ref.collection("expenses").doc(expenseId).get();if(!doc.exists)throw new ValidationError("Expense not found.");const expense=doc.data() as Record<string,unknown>;const voucherId=String(expense.accountingVoucherId??"");if(!voucherId)throw new ValidationError("Expense has no accounting voucher and cannot be reversed.");
      const voucher=await ref.collection("vouchers").doc(voucherId).get();if(!voucher.exists)throw new ValidationError("Accounting voucher not found.");const v=voucher.data() as Record<string,unknown>;if(String(v.status??"")!=="posted")throw new ValidationError("Only a posted expense can be reversed.");
      const reversalDate=validDate(body.date??expense.date,"Reversal date");const financialYearId=String(v.financialYearId??fyId(reversalDate));const fySnap=await ref.collection("financialYears").doc(financialYearId).get();if(!fySnap.exists)throw new ValidationError(`Financial year ${financialYearId} does not exist.`);
      const key=String(body.idempotencyKey??"").trim();if(key.length<16||key.length>128)throw new ValidationError("Idempotency key must be between 16 and 128 characters.");
      const result=await reversePostedVoucher(createAdminAccountingRepository(businessId),{businessId,financialYearId,voucherId,userId,idempotencyKey:key,date:reversalDate,narration:String(body.narration??`Reversal of expense ${String(expense.expenseNumber??expenseId)}`)},deps());
      await ref.collection("expenses").doc(expenseId).set({status:"cancelled",cancelledAt:new Date().toISOString(),cancelledBy:userId,reversalVoucherId:result.voucher.id,reversalVoucherNumber:result.voucher.voucherNumber}, {merge:true});
      return NextResponse.json({success:true,result:result.value});
    }

    const date=validDate(body.date);const category=String(body.category??"General").trim()||"General";const amountMinor=Number(body.amountMinor??0);const paymentMethod=String(body.paymentMethod??"cash").toLowerCase();
    if(!Number.isSafeInteger(amountMinor)||amountMinor<=0)throw new ValidationError("Expense amount must be positive minor units.");if(!["cash","bank"].includes(paymentMethod))throw new ValidationError("Expense payment must use cash or bank account.");
    const financialYearId=fyId(date);const fySnap=await ref.collection("financialYears").doc(financialYearId).get();if(!fySnap.exists)throw new ValidationError(`Financial year ${financialYearId} does not exist.`);
    const expenseAccountId=await accountIdForCategory(db,businessId,category);const cashAccountId="acct-cash";const bankAccountId=typeof body.bankAccountId==="string"&&body.bankAccountId?body.bankAccountId:"acct-bank";if(paymentMethod==="cash")await assetAccount(db,businessId,cashAccountId);else await assetAccount(db,businessId,bankAccountId);

    let documentId=typeof body.expenseId==="string"&&body.expenseId?body.expenseId:crypto.randomUUID();let replacementOf:string|undefined;
    if(isEdit){
      const old=await ref.collection("expenses").doc(documentId).get();if(!old.exists)throw new ValidationError("Expense to edit was not found.");const oldData=old.data() as Record<string,unknown>;const oldVoucherId=String(oldData.accountingVoucherId??"");if(!oldVoucherId)throw new ValidationError("Existing expense has no accounting voucher.");const oldVoucher=await ref.collection("vouchers").doc(oldVoucherId).get();if(!oldVoucher.exists||String(oldVoucher.data()?.status??"")!=="posted")throw new ValidationError("Only a posted expense can be edited.");
      const reverseKey=`expense-edit-reverse-${crypto.randomUUID()}`;await reversePostedVoucher(createAdminAccountingRepository(businessId),{businessId,financialYearId:String(oldVoucher.data()?.financialYearId??financialYearId),voucherId:oldVoucherId,userId,idempotencyKey:reverseKey,date,narration:`Edit reversal of expense ${String(oldData.expenseNumber??documentId)}`},deps());
      replacementOf=documentId;documentId=`${documentId}-rev-${crypto.randomUUID()}`;
      await ref.collection("expenses").doc(String(body.expenseId)).set({status:"replaced",replacedAt:new Date().toISOString(),replacedByExpenseId:documentId},{merge:true});
    }
    const idempotencyKey=String(body.idempotencyKey??"").trim();if(idempotencyKey.length<16||idempotencyKey.length>128)throw new ValidationError("Idempotency key must be between 16 and 128 characters.");
    const repo=createAdminAccountingRepository(businessId);const context={businessId,userId,financialYearId,idempotencyKey,permissions:["JOURNAL_CREATE"] as ["JOURNAL_CREATE"]};
    const result=await executeExpense({repo,ids:deps().ids,clock:deps().clock},context,{date,expenseAccountId,amount:amountMinor,mode:paymentMethod as "cash"|"bank",cashAccountId,bankAccountId,documentId,documentPayload:{expenseNumber:typeof body.expenseNumber==="string"?body.expenseNumber:documentId,categoryId:category,paymentMethod,date,description:typeof body.description==="string"?body.description.trim():"",status:"posted",...(replacementOf?{replacementOf}: {})}});
    return NextResponse.json({success:true,result:result.value,expenseId:documentId});
  }catch(e){const m=e instanceof Error?e.message:"Could not post expense.";const s=/permission|member/i.test(m)?403:/AUTH|token|credential/i.test(m)?401:/conflict|duplicate|idempotency|exists/i.test(m)?409:/financial year|required|date|amount|payment|voucher|expense/i.test(m)?400:500;return jsonError(m,s);}
}
