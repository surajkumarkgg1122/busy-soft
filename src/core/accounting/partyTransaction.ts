import type { AccountingRepository, PartyAllocation } from "./types";
import { postPartyAllocation } from "./party";import { ValidationError } from "./errors";
export interface PartyAllocationDeps{ids:{next(prefix:string):string};clock:{now():string}}
export async function allocatePartyAmount(repo:AccountingRepository,input:{businessId:string;partyId:string;fromVoucherId:string;toVoucherId:string;amount:number;date:string;userId:string;idempotencyKey:string},deps:PartyAllocationDeps):Promise<PartyAllocation>{if(!input.businessId||!input.partyId||!input.userId||!input.idempotencyKey)throw new ValidationError("Business, party, user and idempotency key are required.");return postPartyAllocation(repo,input,deps)}
