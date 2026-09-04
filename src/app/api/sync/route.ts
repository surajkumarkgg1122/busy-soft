import { NextResponse } from "next/server";
import { POST as postSale } from "@/app/api/accounting/sales/route";
import { POST as postPurchase } from "@/app/api/accounting/purchases/route";
import { POST as postExpense } from "@/app/api/accounting/expenses/route";
import { POST as postReceipt } from "@/app/api/accounting/payment-in/route";
import { POST as postPayment } from "@/app/api/accounting/payments/route";
import { POST as postSaleReturn } from "@/app/api/accounting/sales-return/route";
import { POST as postPurchaseReturn } from "@/app/api/accounting/purchase-return/route";

export const runtime = "nodejs";

type CommandType = "SALE_CREATE" | "PURCHASE_CREATE" | "RECEIPT_CREATE" | "PAYMENT_CREATE" | "EXPENSE_CREATE" | "SALE_RETURN_CREATE" | "PURCHASE_RETURN_CREATE";

const handlers: Record<CommandType, (request: Request) => Promise<Response>> = {
  SALE_CREATE: postSale,
  PURCHASE_CREATE: postPurchase,
  RECEIPT_CREATE: postReceipt,
  PAYMENT_CREATE: postPayment,
  EXPENSE_CREATE: postExpense,
  SALE_RETURN_CREATE: postSaleReturn,
  PURCHASE_RETURN_CREATE: postPurchaseReturn,
};

function error(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

/**
 * Trusted sync gateway. It deliberately delegates each operation to the
 * existing accounting HTTP handler instead of reimplementing transaction
 * validation or posting rules here. The original bearer token is preserved,
 * so the destination handler performs its normal server-side authorization.
 */
export async function POST(request: Request) {
  try {
    const auth = request.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer ")) return error("Authentication is required.", 401);
    const body = await request.json() as Record<string, unknown>;
    const commandType = String(body.commandType ?? "") as CommandType;
    const handler = handlers[commandType];
    if (!handler) return error(`Unsupported synchronization command: ${commandType || "unknown"}.`, 422);

    const businessId = String(body.businessId ?? "").trim();
    const financialYearId = String(body.financialYearId ?? "").trim();
    const idempotencyKey = String(body.idempotencyKey ?? "").trim();
    const payload = body.payload;
    if (!businessId || !financialYearId || !idempotencyKey || !payload || typeof payload !== "object") {
      return error("businessId, financialYearId, idempotencyKey and payload are required.", 400);
    }
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) return error("Invalid idempotency key.", 400);

    const delegatedPayload = {
      ...(payload as Record<string, unknown>),
      businessId,
      financialYearId,
      idempotencyKey,
      deviceId: typeof body.deviceId === "string" ? body.deviceId : undefined,
      operationId: typeof body.operationId === "string" ? body.operationId : undefined,
    };
    const delegated = new Request(request.url, {
      method: "POST",
      headers: { "authorization": auth, "content-type": "application/json", "x-busy-soft-sync": "1" },
      body: JSON.stringify(delegatedPayload),
    });
    const response = await handler(delegated);
    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : "Synchronization failed.", 500);
  }
}
