import { ValidationError } from "./errors";

export type AccountingPermission =
  | "SALE_CREATE" | "SALE_CANCEL" | "PURCHASE_CREATE" | "PURCHASE_CANCEL" | "RETURN_CREATE"
  | "RECEIPT_CREATE" | "PAYMENT_CREATE" | "CONTRA_CREATE" | "JOURNAL_CREATE" | "OPENING_CREATE"
  | "ALLOCATION_CREATE" | "PARTY_VIEW" | "PARTY_CREATE" | "PARTY_EDIT" | "PARTY_ARCHIVE"
  | "INVENTORY_VIEW" | "INVENTORY_ADJUST" | "INVENTORY_TRANSFER" | "PRODUCTION_CREATE" | "PRODUCTION_CANCEL"
  | "REPORT_VIEW" | "FY_LOCK";

export interface AuthorizationContext { userId: string; businessId: string; permissions: readonly AccountingPermission[]; }
export function assertAuthorized(ctx: AuthorizationContext,permission:AccountingPermission):void { if(!ctx.userId||!ctx.businessId) throw new ValidationError("Authenticated business context is required."); if(!ctx.permissions.includes(permission)) throw new ValidationError(`Permission denied: ${permission}.`); }
export function assertTrustedPostingBoundary(ctx:AuthorizationContext):void { if(!ctx.userId||!ctx.businessId) throw new ValidationError("Accounting commands require an authenticated trusted boundary."); }
