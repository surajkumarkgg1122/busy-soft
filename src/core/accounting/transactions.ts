import type {
  AccountingRepository,
  AtomicAccountingDocument,
  Money,
  PostingResult,
  VoucherLineInput,
} from "./types";
import { postIdempotentVoucher } from "./atomic";
import { postVoucher } from "./voucher";
import { createStockMovement } from "./inventory";
import { calculateTax } from "./gst";
import { calculateOutgoingAllocations, type StockValuationMethod } from "./valuation";
import { ValidationError } from "./errors";
import { assertMoney, assertQuantity } from "./money";
import { postSaleEntry } from "./saleEntry";

export interface TransactionDeps {
  ids: { next(prefix: string): string };
  clock: { now(): string };
}

export interface BaseTransaction {
  businessId: string;
  financialYearId: string;
  date: string;
  userId: string;
  narration?: string;
}

export interface AccountMap {
  party: string;
  sales?: string;
  purchases?: string;
  cash?: string;
  bank?: string;
  inputCgst?: string;
  inputSgst?: string;
  inputIgst?: string;
  outputCgst?: string;
  outputSgst?: string;
  outputIgst?: string;
  outputCess?: string;
  inputCess?: string;
  inventory?: string;
  cogs?: string;
}

const debit = (
  accountId: string,
  amount: Money,
  extra: Partial<VoucherLineInput> = {},
): VoucherLineInput => ({ accountId, debit: amount, credit: 0, ...extra });

const credit = (
  accountId: string,
  amount: Money,
  extra: Partial<VoucherLineInput> = {},
): VoucherLineInput => ({ accountId, debit: 0, credit: amount, ...extra });

const required = (value: string | undefined, name: string): string => {
  if (!value) throw new ValidationError(`Missing ${name} account.`);
  return value;
};

