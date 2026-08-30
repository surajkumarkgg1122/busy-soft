export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type NormalBalance = "debit" | "credit";
export type VoucherStatus = "draft" | "posted" | "cancelled";

/**
 * All monetary values in the accounting core are integer minor units.
 * For INR this means paise. This avoids floating point accounting errors
 * and keeps the core independent from Firebase, Electron and SQLite.
 */
export type Money = number;

export interface Account {
  id: string;
  businessId: string;
  code: string;
  name: string;
  type: AccountType;
  parentId?: string | null;
  systemAccount: boolean;
  active: boolean;
  openingDebit: Money;
  openingCredit: Money;
  createdAt: string;
  updatedAt: string;
}

export interface VoucherLineInput {
  accountId: string;
  partyId?: string;
  description?: string;
  debit: Money;
  credit: Money;
  costCenterId?: string;
  itemId?: string;
  warehouseId?: string;
  taxCode?: string;
}

export interface VoucherLine extends VoucherLineInput {
  lineId: string;
  voucherId: string;
  businessId: string;
  lineNo: number;
}

export interface Voucher {
  id: string;
  businessId: string;
  financialYearId: string;
  voucherType: string;
  voucherNumber: string;
  date: string;
  status: VoucherStatus;
  referenceType?: string;
  referenceId?: string;
  narration?: string;
  totalDebit: Money;
  totalCredit: Money;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  cancelledBy?: string;
  reversalOfVoucherId?: string;
}

export interface LedgerEntry extends VoucherLine {
  date: string;
  voucherType: string;
  voucherNumber: string;
  createdAt: string;
}

export type StockDirection = "in" | "out" | "neutral";
export type StockSourceType = "opening" | "purchase" | "purchase_return" | "sale" | "sale_return" | "adjustment" | "transfer";

export interface StockMovement {
  id: string;
  businessId: string;
  financialYearId: string;
  date: string;
  itemId: string;
  warehouseId?: string;
  direction: StockDirection;
  quantity: number;
  unitCost: Money;
  value: Money;
  sourceType: StockSourceType;
  sourceId: string;
  createdBy: string;
  createdAt: string;
}

export interface TaxBreakdown {
  taxableValue: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  cess: Money;
  totalTax: Money;
  total: Money;
}

export interface TaxInput {
  taxableValue: Money;
  rate: number;
  intraState: boolean;
  cessRate?: number;
}

export interface PartyBalance {
  partyId: string;
  debit: Money;
  credit: Money;
  net: Money;
  side: "debit" | "credit" | "zero";
}

export interface PostingResult {
  voucher: Voucher;
  lines: VoucherLine[];
  ledgerEntries: LedgerEntry[];
  stockMovements: StockMovement[];
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface Clock {
  now(): string;
}

export interface AccountingRepository {
  runInTransaction<T>(work: (tx: AccountingTransaction) => Promise<T>): Promise<T>;
}

export interface AccountingTransaction {
  getAccount(accountId: string): Promise<Account | null>;
  getVoucher(voucherId: string): Promise<Voucher | null>;
  saveVoucher(voucher: Voucher): Promise<void>;
  saveVoucherLines(lines: VoucherLine[]): Promise<void>;
  saveLedgerEntries(entries: LedgerEntry[]): Promise<void>;
  saveStockMovements(movements: StockMovement[]): Promise<void>;
  allocateVoucherNumber(input: { businessId: string; financialYearId: string; voucherType: string; prefix?: string }): Promise<string>;
}
