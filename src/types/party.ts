import type { Timestamp } from "firebase/firestore";

export type PartyStatus = "active" | "inactive";
export type BalanceType = "debit" | "credit";
export type GSTPartyType = "regular" | "composition" | "unregistered" | "other";

export interface PartyAddress {
  line1?: string;
  line2?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  country?: string;
}

export interface PartyGST {
  type: GSTPartyType;
  gstin?: string;
}

export interface Customer {
  customerId: string;
  customerCode: string;
  name: string;
  phone?: string;
  email?: string;
  address?: PartyAddress;
  gst?: PartyGST;
  openingBalance: number;
  openingBalanceType: BalanceType;
  creditLimit?: number;
  currentBalance?: number;
  status: PartyStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Supplier {
  supplierId: string;
  supplierCode: string;
  name: string;
  phone?: string;
  email?: string;
  address?: PartyAddress;
  gst?: PartyGST;
  openingBalance: number;
  openingBalanceType: BalanceType;
  creditLimit?: number;
  currentBalance?: number;
  status: PartyStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
