import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { postCashBankEntry, postCashBankTransfer } from "@/core/accounting/cashBank";
import { reversePostedVoucher } from "@/core/accounting/voucherReversal";

export const runtime="nodejs";

type Member={role?:string;status?:string;permissions?:Record<string,unknown>};
const fail=(message:string,status=400)=>NextResponse.json({success:false,error:message},{status});
const businessRef=(db:any,businessId:string)=>db.collection("businesses").doc(businessId);

async function auth(request:Request){
  const {auth,db}=getAdminServices();
  const header=request.headers.get("authorization")||"";
  if(!header.startsWith("Bearer "))throw Object.assign(new Error("Authentication is required."),{status:401});
  let token;
  try{token=await auth.verifyIdToken(header.slice(7));}catch{throw Object.assign(new Error("Authentication token is invalid or expired."),{status:401});}
  return{db,token};
}
async function membership(db:any,businessId:string,uid:string):Promise<Member>{
  const snap=await businessRef(db,businessId).collection("members").doc(uid).get();
  if(!snap.exists||snap.data()?.status!=="active")throw Object.assign(new Error("You are not an active member of this business."),{status:403});
  return snap.data()||{};
}
function allowed(member:Member,action:"create"|"edit"|"view"){if(member.role==="owner"||member.role==="admin")return true;return member.permissions?.cashBank?.[action]===true;}
function key(body:Record<string,unknown>){const value=String(body.idempotencyKey||"").trim();if(value.length<16||value.length>128)throw new Error("A valid idempotency key is required.");return value;}
const deps=()=>({ids:{next:(prefix:string)=>`${prefix}-${randomUUID()}`},clock:{now:()=>new Date().toISOString()}});
async function currentFy(db:any,businessId:string){const snap=await businessRef(db,businessId).collection("financialYears").where("locked","==",false).orderBy("startDate","desc").limit(1).get();if(snap.empty)throw new Error("No open financial year is configured for this business.");return String(snap.docs[0].id);}
function positiveRupees(value:unknown,name="Amount"){const n=Number(value);if(!Number.isFinite(n)||n<=0)throw new Error(`${name} must be greater than zero.`);const minor=Math.round(n*100);if(!Number.isSafeInteger(minor)||minor<=0)throw new Error(`${name} is too large or invalid.`);return{rupees:n,minor};}
function nonNegativeRupees(value:unknown,name="Amount"){const n=Number(value);if(!Number.isFinite(n)||n<0)throw new Error(`${name} must be a non-negative amount.`);const minor=Math.round(n*100);if(!Number.isSafeInteger(minor)||minor<0)throw new Error(`${name} is too large or invalid.`);return{rupees:n,minor};}

export async function GET(request:Request){
  try{
    const {db,token}=await auth(request);const url=new URL(request.url);const businessId=(url.searchParams.get("businessId")||"").trim();if(!businessId)return fail("Business ID is required.");
    const member=await membership(db,businessId,token.uid);if(!allowed(member,"view"))return fail("Cash & Bank view permission denied.",403);
    const ref=businessRef(db,businessId),fyId=await currentFy(db,businessId),includeInactive=url.searchParams.get("includeInactive")==="true";
    const accountQuery=includeInactive?ref.collection("bankAccounts"):ref.collection("bankAccounts").where("status","==","active");
    const [cashSnap,ledgerSnap,accountsSnap]=await Promise.all([accountQuery.get(),ref.collection("ledgerEntries").where("financialYearId","==",fyId).get(),ref.collection("accounts").where("active","==",true).get()]);
    const cashAccounts=cashSnap.docs.map((d:any)=>({accountId:d.id,...d.data()}));const balance=new Map<string,number>();
    for(const d of ledgerSnap.docs){const x=d.data() as any;const accountId=String(x.accountId||"");if(accountId)balance.set(accountId,(balance.get(accountId)||0)+Number(x.debit||0)-Number(x.credit||0));}
    const accountMap=new Map<string,any>(accountsSnap.docs.map((d:any)=>[d.id,{accountId:d.id,...d.data()}]));
    const enriched=cashAccounts.map((a:any)=>{const gl=accountMap.get(String(a.ledgerAccountId||""));const ledgerBalance=Number(balance.get(String(a.ledgerAccountId||""))||0);const opening=Number(gl?.openingDebit||0)-Number(gl?.openingCredit||0);return{...a,currentBalance:opening+ledgerBalance,balanceSource:"accountingLedger",ledgerHealthy:Boolean(gl&&gl.type==="asset"&&gl.active!==false)};});
    const glAccounts=accountsSnap.docs.map((d:any)=>({accountId:d.id,...d.data()})).sort((a:any,b:any)=>String(a.name).localeCompare(String(b.name)));
    const ledger=ledgerSnap.docs.map((d:any)=>({lineId:d.id,...d.data()})).sort((a:any,b:any)=>`${b.date}:${b.voucherNumber||""}:${b.lineNo||0}`.localeCompare(`${a.date}:${a.voucherNumber||""}:${a.lineNo||0}`)).slice(0,300);
    return NextResponse.json({success:true,financialYearId:fyId,accounts:enriched,glAccounts,ledger,hasMoreLedger:ledgerSnap.size>300});
  }catch(e:any){return fail(e?.message||"Unable to load cash and bank data.",e?.status||500);}
}

