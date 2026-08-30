import type { Timestamp } from "firebase/firestore";

export type BankTransactionType = "opening" | "deposit" | "withdrawal" | "bank_transfer_in" | "bank_transfer_out" | "cash_deposit" | "cash_withdrawal" | "adjustment";
export type BankAccountStatus = "active" | "inactive";

export interface BankAccount {
  accountId: string;
  displayName: string;
  openingBalance: number;
  openingBalanceDate: Timestamp;
  printQrOnInvoice: boolean;
  printDetailsOnInvoice: boolean;
  accountNumber?: string;
  ifscCode?: string;
  upiId?: string;
  bankName?: string;
  accountHolderName?: string;
  currentBalance: number;
  status: BankAccountStatus;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface BankTransaction {
  transactionId: string;
  accountId: string;
  type: BankTransactionType;
  name: string;
  date: Timestamp;
  amount: number;
  balanceAfter: number;
  fromAccountId?: string;
  toAccountId?: string;
  reference?: string;
  notes?: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
