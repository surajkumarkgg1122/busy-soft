import type { Firestore } from "firebase/firestore";
import { collection, doc, getDoc, getDocs, query, where, Timestamp, setDoc } from "firebase/firestore";
import type { AccountingRepository, Account, Money, PostingResult } from "../../core/accounting/types";
import { postSaleReturn } from "../../core/accounting/returns";
import { createFirestoreAccountingRepository } from "../../core/accounting/firestoreRepository";
import { ValidationError } from "../../core/accounting/errors";

export interface SalesReturnItem { itemId: string; quantity: number; unitCost: Money; warehouseId?: string; }
export interface CreateSalesReturnCommand { businessId: string; financialYearId: string; userId: string; date: string; partyId: string; taxableValue: Money; taxRate: number; intraState: boolean; cessRate?: number; items: SalesReturnItem[]; narration?: string; }

const accounts: Array<{ id:string; code:string; name:string; type:Account["type"] }> = [
 {id:"acct-debtors",code:"1200",name:"Sundry Debtors",type:"asset"},{id:"acct-sales-return",code:"4010",name:"Sales Return",type:"income"},
 {id:"acct-output-cgst",code:"2101",name:"Output CGST",type:"liability"},{id:"acct-output-sgst",code:"2102",name:"Output SGST",type:"liability"},{id:"acct-output-igst",code:"2103",name:"Output IGST",type:"liability"},{id:"acct-output-cess",code:"2104",name:"Output Cess",type:"liability"}
];

async function ensureSetup(db:Firestore,businessId:string,financialYearId:string,date:string){
 const base=doc(db,"businesses",businessId); const fyRef=doc(base,"financialYears",financialYearId); if(!(await getDoc(fyRef)).exists()){const y=Number(date.slice(0,4));const m=Number(date.slice(5,7));const start=m>=4?y:y-1;await setDoc(fyRef,{id:financialYearId,businessId,name:`FY ${start}-${String(start+1).slice(-2)}`,startDate:`${start}-04-01`,endDate:`${start+1}-03-31`,locked:false,createdAt:Timestamp.now(),updatedAt:Timestamp.now()});}
 const now=Timestamp.now(); await Promise.all(accounts.map(async a=>{const r=doc(base,"accounts",a.id);if(!(await getDoc(r)).exists())await setDoc(r,{id:a.id,businessId,...a,parentId:null,systemAccount:true,active:true,openingDebit:0,openingCredit:0,createdAt:now.toDate().toISOString(),updatedAt:now.toDate().toISOString()});}));
}

export async function createSalesReturn(db:Firestore,command:CreateSalesReturnCommand):Promise<PostingResult>{
 if(!command.partyId)throw new ValidationError("Customer is required for a sales return."); if(!command.items.length)throw new ValidationError("At least one return item is required."); if(command.items.some(x=>!x.itemId||!Number.isFinite(x.quantity)||x.quantity<=0))throw new ValidationError("Every return item must have a valid quantity.");
 await ensureSetup(db,command.businessId,command.financialYearId,command.date); const accounting=createFirestoreAccountingRepository(db,command.businessId); const deps={ids:{next:(p:string)=>`${p}-${crypto.randomUUID()}`},clock:{now:()=>new Date().toISOString()}};
 return postSaleReturn(accounting,{businessId:command.businessId,financialYearId:command.financialYearId,date:command.date,userId:command.userId,partyId:command.partyId,taxableValue:command.taxableValue,taxRate:command.taxRate,intraState:command.intraState,cessRate:command.cessRate,accountMap:{party:"acct-debtors",sales:"acct-sales-return",outputCgst:"acct-output-cgst",outputSgst:"acct-output-sgst",outputIgst:"acct-output-igst",outputCess:"acct-output-cess"},itemMovements:command.items,narration:command.narration},deps);
}
