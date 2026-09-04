import { NextResponse } from "next/server";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { resolveFinancialYear } from "@/core/accounting/financialYear";
import { POST as postSale } from "@/app/api/accounting/sales/route";
import { POST as postPurchase } from "@/app/api/accounting/purchases/route";
import { POST as postExpense } from "@/app/api/accounting/expenses/route";
import { POST as postReceipt } from "@/app/api/accounting/payment-in/route";
import { POST as postPayment } from "@/app/api/accounting/payments/route";
import { POST as postSaleReturn } from "@/app/api/accounting/sales-return/route";
import { POST as postPurchaseReturn } from "@/app/api/accounting/purchase-return/route";

export const runtime = "nodejs";
type CommandType = "SALE_CREATE"|"PURCHASE_CREATE"|"RECEIPT_CREATE"|"PAYMENT_CREATE"|"EXPENSE_CREATE"|"SALE_RETURN_CREATE"|"PURCHASE_RETURN_CREATE";
const handlers: Partial<Record<CommandType,(request:Request)=>Promise<Response>>> = { SALE_CREATE:postSale, PURCHASE_CREATE:postPurchase, RECEIPT_CREATE:postReceipt, PAYMENT_CREATE:postPayment, EXPENSE_CREATE:postExpense, SALE_RETURN_CREATE:postSaleReturn, PURCHASE_RETURN_CREATE:postPurchaseReturn };
const error=(message:string,status=400)=>NextResponse.json({success:false,error:message},{status});

export async function POST(request:Request){
  try{
    const {auth,db}=getAdminServices();
    const authHeader=request.headers.get("authorization")??"";
    if(!authHeader.startsWith("Bearer ")) return error("Authentication is required.",401);
    const token=await auth.verifyIdToken(authHeader.slice(7));
    const body=await request.json() as Record<string,unknown>;
    const rawCommand=String(body.commandType??"").toUpperCase();
    const data=(body.payload&&typeof body.payload==="object"?body.payload:{}) as Record<string,unknown>;
    const commandType:CommandType=rawCommand==="RETURN_CREATE" ? (String(data.type??data.returnType??"SALE_RETURN").toUpperCase().includes("PURCHASE") ? "PURCHASE_RETURN_CREATE" : "SALE_RETURN_CREATE") : rawCommand as CommandType;
    const handler=handlers[commandType];
    if(!handler) return error(`Unsupported synchronization command: ${rawCommand||"unknown"}.`,422);
    const businessId=String(body.businessId??"").trim(), financialYearId=String(body.financialYearId??"").trim(), idempotencyKey=String(body.idempotencyKey??"").trim(), operationId=String(body.operationId??"").trim(), deviceId=String(body.deviceId??"").trim();
    if(!businessId||!financialYearId||!idempotencyKey||!operationId||!deviceId||!Object.keys(data).length) return error("businessId, financialYearId, idempotencyKey, operationId, deviceId and payload are required.");
    if(idempotencyKey.length<16||idempotencyKey.length>128||operationId.length>128||deviceId.length>128) return error("Invalid synchronization metadata.");
    const businessRef=db.collection("businesses").doc(businessId);
    const membershipSnap=await businessRef.collection("members").doc(token.uid).get();
    if(!membershipSnap.exists) return error("You are not a member of this business.",403);
    if(String((membershipSnap.data() as {status?:string}).status??"")!=="active") return error("Your business membership is not active.",403);
    if(String(data.businessId??businessId)!==businessId) return error("Payload business does not match synchronization context.",403);
    if(String(data.financialYearId??financialYearId)!==financialYearId) return error("Payload financial year does not match synchronization context.",409);
    const date=typeof data.date==="string"?data.date:undefined;
    if(date){
      const businessSnap=await businessRef.get();
      if(!businessSnap.exists) return error("Business does not exist.",404);
      const startMonth=Number((businessSnap.data() as {financialYearStartMonth?:number}).financialYearStartMonth??4);
      if(resolveFinancialYear(date,startMonth).id!==financialYearId) return error("Financial year does not match the transaction date.",409);
    }
    const delegatedPayload={...data,businessId,financialYearId,idempotencyKey,deviceId,operationId,syncCommandId:String(body.commandId??operationId)};
    const delegated=new Request(request.url,{method:"POST",headers:{authorization:authHeader,"content-type":"application/json","x-busy-soft-sync":"1","x-busy-soft-operation-id":operationId},body:JSON.stringify(delegatedPayload)});
    const response=await handler(delegated);
    const responseBody=await response.text();
    return new NextResponse(responseBody,{status:response.status,headers:{"content-type":response.headers.get("content-type")??"application/json"}});
  }catch(cause){
    const message=cause instanceof Error?cause.message:"Synchronization failed.";
    return error(message,/token|authentication|credential/i.test(message)?401:500);
  }
}
