import type { AccountingError } from "@/core/accounting/errors";

export type ApplicationErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_COMMAND"
  | "CONFLICT"
  | "ACCOUNTING_ERROR"
  | "INTERNAL_ERROR";

export class ApplicationError extends Error {
  constructor(
    message: string,
    public readonly code: ApplicationErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}

export function normalizeApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) return error;
  if (isAccountingError(error)) {
    switch (error.code) {
      case "FORBIDDEN": return new ApplicationError(error.message, "FORBIDDEN", error);
      case "DUPLICATE_VOUCHER_NUMBER":
      case "IDEMPOTENCY_CONFLICT":
      case "CONCURRENCY_CONFLICT": return new ApplicationError(error.message, "CONFLICT", error);
      case "VALIDATION_ERROR":
      case "NOT_FOUND":
      case "UNBALANCED_VOUCHER":
      case "POSTED_VOUCHER_IMMUTABLE": return new ApplicationError(error.message, "INVALID_COMMAND", error);
      default: return new ApplicationError(error.message, "ACCOUNTING_ERROR", error);
    }
  }
  if (error instanceof Error) return new ApplicationError(error.message, "ACCOUNTING_ERROR", error);
  return new ApplicationError("Unexpected application error.", "INTERNAL_ERROR", error);
}

function isAccountingError(error: unknown): error is AccountingError {
  return error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string";
}
