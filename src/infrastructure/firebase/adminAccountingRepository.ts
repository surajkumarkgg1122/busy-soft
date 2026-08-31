import "server-only";
import { collection, doc, type Firestore, type Transaction } from "firebase-admin/firestore";
import type { AccountingRepository, AccountingTransaction, Account, AtomicAccountingDocument, AuditEvent, FinancialYear, LedgerEntry, PartyAllocation, ReturnDocument, StockMovement, Voucher, VoucherLine } from "@/core/accounting/types";
import { ValidationError } from "@/core/accounting/errors";
import { getAdminServices } from "./admin";

const id=(value:string,name:string)=>{if(!value||typeof value!=="string")throw new ValidationError(`${name} is required.`);return value;};
const ref=(db:Firestore,businessId:string,name:string,key:string)=>doc(db,"businesses",id(businessId,"Business ID"),id(name,"Collection"),id(key,`Document ID for ${name}`));
const col=(db:Firestore,businessId:string,name:string)=>collection(db,"businesses",id(businessId,"Business ID"),id(name,"Collection"));
const toAccount=(data:Record<string,unknown>,accountId:string):Account=>({id:accountId,businessId:String(data.businessId??""),code:String(data.code??""),name:String(data.name??""),type:data.type as Account["type"],parentId:(data.parentId as string|null|undefined)??null,systemAccount:Boolean(data.systemAccount),active:data.active!==false,openingDebit:Number(data.openingDebit??0),openingCredit:Number(data.openingCredit??0),createdAt:String(data.createdAt??""),updatedAt:String(data.updatedAt??"")});

