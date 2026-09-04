import { AuthorizationError } from "./errors";

export type AccountingPermission =
  | "SALE_CREATE" | "SALE_EDIT" | "SALE_CANCEL" | "PURCHASE_CREATE" | "PURCHASE_EDIT" | "PURCHASE_CANCEL"
  | "RETURN_CREATE" | "RECEIPT_CREATE" | "PAYMENT_CREATE" | "CONTRA_CREATE" | "JOURNAL_CREATE" | "OPENING_CREATE"
  | "ALLOCATION_CREATE" | "PARTY_VIEW" | "PARTY_CREATE" | "PARTY_EDIT" | "PARTY_ARCHIVE"
  | "INVENTORY_VIEW" | "INVENTORY_CREATE" | "INVENTORY_EDIT" | "INVENTORY_ADJUST" | "INVENTORY_TRANSFER"
  | "PRODUCTION_CREATE" | "PRODUCTION_CANCEL" | "REPORT_VIEW" | "REPORT_EXPORT" | "FY_LOCK"
  | "SETTINGS_VIEW" | "SETTINGS_EDIT" | "USER_MANAGE" | "ACCOUNT_MANAGE" | "TAX_MANAGE" | "CASH_BANK_VIEW"
  | "CASH_BANK_CREATE";

export type SystemRole = "owner" | "admin" | "accountant" | "manager" | "staff";

export interface AuthorizationContext {
  userId: string;
  businessId: string;
  permissions: readonly AccountingPermission[];
  role?: string;
}

const ROLE_PERMISSIONS: Record<SystemRole, readonly AccountingPermission[]> = {
  owner: [
    "SALE_CREATE","SALE_EDIT","SALE_CANCEL","PURCHASE_CREATE","PURCHASE_EDIT","PURCHASE_CANCEL","RETURN_CREATE",
    "RECEIPT_CREATE","PAYMENT_CREATE","CONTRA_CREATE","JOURNAL_CREATE","OPENING_CREATE","ALLOCATION_CREATE",
    "PARTY_VIEW","PARTY_CREATE","PARTY_EDIT","PARTY_ARCHIVE","INVENTORY_VIEW","INVENTORY_CREATE","INVENTORY_EDIT",
    "INVENTORY_ADJUST","INVENTORY_TRANSFER","PRODUCTION_CREATE","PRODUCTION_CANCEL","REPORT_VIEW","REPORT_EXPORT","FY_LOCK",
    "SETTINGS_VIEW","SETTINGS_EDIT","USER_MANAGE","ACCOUNT_MANAGE","TAX_MANAGE","CASH_BANK_VIEW","CASH_BANK_CREATE"
  ],
  admin: [
    "SALE_CREATE","SALE_EDIT","SALE_CANCEL","PURCHASE_CREATE","PURCHASE_EDIT","PURCHASE_CANCEL","RETURN_CREATE",
    "RECEIPT_CREATE","PAYMENT_CREATE","CONTRA_CREATE","JOURNAL_CREATE","OPENING_CREATE","ALLOCATION_CREATE",
    "PARTY_VIEW","PARTY_CREATE","PARTY_EDIT","PARTY_ARCHIVE","INVENTORY_VIEW","INVENTORY_CREATE","INVENTORY_EDIT",
    "INVENTORY_ADJUST","INVENTORY_TRANSFER","PRODUCTION_CREATE","PRODUCTION_CANCEL","REPORT_VIEW","REPORT_EXPORT",
    "SETTINGS_VIEW","SETTINGS_EDIT","USER_MANAGE","ACCOUNT_MANAGE","TAX_MANAGE","CASH_BANK_VIEW","CASH_BANK_CREATE"
  ],
  accountant: [
    "SALE_CREATE","SALE_EDIT","PURCHASE_CREATE","PURCHASE_EDIT","RETURN_CREATE","RECEIPT_CREATE","PAYMENT_CREATE",
    "CONTRA_CREATE","JOURNAL_CREATE","OPENING_CREATE","ALLOCATION_CREATE","PARTY_VIEW","PARTY_CREATE","PARTY_EDIT",
    "INVENTORY_VIEW","INVENTORY_CREATE","INVENTORY_EDIT","INVENTORY_ADJUST","INVENTORY_TRANSFER","PRODUCTION_CREATE",
    "REPORT_VIEW","REPORT_EXPORT","ACCOUNT_MANAGE","TAX_MANAGE","CASH_BANK_VIEW","CASH_BANK_CREATE"
  ],
  manager: [
    "SALE_CREATE","SALE_EDIT","PURCHASE_CREATE","PURCHASE_EDIT","RETURN_CREATE","RECEIPT_CREATE","PAYMENT_CREATE",
    "PARTY_VIEW","PARTY_CREATE","PARTY_EDIT","INVENTORY_VIEW","INVENTORY_CREATE","INVENTORY_EDIT","INVENTORY_TRANSFER",
    "PRODUCTION_CREATE","REPORT_VIEW","REPORT_EXPORT","CASH_BANK_VIEW"
  ],
  staff: [
    "SALE_CREATE","PURCHASE_CREATE","RETURN_CREATE","RECEIPT_CREATE","PARTY_VIEW","INVENTORY_VIEW","REPORT_VIEW","CASH_BANK_VIEW"
  ]
};

export function permissionsForRole(role: string): readonly AccountingPermission[] {
  return ROLE_PERMISSIONS[role as SystemRole] ?? [];
}

export function assertTrustedPostingBoundary(ctx: AuthorizationContext): void {
  if (!ctx.userId || !ctx.businessId) throw new AuthorizationError("Authenticated business context is required.");
}

export function assertAuthorized(ctx: AuthorizationContext, permission: AccountingPermission): void {
  assertTrustedPostingBoundary(ctx);
  const rolePermissions = ctx.role ? permissionsForRole(ctx.role) : [];
  if (!ctx.permissions.includes(permission) && !rolePermissions.includes(permission)) {
    throw new AuthorizationError(`Permission denied: ${permission}.`);
  }
}

export function assertRole(ctx: AuthorizationContext, roles: readonly SystemRole[]): void {
  assertTrustedPostingBoundary(ctx);
  if (!ctx.role || !roles.includes(ctx.role as SystemRole)) throw new AuthorizationError("Role is not authorized for this operation.");
}

export function assertOwnerOrAdmin(ctx: AuthorizationContext): void {
  assertRole(ctx, ["owner", "admin"]);
}

export function assertCanManageUsers(ctx: AuthorizationContext): void {
  assertAuthorized(ctx, "USER_MANAGE");
}

export function assertCanManageAccounts(ctx: AuthorizationContext): void {
  assertAuthorized(ctx, "ACCOUNT_MANAGE");
}
