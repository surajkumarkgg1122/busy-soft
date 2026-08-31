import { NextResponse } from "next/server";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { postPayment, postReceipt } from "@/core/accounting/transactions";
import { ValidationError } from "@/core/accounting/errors";

aexport const runtime = "nodejs";

type Membership = { status?: string; role?: string; permissions?: Record<string, unknown> };
type AdminDb = ReturnType<typeof getAdminServices>["db"];
const DEFAULT_PARTY_ACCOUNT = "acct-debtors";
const DEFAULT_CASH_ACCOUNT = "acct-cash";
const DEFAULT_BANK_ACCOUNT = "acct-bank";

function jsonError(message:string,status:number){return NextResponse.json({success:false,error:message},{status});}
function financialYearId(date:string){const year=Number(date.slice(0,4));const month=Number(date.slice(5,7));const start=month>=4?year:year-1;return `fy-${start}-${String(start+1).slice(-2)}`;}
async function authorize(request:Request,businessId:string,action:"view"|"create"){
  const {auth,db}=getAdminServices();const header=request.headers.get("authorization")??"";if(!header.startsWith("Bearer "))throw new Error("AUTH_REQUIRED");
  const token=await auth.verifyIdToken(header.slice(7));if(!businessId)throw new Error("BUSINESS_REQUIRED");const businessRef=db.collection("businesses").doc(businessId);
  const membershipSnap=await businessRef.collection("members").doc(token.uid).get();if(!membershipSnap.exists)throw new Error("NOT_MEMBER");const membership=membershipSnap.data() as Membership;if(membership.status!=="active")throw new Error("INACTIVE_MEMBER");
  const permissions=(membership.permissions?.payments??{}) as Record<string,unknown>;const legacy=membership.permissions?.payments===true;if(!(membership.role==="owner"||membership.role==="admin"||permissions[action]===true||legacy))throw new Error("PERMISSION_DENIED");
  return{db,businessRef,userId:token.uid};
}
async function normalizeAccountName(db:AdminDb,businessId:string,accountId:string){
  const snap=await db.collection("businesses").doc(businessId).collection("accounts").doc(accountId).get();if(!snap.exists)throw new ValidationError("Selected payment account does not exist.");
  const account=snap.data() as {name?:string;type?:string;active?:boolean};if(account.active===false)throw new ValidationError("Selected payment account is inactive.");if(account.type!=="asset")throw new ValidationError("Payment account must be an asset account.");return String(account.name??accountId);
}
export async function GET(request:Request){
  try{
    const url=new URL(request.url);const businessId=url.searchParams.get("businessId")?.trim()??"";const {businessRef}=await authorize(request,businessId,"view");
    const [customersSnap,vouchersSnap]=await Promise.all([businessRef.collection("customers").get(),businessRef.collection("vouchers").where("voucherType","in",["RECEIPT","PAYMENT"]).get()]);
    const customerMap=new Map(customersSnap.docs.map(doc=>[doc.id,String(doc.data().name??"")]));const voucherLinesSnap=await businessRef.collection("voucherLines").get();const linesByVoucher=new Map<string,Array<Record<string,unknown>>>();
    for(const lineDoc of voucherLinesSnap.docs){const data=lineDoc.data() as Record<string,unknown>;const voucherId=String(data.voucherId??"");if(!voucherId)continue;const list=linesByVoucher.get(voucherId)??[];list.push(data);linesByVoucher.set(voucherId,list);}
    const transactions=vouchersSnap.docs.map(doc=>{const voucher=doc.data() as Record<string,unknown>;const lines=linesByVoucher.get(doc.id)??[];const partyLine=lines.find(line=>typeof line.partyId==="string"&&line.partyId);const partyId=partyLine?.partyId?String(partyLine.partyId):"";return{id:doc.id,voucherNumber:String(voucher.voucherNumber??""),date:String(voucher.date??""),direction:voucher.voucherType==="RECEIPT"?"in":"out",amount:Number(voucher.totalDebit??voucher.totalCredit??0),customerId:partyId||null,customerName:partyId?customerMap.get(partyId)??"Customer":"",method:String(voucher.narration??""),status:String(voucher.status??"posted"),voucherType:String(voucher.voucherType??"")};}).sort((a,b)=>`${b.date}:${b.voucherNumber}`.localeCompare(`${a.date}:${a.voucherNumber}`));
    return NextResponse.json({success:true,data:{customers:customersSnap.docs.map(doc=>({id:doc.id,...doc.data()})),transactions}});
  }catch(error){const message=error instanceof Error?error.message:"Could not load payments.";const status=/AUTH|required.*token|credential/i.test(message)?401:/MEMBER|PERMISSION|INACTIVE/.test(message)?403:/BUSINESS/.test(message)?400:500;return jsonError(status===500?"Could not load payments.":message.replaceAll("_"," "),status);}
}
export async function POST(request:Request){
  try{
    const body=await request.json() as Record<string,unknown>;const businessId=String(body.businessId??"");const date=String(body.date??"");const customerId=String(body.customerId??"");const direction=String(body.direction??"") as "in"|"out";const amountMinor=Number(body.amountMinor??0);const paymentMethod=String(body.method??"Cash");const bankAccountId=typeof body.bankAccountId==="string"&&body.bankAccountId?body.bankAccountId:undefined;const note=typeof body.note==="string"?body.note.trim():"";const idempotencyKey=String(body.idempotencyKey??"");
    const {db,userId}=await authorize(request,businessId,"create");
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new ValidationError("Payment date must be YYYY-MM-DD.");if(!customerId)throw new ValidationError("Customer is required.");if(!["in","out"].includes(direction))throw new ValidationError("Invalid payment direction.");
    if(!Number.isSafeInteger(amountMinor)||amountMinor<=0)throw new ValidationError("Payment amount must be a positive integer minor-unit amount.");if(!idempotencyKey)throw new ValidationError("Idempotency key is required.");
    const fyId=financialYearId(date);const businessRef=db.collection("businesses").doc(businessId);const customerSnap=await businessRef.collection("customers").doc(customerId).get();if(!customerSnap.exists)throw new ValidationError("Customer does not exist.");
    const fySnap=await businessRef.collection("financialYears").doc(fyId).get();if(!fySnap.exists)throw new ValidationError(`Financial year ${fyId} does not exist. Configure the financial year before posting payments.`);
    const bankAccount=bankAccountId??DEFAULT_BANK_ACCOUNT;const cashName=await normalizeAccountName(db,businessId,DEFAULT_CASH_ACCOUNT);let bankName="";if(paymentMethod.toLowerCase()!=="cash")bankName=await normalizeAccountName(db,businessId,bankAccount);
    const repo=createAdminAccountingRepository(businessId);const deps={ids:{next:(prefix:string)=>`${prefix}-${crypto.randomUUID()}`},clock:{now:()=>new Date().toISOString()}};const accountMap={party:DEFAULT_PARTY_ACCOUNT,cash:DEFAULT_CASH_ACCOUNT,bank:bankAccount};
    const narration=[paymentMethod,note].filter(Boolean).join(" · ");
    const result=direction==="in"?await postReceipt(repo,{businessId,financialYearId:fyId,date,userId,partyId:customerId,amount:amountMinor,mode:paymentMethod.toLowerCase()==="cash"?"cash":"bank",accountMap,idempotencyKey,narration:narration||undefined},deps):await postPayment(repo,{businessId,financialYearId:fyId,date,userId,partyId:customerId,amount:amountMinor,mode:paymentMethod.toLowerCase()==="cash"?"cash":"bank",accountId:DEFAULT_PARTY_ACCOUNT,accountMap,idempotencyKey,narration:narration||undefined},deps);
    return NextResponse.json({success:true,result:{voucher:result.voucher,customer:{id:customerId,name:String(customerSnap.data()?.name??"")},accountName:paymentMethod.toLowerCase()==="cash"?cashName:bankName}});
  }catch(error){const message=error instanceof Error?error.message:"Could not post payment.";const status=/AUTH|required.*business|date|amount|customer|account|financial year/i.test(message)?400:/permission|member/i.test(message)?403:/duplicate|idempotency/i.test(message)?409:500;return jsonError(message,status);}
}
