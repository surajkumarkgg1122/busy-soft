import type { Firestore } from "firebase/firestore";
import { doc, getDoc, setDoc, Timestamp } from "firebase/firestore";
import type { ReturnAccounts, ReturnItem } from "@/core/accounting/returns";
import { postSaleReturn } from "@/core/accounting/returns";
import type { AccountingRepository, PostingResult, Account } from "@/core/accounting/types";
import { createFirestoreAccountingRepository } from "@/core/accounting/firestoreRepository";
import { ValidationError } from "@/core/accounting/errors";

export interface SalesReturnContext { businessId:string; userId:string; financialYearId:string; idempotencyKey:string; }
export interface CreateSalesReturnInput { date:string; partyId:string; originalVoucherId:string; items:ReturnItem[]; taxRate:number; intraState:boolean; cessRate?:number; narration?:string; taxableValue?:number; documentId?:string; }
const accounts:Array<{id:string;code:string;name:string;type:Account["type"]}>=[
 {id:"acct-debtors",code:"1200",name:"Sundry Debtors",type:"asset"},
 {id:"acct-sales-return",code:"4010",name:"Sales Return",type:"contra_revenue"},
 {id:"acct-output-cgst",code:"2101",name:"Output CGST",type:"liability"},
 {id:"acct-output-sgst",code:"2102",name:"Output SGST",type:"liability"},
 {id:"acct-output-igst",code:"2103",name:"Output IGST",type:"liability"},
 {id:"acct-output-cess",code:"2104",name:"Output Cess",type:"liability"},
];
async function ensure(db:Firestore,businessId:string,date:string){const base=doc(db,"businesses",businessId);const y=Number(date.slice(0,4)),m=Number(date.slice(5,7)),start=m>=4?y:y-1;const fyId=`fy-${start}-${String(start+1).slice(-2)}`;const fyRef=doc(base,"financialYears",fyId);if(!(await getDoc(fyRef)).exists())await setDoc(fyRef,{id:fyId,businessId,name:`FY ${start}-${String(start+1).slice(-2)}`,startDate:`${start}-04-01`,endDate:`${start+1}-03-31`,locked:false,createdAt:Timestamp.now(),updatedAt:Timestamp.now()});const now=Timestamp.now();for(const a of accounts){const r=doc(base,"accounts",a.id);if(!(await getDoc(r)).exists())await setDoc(r,{id:a.id,businessId,...a,parentId:null,systemAccount:true,active:true,openingDebit:0,openingCredit:0,createdAt:now.toDate().toISOString(),updatedAt:now.toDate().toISOString()});}return fyId}
export async function createSalesReturn(db:Firestore,ctx:SalesReturnContext,input:CreateSalesReturnInput):Promise<PostingResult>{if(!ctx.businessId||!ctx.userId||!ctx.financialYearId)throw new ValidationError("Authenticated business, user and financial year are required.");if(!ctx.idempotencyKey)throw new ValidationError("Idempotency key is required.");if(!input.partyId||!input.originalVoucherId)throw new ValidationError("Party and original sale are required.");if(!input.items.length)throw new ValidationError("At least one return item is required.");const financialYearId=await ensure(db,ctx.businessId,input.date);if(financialYearId!==ctx.financialYearId)throw new ValidationError("Return date does not belong to the active financial year.");const repo=createFirestoreAccountingRepository(db,ctx.businessId);return postSaleReturn(repo,{businessId:ctx.businessId,financialYearId,date:input.date,userId:ctx.userId,partyId:input.partyId,originalVoucherId:input.originalVoucherId,items:input.items,taxableValue:input.taxableValue,taxRate:input.taxRate,intraState:input.intraState,cessRate:input.cessRate,narration:input.narration,idempotencyKey:ctx.idempotencyKey,accountMap:{party:"acct-debtors",salesReturn:"acct-sales-return",outputCgst:"acct-output-cgst",outputSgst:"acct-output-sgst",outputIgst:"acct-output-igst",outputCess:"acct-output-cess"}}, {ids:{next:p=>`${p}-${crypto.randomUUID()}`},clock:{now:()=>new Date().toISOString()}})}
