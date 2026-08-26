export type LedgerParty = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  balance?: number;
  openingBalance?: number;
  openingBalanceType?: "debit" | "credit";
  type: "Customer" | "Supplier";
};

export type LedgerTransaction = {
  id: string;
  partyId: string;
  type: string;
  voucherNo: string;
  date: Date;
  particulars: string;
  debit: number;
  credit: number;
  amount: number;
  referenceType?: string;
  referenceId?: string;
  paymentMode?: string;
};

export type StatementRow = LedgerTransaction & { balance: number };

export function getPartyOpeningBalance(party: LedgerParty) {
  const amount = Number(party.openingBalance ?? party.balance ?? 0);
  const type = party.openingBalanceType ?? "debit";
  return type === "credit" ? -Math.abs(amount) : Math.abs(amount);
}

export function calculateRunningStatement(openingBalance: number, transactions: LedgerTransaction[]): StatementRow[] {
  let balance = openingBalance;
  return transactions.map((transaction) => {
    balance += Number(transaction.debit || 0) - Number(transaction.credit || 0);
    return { ...transaction, balance };
  });
}

export function calculateStatementSummary(openingBalance: number, transactions: LedgerTransaction[]) {
  const totalDebit = transactions.reduce((sum, transaction) => sum + Number(transaction.debit || 0), 0);
  const totalCredit = transactions.reduce((sum, transaction) => sum + Number(transaction.credit || 0), 0);
  const closingBalance = openingBalance + totalDebit - totalCredit;
  return { openingBalance, totalDebit, totalCredit, closingBalance };
}

export function balanceLabel(balance: number) {
  if (Math.abs(balance) < 0.005) return "Settled";
  return balance > 0 ? "Dr" : "Cr";
}

export function balanceAmount(balance: number) {
  return Math.abs(balance);
}
