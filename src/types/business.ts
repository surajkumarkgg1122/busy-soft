import type { Timestamp } from "firebase/firestore";

export type BusinessStatus = "active" | "suspended" | "archived";

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

export interface BusinessMember {
  uid: string;
  role: BusinessMemberRole;
  status: "active" | "invited" | "disabled";
  permissions: MemberPermissions;
  joinedAt: Timestamp;
  invitedBy?: string;
}
