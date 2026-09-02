import type { Timestamp } from "firebase/firestore";

export type BankTransactionType = "opening" | "deposit" | "withdrawal" | "bank_transfer_in" | "bank_transfer_out" | "cash_deposit" | "cash_withdrawal" | "adjustment";
export type BankAccountStatus = "active" | "inactive";

/** Canonical Cash & Bank master shape used by the accounting module. */
export interface BankAccount {
  businessId: string;
  accountId: string;
  displayName: string;
  kind: "cash" | "bank";
  ledgerAccountId: string;
  openingBalance: number;
  openingBalanceDate: string;
  currentBalance?: number;
  printQrOnInvoice?: boolean;
  printDetailsOnInvoice?: boolean;
  accountNumber?: string;
  ifscCode?: string;
  upiId?: string;
  bankName?: string;
  accountHolderName?: string;
  status: BankAccountStatus;
  createdBy: string;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
}

/** Legacy projection retained for reporting/import compatibility; postings use vouchers/ledgerEntries. */
export interface BankTransaction {
  transactionId: string;
  businessId?: string;
  accountId: string;
  type: BankTransactionType;
  name: string;
  date: Timestamp | string;
  amount: number;
  balanceAfter?: number;
  fromAccountId?: string;
  toAccountId?: string;
  reference?: string;
  notes?: string;
  voucherId?: string;
  voucherNumber?: string;
  createdBy: string;
  createdAt: Timestamp | string;
  updatedAt: Timestamp | string;
}