function validateBase(base: BaseTransaction): void {
  if (!base.businessId || !base.financialYearId || !base.userId) {
    throw new ValidationError("Business, financial year and user are required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base.date)) {
    throw new ValidationError("Transaction date must be YYYY-MM-DD.");
  }
}

interface StockCommand {
  itemId: string;
  quantity: number;
  unitCost?: Money;
  warehouseId?: string;
}

function validateStockItems(items: readonly StockCommand[]): void {
  if (!items.length) throw new ValidationError("At least one stock item is required.");

  const ids = new Set<string>();
  for (const item of items) {
    if (!item.itemId) throw new ValidationError("Stock item ID is required.");
    assertQuantity(item.quantity);
    if (item.unitCost !== undefined) assertMoney(item.unitCost, "Unit cost");

    const key = `${item.itemId}:${item.warehouseId ?? ""}`;
    if (ids.has(key)) throw new ValidationError(`Duplicate stock line: ${key}`);
    ids.add(key);
  }
}

function stockValue(items: readonly StockCommand[]): Money {
  let value = 0;

  for (const item of items) {
    if (item.unitCost === undefined) {
      throw new ValidationError("Unit cost is required for purchase stock lines.");
    }

    const line = Math.round(item.quantity * item.unitCost);
    if (!Number.isSafeInteger(line)) {
      throw new ValidationError("Stock line value exceeds safe integer range.");
    }
    value += line;
  }

  if (!Number.isSafeInteger(value)) {
    throw new ValidationError("Stock value exceeds safe integer range.");
  }
  return value;
}

function atomicDocument(input: {
  id: string;
  businessId: string;
  financialYearId: string;
  type: AtomicAccountingDocument["type"];
  voucherId: string;
  idempotencyKey: string;
  date: string;
  createdBy: string;
  createdAt: string;
  payload: Record<string, unknown>;
}): AtomicAccountingDocument {
  return { ...input, status: "posted" };
}

export async function postJournal(
  repo: AccountingRepository,
  base: BaseTransaction,
  lines: VoucherLineInput[],
  deps: TransactionDeps,
  voucherType = "JOURNAL",
  prefix = "JV",
): Promise<PostingResult> {
  validateBase(base);
  return repo.runInTransaction((tx) =>
    postVoucher(
      tx,
      {
        businessId: base.businessId,
        financialYearId: base.financialYearId,
        voucherType,
        prefix,
        date: base.date,
        narration: base.narration,
        createdBy: base.userId,
        lines,
      },
      deps,
    ),
  );
}

export async function postReceipt(
  repo: AccountingRepository,
  base: BaseTransaction & {
    partyId: string;
    amount: Money;
    mode: "cash" | "bank";
    accountMap: AccountMap;
  },
  deps: TransactionDeps,
): Promise<PostingResult> {
  if (!Number.isSafeInteger(base.amount) || base.amount <= 0) {
    throw new ValidationError("Receipt amount must be positive.");
  }

  return postJournal(
    repo,
    base,
    [
      debit(
        required(
          base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank,
          `${base.mode} account`,
        ),
        base.amount,
      ),
      credit(base.accountMap.party, base.amount, { partyId: base.partyId }),
    ],
    deps,
    "RECEIPT",
    "RC",
  );
}

export async function postPayment(
  repo: AccountingRepository,
  base: BaseTransaction & {
    partyId?: string;
    amount: Money;
    mode: "cash" | "bank";
    accountId: string;
    accountMap: AccountMap;
  },
  deps: TransactionDeps,
): Promise<PostingResult> {
  if (!Number.isSafeInteger(base.amount) || base.amount <= 0) {
    throw new ValidationError("Payment amount must be positive.");
  }

  return postJournal(
    repo,
    base,
    [
      debit(base.accountId, base.amount, { partyId: base.partyId }),
      credit(
        required(
          base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank,
          `${base.mode} account`,
        ),
        base.amount,
      ),
    ],
    deps,
    "PAYMENT",
    "PY",
  );
}

export async function postContra(
  repo: AccountingRepository,
  base: BaseTransaction & {
    fromAccountId: string;
    toAccountId: string;
    amount: Money;
  },
  deps: TransactionDeps,
): Promise<PostingResult> {
  if (!Number.isSafeInteger(base.amount) || base.amount <= 0) {
    throw new ValidationError("Contra amount must be positive.");
  }
  if (base.fromAccountId === base.toAccountId) {
    throw new ValidationError("Contra accounts must be different.");
  }

  return postJournal(
    repo,
    base,
    [debit(base.toAccountId, base.amount), credit(base.fromAccountId, base.amount)],
    deps,
    "CONTRA",
    "CT",
  );
}

export interface LineAmount {
  accountId: string;
  amount: Money;
  partyId?: string;
  description?: string;
}

export async function postOpeningBalance(
  repo: AccountingRepository,
  base: BaseTransaction & {
    debitLines: LineAmount[];
    creditLines: LineAmount[];
  },
  deps: TransactionDeps,
): Promise<PostingResult> {
  const lines = [
    ...base.debitLines.map((line) =>
      debit(line.accountId, line.amount, {
        partyId: line.partyId,
        description: line.description,
      }),
    ),
    ...base.creditLines.map((line) =>
      credit(line.accountId, line.amount, {
        partyId: line.partyId,
        description: line.description,
      }),
    ),
  ];

  return postJournal(repo, base, lines, deps, "OPENING", "OB");
}

export async function postExpense(
  repo: AccountingRepository,
  base: BaseTransaction & {
    expenseAccountId: string;
    amount: Money;
    mode: "cash" | "bank";
    accountMap: AccountMap;
  },
  deps: TransactionDeps,
): Promise<PostingResult> {
  if (!Number.isSafeInteger(base.amount) || base.amount <= 0) {
    throw new ValidationError("Expense amount must be positive.");
  }

  return postJournal(
    repo,
    base,
    [
      debit(base.expenseAccountId, base.amount),
      credit(
        required(
          base.mode === "cash" ? base.accountMap.cash : base.accountMap.bank,
          `${base.mode} account`,
        ),
        base.amount,
      ),
    ],
    deps,
    "EXPENSE",
    "EX",
  );
}

/**
 * Legacy-compatible sales command.
 *
 * The implementation intentionally delegates to the canonical sale entry
 * engine so there is only one sales-posting implementation in the core.
 */
export interface SalePostingInput extends BaseTransaction {
  customerId?: string;
  taxableValue: Money;
  taxRate: number;
  intraState: boolean;
  cessRate?: number;
  mode: "credit" | "cash" | "bank";
  totalCost?: Money;
  valuationMethod?: StockValuationMethod;
  accountMap: AccountMap;
  itemMovements: StockCommand[];
  idempotencyKey: string;
  documentId?: string;
  documentPayload?: Record<string, unknown>;
}

export async function postSale(
  repo: AccountingRepository,
  input: SalePostingInput,
  deps: TransactionDeps,
): Promise<PostingResult> {
  validateBase(input);

  const tax = calculateTax({
    taxableValue: input.taxableValue,
    rate: input.taxRate,
    intraState: input.intraState,
    cessRate: input.cessRate,
  });

  const paymentMode = input.mode;
  const paidAmount = paymentMode === "credit" ? 0 : tax.total;

  return postSaleEntry(
    repo,
    {
      businessId: input.businessId,
      financialYearId: input.financialYearId,
      date: input.date,
      userId: input.userId,
      customerId: input.customerId,
      grossValue: input.taxableValue,
      taxRate: input.taxRate,
      intraState: input.intraState,
      cessRate: input.cessRate,
      paymentMode,
      paidAmount,
      bankAccountId: paymentMode === "bank" ? input.accountMap.bank : undefined,
      accountMap: {
        party: input.accountMap.party,
        sales: required(input.accountMap.sales, "sales"),
        cash: input.accountMap.cash,
        bank: input.accountMap.bank,
        outputCgst: input.accountMap.outputCgst,
        outputSgst: input.accountMap.outputSgst,
        outputIgst: input.accountMap.outputIgst,
        outputCess: input.accountMap.outputCess,
        inventory: required(input.accountMap.inventory, "inventory"),
        cogs: required(input.accountMap.cogs, "COGS"),
      },
      itemMovements: input.itemMovements.map((item) => ({
        itemId: item.itemId,
        quantity: item.quantity,
        warehouseId: item.warehouseId,
      })),
      valuationMethod: input.valuationMethod,
      narration: input.narration,
      idempotencyKey: input.idempotencyKey,
      documentId: input.documentId,
      documentPayload: input.documentPayload,
    },
    deps,
  );
}

export interface PurchasePostingInput extends BaseTransaction {
  supplierId?: string;
  taxableValue: Money;
  taxRate: number;
  intraState: boolean;
  cessRate?: number;
  mode: "credit" | "cash" | "bank";
  accountMap: AccountMap;
  itemMovements: StockCommand[];
  idempotencyKey: string;
  documentId?: string;
  documentPayload?: Record<string, unknown>;
}

export async function postPurchase(
  repo: AccountingRepository,
  input: PurchasePostingInput,
  deps: TransactionDeps,
): Promise<PostingResult> {
  validateBase(input);

  if (!Number.isSafeInteger(input.taxableValue) || input.taxableValue <= 0) {
    throw new ValidationError("Purchase taxable value must be positive.");
  }
  if (input.mode === "credit" && !input.supplierId) {
    throw new ValidationError("Supplier is required for a credit purchase.");
  }
  if (input.mode !== "credit" && input.supplierId) {
    throw new ValidationError(
      "Cash/bank purchases cannot carry a supplier on the settlement line.",
    );
  }

  validateStockItems(input.itemMovements);
  const stockTotal = stockValue(input.itemMovements);
  if (stockTotal !== input.taxableValue) {
    throw new ValidationError(
      `Purchase stock value (${stockTotal}) must equal taxable value (${input.taxableValue}).`,
    );
  }

  return repo.runInTransaction(async (tx) => {
    const pre = await tx.getVoucherByIdempotencyKey(
      input.businessId,
      input.financialYearId,
      input.idempotencyKey,
    );
    if (pre) {
      return postIdempotentVoucher(
        tx,
        {
          businessId: input.businessId,
          financialYearId: input.financialYearId,
          voucherType: "PURCHASE",
          date: input.date,
          narration: input.narration,
          createdBy: input.userId,
          referenceType: "purchase",
          lines: [],
          idempotencyKey: input.idempotencyKey,
        },
        deps,
      );
    }

    const tax = calculateTax({
      taxableValue: input.taxableValue,
      rate: input.taxRate,
      intraState: input.intraState,
      cessRate: input.cessRate,
    });
    const inventoryAccount = required(input.accountMap.inventory, "inventory");
    const settlement = required(
      input.mode === "credit"
        ? input.accountMap.party
        : input.mode === "cash"
          ? input.accountMap.cash
          : input.accountMap.bank,
      "purchase settlement",
    );

    const lines: VoucherLineInput[] = [
      credit(
        settlement,
        tax.total,
        input.mode === "credit" ? { partyId: input.supplierId } : {},
      ),
      debit(inventoryAccount, stockTotal),
    ];

    if (tax.cgst) {
      lines.push(debit(required(input.accountMap.inputCgst, "input CGST"), tax.cgst));
    }
    if (tax.sgst) {
      lines.push(debit(required(input.accountMap.inputSgst, "input SGST"), tax.sgst));
    }
    if (tax.igst) {
      lines.push(debit(required(input.accountMap.inputIgst, "input IGST"), tax.igst));
    }
    if (tax.cess) {
      lines.push(debit(required(input.accountMap.inputCess, "input cess"), tax.cess));
    }

    const result = await postIdempotentVoucher(
      tx,
      {
        businessId: input.businessId,
        financialYearId: input.financialYearId,
        voucherType: "PURCHASE",
        date: input.date,
        narration: input.narration,
        createdBy: input.userId,
        referenceType: "purchase",
        referenceId: input.documentId ?? input.idempotencyKey,
        lines,
        idempotencyKey: input.idempotencyKey,
      },
      deps,
    );

    const movements = input.itemMovements.map((item) =>
      createStockMovement(
        {
          businessId: input.businessId,
          financialYearId: input.financialYearId,
          date: input.date,
          itemId: item.itemId,
          warehouseId: item.warehouseId,
          direction: "in",
          quantity: item.quantity,
          unitCost: item.unitCost!,
          value: Math.round(item.quantity * item.unitCost!),
          sourceType: "purchase",
          sourceId: result.voucher.id,
          createdBy: input.userId,
        },
        deps.ids,
        deps.clock.now(),
      ),
    );

    await tx.saveStockMovements(movements);

    const payload = {
      ...(input.documentPayload ?? {}),
      businessId: input.businessId,
      purchaseId: input.documentId ?? result.voucher.id,
      accountingVoucherId: result.voucher.id,
      accountingVoucherNumber: result.voucher.voucherNumber,
    };

    await tx.saveAtomicDocument(
      atomicDocument({
        id: input.documentId ?? result.voucher.id,
        businessId: input.businessId,
        financialYearId: input.financialYearId,
        type: "purchase",
        voucherId: result.voucher.id,
        idempotencyKey: input.idempotencyKey,
        date: input.date,
        createdBy: input.userId,
        createdAt: deps.clock.now(),
        payload,
      }),
    );

    if (input.documentId) {
      await tx.saveBusinessDocument("purchases", input.documentId, payload);
    }

    return { ...result, stockMovements: movements };
  });
}
