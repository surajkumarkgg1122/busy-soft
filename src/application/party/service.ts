import { savePartyMaster, updatePartyMaster, type PartyKind, type PartyMaster } from "@/core/accounting/partyMaster";
import { allocatePartyAmount } from "@/core/accounting/partyTransaction";
import type { AccountingRepository, PartyAllocation } from "@/core/accounting/types";
import { assertTrustedContext, type TrustedCommandContext } from "../context";
import { assertAuthorized, assertTrustedPostingBoundary, type AccountingPermission } from "@/core/accounting/authorization";
import { normalizeApplicationError } from "../errors";

export interface PartyApplicationDeps { repo: AccountingRepository; ids:{ next(prefix:string):string }; clock:{ now():string } }
function permissionFor(_kind: PartyKind, operation: "create" | "edit"): AccountingPermission { return operation === "create" ? "PARTY_CREATE" : "PARTY_EDIT"; }

export async function createParty(deps: PartyApplicationDeps, ctx: TrustedCommandContext, input: Partial<PartyMaster>, kind: PartyKind): Promise<PartyMaster> {
  try { assertTrustedContext(ctx); assertTrustedPostingBoundary(ctx); assertAuthorized(ctx, permissionFor(kind,"create")); return await savePartyMaster(deps.repo,deps,{...input,businessId:ctx.businessId},kind,ctx.userId,ctx.financialYearId,ctx.idempotencyKey); }
  catch(error){ throw normalizeApplicationError(error); }
}
export async function updateParty(deps: PartyApplicationDeps, ctx: TrustedCommandContext, input: Partial<PartyMaster>, kind: PartyKind): Promise<PartyMaster> {
  try { assertTrustedContext(ctx); assertTrustedPostingBoundary(ctx); assertAuthorized(ctx,permissionFor(kind,"edit")); return await updatePartyMaster(deps.repo,deps,{...input,businessId:ctx.businessId},kind,ctx.userId); }
  catch(error){ throw normalizeApplicationError(error); }
}
export async function allocateParty(deps: PartyApplicationDeps, ctx: TrustedCommandContext, input:{partyId:string;fromVoucherId:string;toVoucherId:string;amount:number;date:string}):Promise<PartyAllocation>{
  try { assertTrustedContext(ctx); assertTrustedPostingBoundary(ctx); assertAuthorized(ctx,"ALLOCATION_CREATE"); return await allocatePartyAmount(deps.repo,{...input,businessId:ctx.businessId,userId:ctx.userId,idempotencyKey:ctx.idempotencyKey},deps); }
  catch(error){ throw normalizeApplicationError(error); }
}
