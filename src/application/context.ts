import { ApplicationError } from "./errors";
import type { AuthorizationContext } from "@/core/accounting/authorization";

export interface TrustedCommandContext extends AuthorizationContext {
  businessId: string;
  userId: string;
  financialYearId: string;
  idempotencyKey: string;
  requestId?: string;
}

export function assertTrustedContext(context: TrustedCommandContext): void {
  if (!context.businessId || !context.userId || !context.financialYearId) {
    throw new ApplicationError("Authenticated business, user and financial year are required.", "UNAUTHENTICATED");
  }
  const key = context.idempotencyKey.trim();
  if (key.length < 16 || key.length > 128) {
    throw new ApplicationError("A valid idempotency key (16–128 characters) is required.", "INVALID_COMMAND");
  }
}
