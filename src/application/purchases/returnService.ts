import type { AccountingRepository, PostingResult } from "@/core/accounting/types";
import type { AccountingPermission } from "@/core/accounting/authorization";
import { assertAuthorized, assertTrustedPostingBoundary } from "@/core/accounting/authorization";
import { postPurchaseReturn, type ReturnAccounts, type ReturnItem, type ReturnDeps } from "@/core/accounting/returns";
import { ValidationError } from "@/core/accounting/errors";
import { firebaseAuth } from "@/lib/firebase";

export interface PurchaseReturnApplicationDeps { repo: AccountingRepository; ids: { next(prefix: string): string }; clock: { now(): string } }
export interface CreatePurchaseReturnContext { businessId: string; userId: string; financialYearId: string; idempotencyKey: string; permissions: AccountingPermission[]; role?: string }
export interface CreatePurchaseReturnInput {
  date: string;
  supplierId?: string;
  taxableValue: number;
  taxRate: number;
  intraState: boolean;
  cessRate?: number;
  narration?: string;
  originalVoucherId: string;
  mode: "credit" | "cash" | "bank";
  accountMap: ReturnAccounts;
  items: ReturnItem[];
}

async function getAuthToken(): Promise<string> {
  if (!firebaseAuth?.currentUser) throw new ValidationError("You must be signed in.");
  return firebaseAuth.currentUser.getIdToken();
}

async function createFromBrowser(ctx: CreatePurchaseReturnContext, input: CreatePurchaseReturnInput): Promise<PostingResult> {
  const token = await getAuthToken();
  const response = await fetch("/api/accounting/purchase-return", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...input, businessId: ctx.businessId, financialYearId: ctx.financialYearId, idempotencyKey: ctx.idempotencyKey }),
  });
  const payload = await response.json().catch(() => ({ error: "Invalid server response." }));
  if (!response.ok || !payload.success) throw new ValidationError(String(payload.error ?? "Could not post purchase return."));
  return payload.result as PostingResult;
}

export async function createPurchaseReturn(deps: PurchaseReturnApplicationDeps, ctx: CreatePurchaseReturnContext, input: CreatePurchaseReturnInput): Promise<PostingResult> {
  if (!ctx.businessId || !ctx.userId || !ctx.financialYearId) throw new ValidationError("Authenticated business, user and financial year are required.");
  if (!ctx.idempotencyKey) throw new ValidationError("Idempotency key is required.");
  if (typeof window !== "undefined") return createFromBrowser(ctx, input);
  assertTrustedPostingBoundary(ctx);
  assertAuthorized(ctx, "RETURN_CREATE");
  return postPurchaseReturn(deps.repo, {
    ...input,
    businessId: ctx.businessId,
    userId: ctx.userId,
    financialYearId: ctx.financialYearId,
    idempotencyKey: ctx.idempotencyKey,
  }, { ids: deps.ids, clock: deps.clock } as ReturnDeps);
}
