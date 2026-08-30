import {
  collection, doc, getDoc, query, where, getDocs,
  runTransaction, setDoc, updateDoc, increment, type Firestore,
  type Transaction,
} from "firebase/firestore";
import type { AccountingRepository, AccountingTransaction, Account, LedgerEntry, Voucher, VoucherLine, StockMovement } from "./types";
import { ValidationError } from "./errors";

const businessPath = (businessId: string) => `businesses/${businessId}`;
const accountRef = (db: Firestore, businessId: string, id: string) => doc(db, businessPath(businessId), "accounts", id);

function toAccount(data: Record<string, unknown>, id: string): Account {
  return { id, businessId: String(data.businessId), code: String(data.code ?? ""), name: String(data.name ?? ""), type: data.type as Account["type"], parentId: (data.parentId as string | null | undefined) ?? null, systemAccount: Boolean(data.systemAccount), active: data.active !== false, openingDebit: Number(data.openingDebit ?? 0), openingCredit: Number(data.openingCredit ?? 0), createdAt: String(data.createdAt ?? ""), updatedAt: String(data.updatedAt ?? "") };
}

class FirestoreAccountingTransaction implements AccountingTransaction {
  constructor(private readonly db: Firestore, private readonly tx: Transaction) {}

  async getAccount(accountId: string): Promise<Account | null> {
    // businessId is supplied by the factory, so cross-business account access is impossible through this adapter.
    const snap = await this.tx.get(accountRef(this.db, this.businessId, accountId));
    return snap.exists() ? toAccount(snap.data() as Record<string, unknown>, snap.id) : null;
  }

  async getVoucher(voucherId: string): Promise<Voucher | null> {
    const snap = await this.tx.get(doc(this.db, businessPath(this.businessId), "vouchers", voucherId));
    return snap.exists() ? snap.data() as Voucher : null;
  }

  async getVoucherLines(voucherId: string): Promise<VoucherLine[]> {
    const q = query(collection(this.db, businessPath(this.businessId), "voucherLines"), where("voucherId", "==", voucherId));
    const snap = await this.tx.get(q);
    return snap.docs.map(d => d.data() as VoucherLine).sort((a, b) => a.lineNo - b.lineNo);
  }

  async saveVoucher(voucher: Voucher): Promise<void> {
    this.tx.set(doc(this.db, businessPath(this.businessId), "vouchers", voucher.id), voucher);
  }

  async saveVoucherLines(lines: VoucherLine[]): Promise<void> {
    for (const line of lines) this.tx.set(doc(this.db, businessPath(this.businessId), "voucherLines", line.lineId), line);
  }

  async saveLedgerEntries(entries: LedgerEntry[]): Promise<void> {
    for (const entry of entries) this.tx.set(doc(this.db, businessPath(this.businessId), "ledgerEntries", entry.lineId), entry);
  }

  async saveStockMovements(movements: StockMovement[]): Promise<void> {
    for (const movement of movements) this.tx.set(doc(this.db, businessPath(this.businessId), "stockMovements", movement.id), movement);
  }

  async allocateVoucherNumber(input: { businessId: string; financialYearId: string; voucherType: string; prefix?: string }): Promise<string> {
    if (input.businessId !== this.businessId) throw new ValidationError("Business mismatch while allocating voucher number.");
    const sequenceId = `${input.financialYearId}_${input.voucherType}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    const ref = doc(this.db, businessPath(this.businessId), "voucherSequences", sequenceId);
    const snap = await this.tx.get(ref);
    const next = Number(snap.exists() ? snap.data().nextNumber ?? 1 : 1);
    if (!Number.isSafeInteger(next) || next < 1) throw new ValidationError("Invalid voucher sequence state.");
    this.tx.set(ref, { businessId: this.businessId, financialYearId: input.financialYearId, voucherType: input.voucherType, prefix: input.prefix ?? input.voucherType.toUpperCase(), nextNumber: next + 1, updatedAt: new Date().toISOString() }, { merge: true });
    const prefix = input.prefix ?? input.voucherType.toUpperCase();
    return `${prefix}-${String(next).padStart(6, "0")}`;
  }

  private readonly businessId = this.extractBusinessId();
  private extractBusinessId(): string {
    // Set by the factory immediately after construction.
    return (this as unknown as { _businessId?: string })._businessId ?? "";
  }
  setBusinessId(value: string): void { (this as unknown as { _businessId?: string })._businessId = value; }
}

export class FirestoreAccountingRepository implements AccountingRepository {
  constructor(private readonly db: Firestore) {}

  async runInTransaction<T>(work: (tx: AccountingTransaction) => Promise<T>): Promise<T> {
    return runTransaction(this.db, async rawTx => {
      const tx = new FirestoreAccountingTransaction(this.db, rawTx);
      // Business is inferred from the first transaction operation only in the current contract.
      // Use createTransaction(businessId) below for production calls.
      throw new ValidationError("Use createFirestoreAccountingTransaction(db, businessId) for business-scoped transactions.");
    });
  }
}

export function createFirestoreAccountingTransaction(db: Firestore, businessId: string): AccountingRepository {
  if (!businessId) throw new ValidationError("businessId is required.");
  return {
    runInTransaction: <T>(work: (tx: AccountingTransaction) => Promise<T>) => runTransaction(db, async rawTx => {
      const tx = new FirestoreAccountingTransaction(db, rawTx);
      tx.setBusinessId(businessId);
      return work(tx);
    }),
  };
}
