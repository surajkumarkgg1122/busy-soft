import { savePartyMaster, type PartyKind, type PartyMaster } from "@/core/accounting/partyMaster";
import type { AccountingRepository } from "@/core/accounting/types";
import { assertTrustedContext, type TrustedCommandContext } from "../context";
import { assertAuthorized, assertTrustedPostingBoundary, type AccountingPermission } from "@/core/accounting/authorization";
import { normalizeApplicationError } from "../errors";

export interface PartyApplicationDeps { repo: AccountingRepository; ids:{ next(prefix:string):string }; clock:{ now():string } }

function permissionFor(kind: PartyKind): AccountingPermission { return kind === "customer" ? "PARTY_CREATE" : "PARTY_CREATE"; }

export async function createParty(deps: PartyApplicationDeps, ctx: TrustedCommandContext, input: Partial<PartyMaster>, kind: PartyKind): Promise<PartyMaster> {
  try {
    assertTrustedContext(ctx);
    assertTrustedPostingBoundary(ctx);
    assertAuthorized(ctx, permissionFor(kind));
    return await savePartyMaster(deps.repo, deps, { ...input, businessId: ctx.businessId }, kind, ctx.userId);
  } catch (error) {
    throw normalizeApplicationError(error);
  }
}
