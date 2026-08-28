import type { Timestamp } from "firebase/firestore";

export type BusinessStatus = "active" | "suspended" | "archived";
export type TrialStatus = "active" | "expired";
export type BusinessMemberStatus = "active" | "invited" | "disabled";

export type BusinessMemberRole =
  | "owner"
  | "admin"
  | "manager"
  | "accountant"
  | "sales"
  | "inventory"
  | "viewer";

export interface BusinessAddress {
  line1: string;
  line2?: string;
  city: string;
  district?: string;
  state: string;
  pincode: string;
  country: string;
}

export interface BusinessGSTSettings {
  enabled: boolean;
  gstin?: string;
  registrationType?: "regular" | "composition" | "unregistered" | "other";
}

export interface BusinessFinancialYear {
  startMonth: number;
  startDay: number;
}

export interface BusinessTrial {
  status: TrialStatus;
  planId: "trial";
  startsAt: Timestamp;
  expiresAt: Timestamp;
}

export interface Business {
  businessId: string;
  name: string;
  legalName?: string;
  businessType?: string;
  phone?: string;
  email?: string;
  address: BusinessAddress;
  gst: BusinessGSTSettings;
  financialYear: BusinessFinancialYear;
  currency: string;
  timezone: string;
  ownerId: string;
  licenseId?: string;
  trial: BusinessTrial;
  status: BusinessStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface MemberPermissions {
  sales: boolean;
  purchases: boolean;
  inventory: boolean;
  payments: boolean;
  expenses: boolean;
  reports: boolean;
  settings: boolean;
}

/**
 * Authoritative membership stored at:
 * businesses/{businessId}/members/{uid}
 */
export interface BusinessMember {
  uid: string;
  role: BusinessMemberRole;
  status: BusinessMemberStatus;
  permissions: MemberPermissions;
  joinedAt: Timestamp;
  invitedBy?: string;
}

/**
 * Denormalized membership index stored at:
 * users/{uid}/businessMemberships/{businessId}
 *
 * This exists only to efficiently build the user's company switcher.
 * Authorization must always be checked against the authoritative
 * businesses/{businessId}/members/{uid} document.
 */
export interface UserBusinessMembership extends BusinessMember {
  businessId: string;
}
