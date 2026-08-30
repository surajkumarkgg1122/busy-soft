import type { SalePostingInput, TransactionDeps } from "../../core/accounting/transactions";
import { postSale } from "../../core/accounting/transactions";
import type { AccountingRepository, Money, PostingResult } from "../../core/accounting/types";
import { ValidationError } from "../../core/accounting/errors";

export interface SalesServiceDeps { accounting: AccountingRepository; transaction: TransactionDeps; }
export interface SaleItemCommand { itemId: string; quantity: number; unitCost: Money; warehouseId?: string; }
export interface CreateSaleCommand {
  businessId: string; financialYearId: string; date: string; userId: string; customerId?: string;
  taxableValue: Money; taxRate: number; cessRate?: number; intraState: boolean;
  mode: "credit" | "cash" | "bank"; totalCost: Money; accountMap: SalePostingInput["accountMap"];
  items: SaleItemCommand[]; narration?: string;
}

export async function createSale(deps: SalesServiceDeps, command: CreateSaleCommand): Promise<PostingResult> {
  if (!command.businessId) throw new ValidationError("businessId is required.");
  if (command.mode === "credit" && !command.customerId) throw new ValidationError("Customer is required for a credit sale.");
  if (!command.items.length) throw new ValidationError("At least one sale item is required.");
  if (command.items.some(i => !i.itemId || !Number.isFinite(i.quantity) || i.quantity <= 0)) throw new ValidationError("Every sale item must have a valid quantity.");
  return postSale(deps.accounting, {
    businessId: command.businessId, financialYearId: command.financialYearId, date: command.date, userId: command.userId,
    customerId: command.customerId ?? "", taxableValue: command.taxableValue, taxRate: command.taxRate,
    cessRate: command.cessRate, intraState: command.intraState, mode: command.mode, totalCost: command.totalCost,
    accountMap: command.accountMap, itemMovements: command.items, narration: command.narration,
  }, deps.transaction);
}
