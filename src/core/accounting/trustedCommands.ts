import type { AccountingRepository, PostingResult } from "./types";
import { assertAuthorized, type AccountingPermission, type AuthorizationContext } from "./authorization";
import { postSale, postPurchase, type SalePostingInput, type PurchasePostingInput, type TransactionDeps } from "./transactions";
import { postSaleReturn, postPurchaseReturn, type ReturnBase, type ReturnAccounts, type ReturnDeps, type ReturnItem } from "./returns";

function command(ctx: AuthorizationContext, permission: AccountingPermission) { assertAuthorized(ctx, permission); }

export async function executeSale(repo: AccountingRepository, ctx: AuthorizationContext, input: SalePostingInput, deps: TransactionDeps): Promise<PostingResult> {
  if (ctx.businessId !== input.businessId || ctx.userId !== input.userId) throw new Error("Trusted accounting context does not match command.");
  command(ctx, "SALE_CREATE");
  return postSale(repo, input, deps);
}

export async function executePurchase(repo: AccountingRepository, ctx: AuthorizationContext, input: PurchasePostingInput, deps: TransactionDeps): Promise<PostingResult> {
  if (ctx.businessId !== input.businessId || ctx.userId !== input.userId) throw new Error("Trusted accounting context does not match command.");
  command(ctx, "PURCHASE_CREATE");
  return postPurchase(repo, input, deps);
}

export async function executeSaleReturn(repo: AccountingRepository, ctx: AuthorizationContext, input: ReturnBase & { accountMap: ReturnAccounts; items: ReturnItem[]; originalVoucherId: string; idempotencyKey: string }, deps: ReturnDeps) {
  if (ctx.businessId !== input.businessId || ctx.userId !== input.userId) throw new Error("Trusted accounting context does not match command.");
  command(ctx, "RETURN_CREATE");
  return postSaleReturn(repo, input, deps);
}

export async function executePurchaseReturn(repo: AccountingRepository, ctx: AuthorizationContext, input: ReturnBase & { accountMap: ReturnAccounts; items: ReturnItem[]; originalVoucherId: string; idempotencyKey: string }, deps: ReturnDeps) {
  if (ctx.businessId !== input.businessId || ctx.userId !== input.userId) throw new Error("Trusted accounting context does not match command.");
  command(ctx, "RETURN_CREATE");
  return postPurchaseReturn(repo, input, deps);
}
