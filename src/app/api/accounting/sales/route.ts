import { NextResponse } from "next/server";
import { doc, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { createSale } from "@/application/sales/service";
import type { AccountingPermission } from "@/core/accounting/authorization";

export const runtime = "nodejs";

const accountDefaults = [
  ["acct-cash","1000","Cash","asset"],["acct-bank","1010","Bank","asset"],["acct-debtors","1200","Sundry Debtors","asset"],["acct-sales","4000","Sales","income"],
  ["acct-output-cgst","2101","Output CGST","liability"],["acct-output-sgst","2102","Output SGST","liability"],["acct-output-igst","2103","Output IGST","liability"],["acct-output-cess","2104","Output Cess","liability"],
  ["acct-inventory","1300","Inventory","asset"],["acct-cogs","5000","Cost of Goods Sold","expense"]
] as const;

function jsonError(message:string,status:number){return NextResponse.json({success:false,error:message},{status});}
function fyFor(date:string){const y=Number(date.slice(0,4)),m=Number(date.slice(5,7)),start=m>=4?y:y-1;return{id:`fy-${start}-${String(start+1).slice(-2)}`,name:`FY ${start}-${String(start+1).slice(-2)}`,startDate:`${start}-04-01`,endDate:`${start+1}-03-31`};}
async function ensureSalesSetup(businessId:string,date:string){
  const fy=fyFor(date);const now=Timestamp.now();const fyRef=doc(adminDb,"businesses",businessId,"financialYears",fy.id);const fySnap=await fyRef.get();
  if(!fySnap.exists)await fyRef.set({id:fy.id,businessId,...fy,locked:false,createdAt:now,updatedAt:now});
  await Promise.all(accountDefaults.map(async([id,code,name,type])=>{const r=doc(adminDb,"businesses",businessId,"accounts",id);const s=await r.get();if(!s.exists)await r.set({id,businessId,code,name,type,parentId:null,systemAccount:true,active:true,openingDebit:0,openingCredit:0,createdAt:now.toDate().toISOString(),updatedAt:now.toDate().toISOString()});}));
  return fy.id;
}

export async function POST(request:Request){
  try{
    const authHeader=request.headers.get("authorization")||"";if(!authHeader.startsWith("Bearer "))return jsonError("Authentication is required.",401);
    const token=await adminAuth.verifyIdToken(authHeader.slice(7));const body=await request.json() as Record<string,unknown>;
    const businessId=String(body.businessId??"");if(!businessId)return jsonError("Business ID is required.",400);
    const membershipSnap=await doc(adminDb,"businesses",businessId,"members",token.uid).get();if(!membershipSnap.exists)return jsonError("You are not a member of this business.",403);
    const membership=membershipSnap.data() as {status?:string;role?:string;permissions?:Record<string,unknown>};if(membership.status!=="active")return jsonError("Your business membership is not active.",403);
    const salesPermissions=(membership.permissions?.sales??{}) as Record<string,unknown>;const allowed=membership.role==="owner"||membership.role==="admin"||salesPermissions.create===true;
    if(!allowed)return jsonError("Permission denied: SALE_CREATE.",403);
    const date=String(body.date??"");const financialYearId=await ensureSalesSetup(businessId,date);
    const repo=createAdminAccountingRepository(businessId);const idempotencyKey=String(body.idempotencyKey??`sale-${businessId}-${crypto.randomUUID()}`);const documentId=String(body.documentId??"")||undefined;
    const result=await createSale({repo,ids:{next:p=>`${p}-${crypto.randomUUID()}`},clock:{now:()=>new Date().toISOString()}},{businessId,userId:token.uid,financialYearId,idempotencyKey,permissions:["SALE_CREATE" as AccountingPermission]},{
      date,customerId:typeof body.customerId==="string"&&body.customerId?body.customerId:undefined,paymentMode:body.paymentMode as "cash"|"bank"|"credit",grossValue:Number(body.grossValue),discountPercent:Number(body.discountPercent??0),discountAmount:Number(body.discountAmount??0),paidAmount:Number(body.paidAmount??0),bankAccountId:typeof body.bankAccountId==="string"&&body.bankAccountId?body.bankAccountId:undefined,taxRate:Number(body.taxRate??0),intraState:Boolean(body.intraState),cessRate:Number(body.cessRate??0),accountMap:{party:"acct-debtors",sales:"acct-sales",cash:"acct-cash",bank:(typeof body.bankAccountId==="string"&&body.bankAccountId)||"acct-bank",outputCgst:"acct-output-cgst",outputSgst:"acct-output-sgst",outputIgst:"acct-output-igst",outputCess:"acct-output-cess",inventory:"acct-inventory",cogs:"acct-cogs"},itemMovements:Array.isArray(body.itemMovements)?body.itemMovements as Array<{itemId:string;quantity:number;warehouseId?:string}>:[],narration:typeof body.narration==="string"?body.narration:undefined,documentId,documentPayload:body.documentPayload&&typeof body.documentPayload==="object"?body.documentPayload as Record<string,unknown>:undefined
    });
    return NextResponse.json({success:true,result});
  }catch(error){const message=error instanceof Error?error.message:"Could not post sale.";const status=/permission|member|authentication/i.test(message)?403:400;return jsonError(message,status);}
}
