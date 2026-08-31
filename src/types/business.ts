import type { Timestamp } from "firebase/firestore";

export type BusinessStatus = "active" | "suspended" | "archived";
export type TrialStatus = "active" | "expired";
export type BusinessMemberStatus = "active" | "invited" | "disabled";
export type BusinessInvitationStatus = "pending" | "accepted" | "rejected" | "expired";

export type BusinessMemberRole = "owner" | "admin" | "manager" | "accountant" | "sales" | "inventory" | "viewer";

export const PERMISSION_MODULES = ["sales", "purchases", "inventory", "payments", "expenses", "reports", "settings", "parties", "items", "cashBank", "gst"] as const;
export type PermissionModule = typeof PERMISSION_MODULES[number];
export type PermissionAction = "view" | "create" | "edit" | "delete" | "print" | "export" | "approve";
export type GranularPermissions = Partial<Record<PermissionModule, Partial<Record<PermissionAction, boolean>>>>;

export interface BusinessAddress { line1: string; line2?: string; city: string; district?: string; state: string; pincode: string; country: string; }
export interface BusinessGSTSettings { enabled: boolean; gstin?: string; registrationType?: "regular" | "composition" | "unregistered" | "other"; }
export interface BusinessFinancialYear { startMonth: number; startDay: number; }
export interface BusinessTrial { status: TrialStatus; planId: "trial"; startsAt: Timestamp; expiresAt: Timestamp; }
export interface Business { businessId: string; name: string; legalName?: string; businessType?: string; phone?: string; email?: string; address: BusinessAddress; gst: BusinessGSTSettings; financialYear: BusinessFinancialYear; currency: string; timezone: string; ownerId: string; licenseId?: string; trial: BusinessTrial; status: BusinessStatus; createdAt: Timestamp; updatedAt: Timestamp; setupStatus?: "pending" | "ready" | "failed"; accountingVersion?: number; }
export interface BusinessMember { uid: string; role: BusinessMemberRole; status: BusinessMemberStatus; permissions: GranularPermissions; joinedAt: Timestamp; invitedBy?: string; invitationId?: string; }
export interface UserBusinessMembership extends BusinessMember { businessId: string; }
export interface BusinessInvitation { invitationId: string; businessId: string; invitedEmail: string; role: BusinessMemberRole; permissions: GranularPermissions; status: BusinessInvitationStatus; invitedBy: string; createdAt: Timestamp; expiresAt: Timestamp; respondedAt?: Timestamp; }
