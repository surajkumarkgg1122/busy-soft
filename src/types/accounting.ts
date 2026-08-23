import type { Timestamp } from "firebase/firestore";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface Account {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  parentId?: string | null;
  systemAccount: boolean;
  openingBalance: number;
  status: "active" | "inactive";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LedgerEntry {
  entryId: string;
  date: Timestamp;
  voucherType: string;
  voucherId: string;
  voucherNumber?: string;
  accountId: string;
  partyId?: string;
  debit: number;
  credit: number;
  description?: string;
  createdBy: string;
  createdAt: Timestamp;
}

export interface Expense {
  expenseId: string;
  expenseNumber: string;
  categoryId: string;
  amount: number;
  paymentMethod: "cash" | "upi" | "card" | "bank" | "cheque" | "other";
  date: Timestamp;
  description?: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface TaxRate {
  taxId: string;
  name: string;
  rate: number;
  cgstRate?: number;
  sgstRate?: number;
  igstRate?: number;
  status: "active" | "inactive";
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
