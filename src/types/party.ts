import type { PartyAddress as CanonicalPartyAddress, PartyKind, PartyMaster, PartyRegistrationType, PartyStatus } from "@/core/accounting/partyMaster";

/**
 * Compatibility-only aliases. The accounting PartyMaster is authoritative.
 * Do not add balances or transaction state here.
 */
export type { PartyKind, PartyStatus };
export type BalanceType="debit"|"credit";
export type GSTPartyType=PartyRegistrationType;
export type PartyAddress=CanonicalPartyAddress;
export type PartyGST=PartyMaster["gst"];
export type Customer=PartyMaster & {kind:"customer"};
export type Supplier=PartyMaster & {kind:"supplier"};
export type DualRoleParty=PartyMaster & {kind:"both"};
