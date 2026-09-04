import { AuthorizationError, ValidationError } from "./errors";
import type { AuditEvent, VoucherStatus } from "./types";

export type DocumentLifecycleStatus = "draft" | "validated" | "posted" | "cancelled";
export type DocumentLifecycleAction = "CREATE" | "EDIT" | "VALIDATE" | "POST" | "CANCEL" | "REVERSE" | "DELETE" | "ALLOCATE_PAYMENT" | "STOCK_ADJUST" | "PERMISSION_CHANGE" | "SETTINGS_CHANGE";

const transitions: Record<DocumentLifecycleStatus, Partial<Record<DocumentLifecycleAction, DocumentLifecycleStatus>>> = {
  draft: { EDIT: "draft", VALIDATE: "validated", POST: "posted", DELETE: "draft" },
  validated: { EDIT: "draft", POST: "posted", DELETE: "validated" },
  posted: { CANCEL: "cancelled", REVERSE: "cancelled" },
  cancelled: {}
};

export function assertLifecycleTransition(from: DocumentLifecycleStatus, action: DocumentLifecycleAction): DocumentLifecycleStatus {
  if (action === "CREATE") return "draft";
  const next = transitions[from]?.[action];
  if (!next) {
    if (from === "posted" && (action === "EDIT" || action === "DELETE")) throw new ValidationError("Posted financial documents are immutable; use cancellation or reversal.");
    if (from === "cancelled") throw new ValidationError("Cancelled documents are immutable; a separate authorized reversal workflow is required.");
    throw new ValidationError(`Invalid document lifecycle transition: ${from} -> ${action}.`);
  }
  return next;
}

export function assertPostedImmutable(status: DocumentLifecycleStatus | VoucherStatus): void {
  if (status === "posted") throw new ValidationError("Posted financial documents cannot be edited or deleted. Use cancellation/reversal.");
}

export function assertAuditPayload(event: AuditEvent): void {
  if (!event.businessId || !event.userId || !event.action || !event.entityType || !event.entityId || !event.timestamp) {
    throw new ValidationError("Audit event requires actor, business, action, entity, entityId and timestamp.");
  }
  if (event.action === "EDIT" && event.before === undefined && event.after === undefined) {
    throw new ValidationError("Edit audit events require before or after state.");
  }
}

export function assertAuditWriteTrusted(isTrustedServerBoundary: boolean): void {
  if (!isTrustedServerBoundary) throw new AuthorizationError("Audit history can only be written by a trusted server workflow.");
}

export function buildAuditEvent(input: Omit<AuditEvent, "id"> & { id: string }): AuditEvent {
  assertAuditPayload(input);
  return input;
}
