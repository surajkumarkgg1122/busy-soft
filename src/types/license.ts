import type { Timestamp } from "firebase/firestore";

export type LicenseStatus = "trial" | "active" | "expired" | "suspended" | "cancelled";

export interface LicenseLimits {
  maxUsers: number;
  maxBusinesses: number;
  maxItems: number;
}

export interface LicenseFeatures {
  inventory: boolean;
  gst: boolean;
  accounting: boolean;
  reports: boolean;
  multiUser: boolean;
  onlineStore: boolean;
}

export interface License {
  licenseId: string;
  businessId: string;
  planId: string;
  status: LicenseStatus;
  issuedAt: Timestamp;
  startsAt: Timestamp;
  expiresAt: Timestamp;
  limits: LicenseLimits;
  features: LicenseFeatures;
}