class AdminAccountingTransaction implements AccountingTransaction {
  constructor(private readonly db:Firestore,private readonly tx:Transaction,private readonly businessId:string){id(businessId,"Business ID");}
  async getFinancialYear(key:string){const s=await this.tx.get(ref(this.db,this.businessId,"financialYears",key));return s.exists?(s.data() as FinancialYear):null;}
  async getAccount(key:string){const s=await this.tx.get(ref(this.db,this.businessId,"accounts",key));return s.exists?toAccount((s.data()??{}) as Record<string,unknown>,s.id):null;}
  async getVoucher(key:string){const s=await this.tx.get(ref(this.db,this.businessId,"vouchers",key));return s.exists?(s.data() as Voucher):null;}
  async getVoucherLines(voucherId:string){const s=await this.tx.get(col(this.db,this.businessId,"voucherLines").where("voucherId","==",id(voucherId,"Voucher ID")));return s.docs.map(d=>d.data() as VoucherLine).sort((a,b)=>a.lineNo-b.lineNo);}
  async getVouchersByReference(referenceType:string,referenceId:string){const s=await this.tx.get(col(this.db,this.businessId,"vouchers").where("referenceType","==",referenceType).where("referenceId","==",referenceId));return s.docs.map(d=>d.data() as Voucher).filter(v=>v.status==="posted");}
  async getVoucherByIdempotencyKey(businessId:string,financialYearId:string,key:string){if(businessId!==this.businessId)return null;const s=await this.tx.get(col(this.db,this.businessId,"vouchers").where("financialYearId","==",financialYearId).where("idempotencyKey","==",key));return s.docs[0]?.data() as Voucher|undefined??null;}
  async getAtomicDocumentByIdempotencyKey(businessId:string,financialYearId:string,key:string){if(businessId!==this.businessId)return null;const s=await this.tx.get(col(this.db,this.businessId,"accountingDocuments").where("financialYearId","==",financialYearId).where("idempotencyKey","==",key));return s.docs[0]?.data() as AtomicAccountingDocument|undefined??null;}
  async getStockMovementsForSource(sourceId:string){const s=await this.tx.get(col(this.db,this.businessId,"stockMovements").where("sourceId","==",id(sourceId,"Stock source ID")));return s.docs.map(d=>d.data() as StockMovement);}
  async getStockMovementsForItem(itemId:string,warehouseId?:string,throughDate?:string){let q=col(this.db,this.businessId,"stockMovements").where("itemId","==",id(itemId,"Item ID"));if(warehouseId)q=q.where("warehouseId","==",warehouseId);const s=await this.tx.get(q);return s.docs.map(d=>d.data() as StockMovement).filter(m=>!throughDate||m.date<=throughDate).sort((a,b)=>`${a.date}:${a.createdAt}:${a.id}`.localeCompare(`${b.date}:${b.createdAt}:${b.id}`));}
  async getPartyAllocationsForVoucher(voucherId:string){const key=id(voucherId,"Voucher ID");const a=await this.tx.get(col(this.db,this.businessId,"partyAllocations").where("fromVoucherId","==",key));const b=await this.tx.get(col(this.db,this.businessId,"partyAllocations").where("toVoucherId","==",key));const map=new Map<string,PartyAllocation>();for(const d of [...a.docs,...b.docs])map.set(d.id,d.data() as PartyAllocation);return [...map.values()];}
  async getBusinessDocument(name:string,key:string){if(!/^[A-Za-z0-9_-]{1,64}$/.test(name))throw new ValidationError("Invalid business document collection.");const s=await this.tx.get(ref(this.db,this.businessId,name,key));return s.exists?(s.data() as Record<string,unknown>):null;}
  async saveVoucher(v:Voucher){this.tx.set(ref(this.db,this.businessId,"vouchers",v.id),v);}
  async saveVoucherLines(lines:VoucherLine[]){for(const v of lines)this.tx.set(ref(this.db,this.businessId,"voucherLines",v.lineId),v);}
  async saveLedgerEntries(lines:LedgerEntry[]){for(const v of lines)this.tx.set(ref(this.db,this.businessId,"ledgerEntries",v.lineId),v);}
  async saveStockMovements(lines:StockMovement[]){for(const v of lines)this.tx.set(ref(this.db,this.businessId,"stockMovements",v.id),v);}
  async savePartyAllocations(lines:PartyAllocation[]){for(const v of lines){if(v.businessId!==this.businessId)throw new ValidationError("Business mismatch in party allocation.");this.tx.set(ref(this.db,this.businessId,"partyAllocations",v.id),v);}}
  async saveReturnDocument(v:ReturnDocument){if(v.businessId!==this.businessId)throw new ValidationError("Business mismatch in return document.");this.tx.set(ref(this.db,this.businessId,"returnDocuments",v.id),v);}
  async saveAtomicDocument(v:AtomicAccountingDocument){if(v.businessId!==this.businessId)throw new ValidationError("Business mismatch in accounting document.");this.tx.set(ref(this.db,this.businessId,"accountingDocuments",v.id),v);}
  async saveBusinessDocument(name:string,key:string,data:Record<string,unknown>){if(!/^[A-Za-z0-9_-]{1,64}$/.test(name)||!key)throw new ValidationError("Invalid business document reference.");if(String(data.businessId??"")!==this.businessId)throw new ValidationError("Business document business mismatch.");this.tx.set(ref(this.db,this.businessId,name,key),data);}
  async saveAuditEvent(v:AuditEvent){this.tx.set(ref(this.db,this.businessId,"auditLogs",v.id),v);}
  async allocateVoucherNumber(input:{businessId:string;financialYearId:string;voucherType:string;prefix?:string}){if(input.businessId!==this.businessId)throw new ValidationError("Business mismatch while allocating voucher number.");const sequenceId=`${input.financialYearId}_${input.voucherType}`.replace(/[^a-zA-Z0-9_-]/g,"_");const sequenceRef=ref(this.db,this.businessId,"voucherSequences",sequenceId);const snap=await this.tx.get(sequenceRef);const next=Number(snap.exists?snap.data()?.nextNumber??1:1);if(!Number.isSafeInteger(next)||next<1)throw new ValidationError("Invalid voucher sequence state.");const prefix=input.prefix??input.voucherType.toUpperCase();this.tx.set(sequenceRef,{businessId:this.businessId,financialYearId:input.financialYearId,voucherType:input.voucherType,prefix,nextNumber:next+1,updatedAt:new Date().toISOString()},{merge:true});return `${prefix}-${String(next).padStart(6,"0")}`;}
}

export function createAdminAccountingRepository(businessId:string):AccountingRepository {
  id(businessId,"Business ID");
  const {db}=getAdminServices();
  return { runInTransaction:<T>(work:(tx:AccountingTransaction)=>Promise<T>)=>db.runTransaction(raw=>work(new AdminAccountingTransaction(db,raw,businessId))) };
}
