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
  if (error instanceof Error) return new ApplicationError(error.message, "ACCOUNTING_ERROR", error);
  return new ApplicationError("Unexpected application error.", "INTERNAL_ERROR", error);
}
