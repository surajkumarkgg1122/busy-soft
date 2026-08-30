import { createSale, type CreateSaleCommand, type SalesServiceDeps } from "./salesService";
import type { PostingResult } from "../../core/accounting/types";

/** Application boundary used by the Sales UI. It deliberately accepts only accounting commands. */
export async function postSalesInvoice(deps: SalesServiceDeps, command: CreateSaleCommand): Promise<PostingResult> {
  return createSale(deps, command);
}
