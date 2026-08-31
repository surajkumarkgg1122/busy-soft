import { savePartyMaster, updatePartyMaster, type PartyKind, type PartyMaster } from "@/core/accounting/partyMaster";
import type { AccountingRepository } from "@/core/accounting/types";
import { assertTrustedContext, type TrustedCommandContext } from "../context";
import { assertAuthorized, assertTrustedPostingBoundary, type AccountingPermission } from "@/core/accounting/authorization";
import { normalizeApplicationError } from "../errors";

export interface PartyApplicationDeps { repo: AccountingRepository; ids:{ next(prefix:string):string }; clock:{ now():string } }

function permissionFor(kind: PartyKind, operation: "create" | "edit"): AccountingPermission {
  if (operation === "create") return "PARTY_CREATE";
  return "PARTY_EDIT";
}

export async function createParty(deps: PartyApplicationDeps, ctx: TrustedCommandContext, input: Partial<PartyMaster>, kind: PartyKind): Promise<PartyMaster> {
  try {
    assertTrustedContext(ctx);
    assertTrustedPostingBoundary(ctx);
    assertAuthorized(ctx, permissionFor(kind, "create"));
    return await savePartyMaster(deps.repo, deps, { ...input, businessId: ctx.businessId }, kind, ctx.userId);
  } catch (error) {
    throw normalizeApplicationError(error);
  }
}

export async function updateParty(deps: PartyApplicationDeps, ctx: TrustedCommandContext, input: Partial<PartyMaster>, kind: PartyKind): Promise<PartyMaster> {
  try {
    assertTrustedContext(ctx);
    assertTrustedPostingBoundary(ctx);
    assertAuthorized(ctx, permissionFor(kind, "edit"));
    return await updatePartyMaster(deps.repo, deps, { ...input, businessId: ctx.businessId }, kind, ctx.userId);
  } catch (error) {
    throw normalizeApplicationError(error);
  }
}