export async function POST(request:Request){
  try{
    const {db,token}=await auth(request);const body=await request.json() as Record<string,any>;const businessId=String(body.businessId||"").trim();if(!businessId)return fail("Business ID is required.");
    const member=await membership(db,businessId,token.uid);const action=String(body.action||"") as "entry"|"transfer"|"account"|"account_update"|"account_status"|"reverse"|"";
    if(["entry","transfer","account"].includes(action)&&!allowed(member,"create"))return fail("Cash & Bank create permission denied.",403);
    if(["account_update","account_status","reverse"].includes(action)&&!allowed(member,"edit"))return fail("Cash & Bank edit permission denied.",403);
    const ref=businessRef(db,businessId),repo=createAdminAccountingRepository(businessId),financialYearId=String(body.financialYearId||await currentFy(db,businessId));

    if(action==="entry"){
      const accountId=String(body.accountId||""),snap=await ref.collection("bankAccounts").doc(accountId).get();if(!snap.exists)return fail("Cash/bank account not found.");const account=snap.data() as any;if(account.status!=="active")return fail("Cash/bank account is inactive.");
      const {minor}=positiveRupees(body.amount);const result=await postCashBankEntry(repo,{businessId,financialYearId,date:String(body.date||""),userId:token.uid,idempotencyKey:key(body),accountId,ledgerAccountId:String(account.ledgerAccountId||""),type:body.type,amount:minor,contraAccountId:String(body.contraAccountId||""),narration:String(body.name||"Cash/Bank transaction"),reference:String(body.reference||""),notes:String(body.notes||"")},deps());
      return NextResponse.json({success:true,result});
    }

    if(action==="transfer"){
      const fromId=String(body.fromAccountId||""),toId=String(body.toAccountId||"");if(fromId===toId)return fail("Source and destination accounts must be different.");
      const [fromSnap,toSnap]=await Promise.all([ref.collection("bankAccounts").doc(fromId).get(),ref.collection("bankAccounts").doc(toId).get()]);if(!fromSnap.exists||!toSnap.exists)return fail("Both cash/bank accounts are required.");
      const from=fromSnap.data() as any,to=toSnap.data() as any;if(from.status!=="active"||to.status!=="active")return fail("Both cash/bank accounts must be active.");
      const {minor}=positiveRupees(body.amount);const result=await postCashBankTransfer(repo,{businessId,financialYearId,date:String(body.date||""),userId:token.uid,idempotencyKey:key(body),fromAccountId:fromId,fromLedgerAccountId:String(from.ledgerAccountId||""),toAccountId:toId,toLedgerAccountId:String(to.ledgerAccountId||""),amount:minor,narration:String(body.notes||"Cash/Bank transfer"),reference:String(body.reference||""),notes:String(body.notes||"")},deps());
      return NextResponse.json({success:true,result});
    }

    if(action==="account"){
      const kind=body.kind==="cash"?"cash":"bank",name=String(body.displayName||"").trim();if(!name)return fail("Account name is required.");
      const {minor}=nonNegativeRupees(body.openingBalance===undefined?0:body.openingBalance,"Opening balance");
      const accountId=`${kind}-${randomUUID()}`,ledgerAccountId=`cashbank-${randomUUID()}`,now=Timestamp.now();
      const parentId=kind==="cash"?"acct-cash":"acct-bank";const parentSnap=await ref.collection("accounts").doc(parentId).get();if(!parentSnap.exists||parentSnap.data()?.type!=="asset")return fail("Cash/Bank parent account is not configured.");
      const normalizedDate=String(body.openingBalanceDate||new Date().toISOString().slice(0,10));if(!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate))return fail("Opening balance date must be YYYY-MM-DD.");
      const batch=db.batch();batch.set(ref.collection("accounts").doc(ledgerAccountId),{id:ledgerAccountId,businessId,code:`CB-${Date.now()}`,name,type:"asset",parentId,systemAccount:false,active:true,openingDebit:minor,openingCredit:0,createdAt:now.toDate().toISOString(),updatedAt:now.toDate().toISOString()});
      batch.set(ref.collection("bankAccounts").doc(accountId),{businessId,accountId,displayName:name,kind,ledgerAccountId,openingBalance:minor,openingBalanceDate:normalizedDate,currentBalance:minor,printQrOnInvoice:Boolean(body.printQrOnInvoice),printDetailsOnInvoice:Boolean(body.printDetailsOnInvoice),accountNumber:String(body.accountNumber||""),ifscCode:String(body.ifscCode||""),upiId:String(body.upiId||""),bankName:String(body.bankName||""),accountHolderName:String(body.accountHolderName||""),status:"active",createdBy:token.uid,createdAt:now,updatedAt:now});
      batch.set(ref.collection("auditLogs").doc(`audit-${randomUUID()}`),{businessId,entityType:"cash_bank_account",entityId:accountId,action:"ACCOUNT_CREATED",userId:token.uid,timestamp:now.toDate().toISOString(),after:{accountId,ledgerAccountId,displayName:name,kind,status:"active",openingBalance:minor}});await batch.commit();
      return NextResponse.json({success:true,accountId,ledgerAccountId});
    }

    if(action==="account_update"){
      const accountId=String(body.accountId||"");const snap=await ref.collection("bankAccounts").doc(accountId).get();if(!snap.exists)return fail("Cash/bank account not found.");const before=snap.data() as any;
      const patch={businessId,accountId,displayName:String(body.displayName??before.displayName).trim(),bankName:String(body.bankName??before.bankName??""),accountNumber:String(body.accountNumber??before.accountNumber??""),ifscCode:String(body.ifscCode??before.ifscCode??""),upiId:String(body.upiId??before.upiId??""),accountHolderName:String(body.accountHolderName??before.accountHolderName??""),printQrOnInvoice:body.printQrOnInvoice===undefined?Boolean(before.printQrOnInvoice):Boolean(body.printQrOnInvoice),printDetailsOnInvoice:body.printDetailsOnInvoice===undefined?Boolean(before.printDetailsOnInvoice):Boolean(body.printDetailsOnInvoice),updatedAt:Timestamp.now()};
      if(!patch.displayName)return fail("Account name is required.");await ref.collection("bankAccounts").doc(accountId).set(patch,{merge:true});await ref.collection("auditLogs").doc(`audit-${randomUUID()}`).set({businessId,entityType:"cash_bank_account",entityId:accountId,action:"ACCOUNT_UPDATED",userId:token.uid,timestamp:new Date().toISOString(),before,after:patch});
      return NextResponse.json({success:true});
    }

    if(action==="account_status"){
      const accountId=String(body.accountId||""),status=String(body.status||"");if(!["active","inactive"].includes(status))return fail("Account status must be active or inactive.");const snap=await ref.collection("bankAccounts").doc(accountId).get();if(!snap.exists)return fail("Cash/bank account not found.");const before=snap.data() as any;await ref.collection("bankAccounts").doc(accountId).set({businessId,accountId,status,updatedAt:Timestamp.now()},{merge:true});await ref.collection("auditLogs").doc(`audit-${randomUUID()}`).set({businessId,entityType:"cash_bank_account",entityId:accountId,action:status==="active"?"ACCOUNT_ACTIVATED":"ACCOUNT_DEACTIVATED",userId:token.uid,timestamp:new Date().toISOString(),before,after:{...before,status}});return NextResponse.json({success:true,status});
    }

    if(action==="reverse"){
      const voucherId=String(body.voucherId||"");const voucherSnap=await ref.collection("vouchers").doc(voucherId).get();if(!voucherSnap.exists)return fail("Voucher not found.");const voucher=voucherSnap.data() as any;
      if(voucher.businessId!==businessId)return fail("Voucher does not belong to this business.",403);if(!["cash_bank","cash_bank_transfer"].includes(String(voucher.referenceType||"")))return fail("Only Cash & Bank vouchers can be reversed from this module.",403);if(!["RECEIPT","PAYMENT","CONTRA"].includes(String(voucher.voucherType||"")))return fail("Only Cash & Bank receipt, payment and contra vouchers can be reversed here.",403);
      const originalFy=String(voucher.financialYearId||"");if(!originalFy)return fail("Voucher has no financial year.");const reversalDate=String(body.date||new Date().toISOString().slice(0,10));const result=await reversePostedVoucher(repo,{businessId,financialYearId:originalFy,voucherId,userId:token.uid,idempotencyKey:key(body),date:reversalDate,narration:String(body.narration||`Cash/Bank transaction reversal of ${voucher.voucherNumber||voucherId}`)},deps());return NextResponse.json({success:true,result});
    }
    return fail("Unknown Cash & Bank action.");
  }catch(e:any){return fail(e?.message||"Cash & Bank operation failed.",e?.status||400);}
}
