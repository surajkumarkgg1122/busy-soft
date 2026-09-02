import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { postCashBankEntry, postCashBankTransfer } from "@/core/accounting/cashBank";
import { reversePostedVoucher } from "@/core/accounting/voucherReversal";

export const runtime = "nodejs";

type Member = {
  role?: string;
  status?: string;
  permissions?: Record<string, unknown>;
};

const fail = (message: string, status = 400) =>
  NextResponse.json({ success: false, error: message }, { status });

const businessRef = (db: any, businessId: string) =>
  db.collection("businesses").doc(businessId);

async function authenticate(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw Object.assign(new Error("Authentication is required."), { status: 401 });
  }

  try {
    const token = await auth.verifyIdToken(header.slice(7));
    return { db, token };
  } catch {
    throw Object.assign(new Error("Authentication token is invalid or expired."), {
      status: 401,
    });
  }
}

async function requireMembership(db: any, businessId: string, uid: string): Promise<Member> {
  const snap = await businessRef(db, businessId)
    .collection("members")
    .doc(uid)
    .get();
  if (!snap.exists || snap.data()?.status !== "active") {
    throw Object.assign(new Error("You are not an active member of this business."), {
      status: 403,
    });
  }
  return (snap.data() ?? {}) as Member;
}

function allowed(member: Member, action: "create" | "edit" | "view") {
  if (member.role === "owner" || member.role === "admin") return true;
  return member.permissions?.cashBank?.[action] === true;
}

function idempotencyKey(body: Record<string, unknown>) {
  const value = String(body.idempotencyKey ?? "").trim();
  if (value.length < 16 || value.length > 128) {
    throw new Error("A valid idempotency key is required.");
  }
  return value;
}

const deps = () => ({
  ids: { next: (prefix: string) => `${prefix}-${randomUUID()}` },
  clock: { now: () => new Date().toISOString() },
});

async function currentFinancialYear(db: any, businessId: string) {
  const snap = await businessRef(db, businessId)
    .collection("financialYears")
    .where("locked", "==", false)
    .orderBy("startDate", "desc")
    .limit(1)
    .get();
  if (snap.empty) {
    throw new Error("No open financial year is configured for this business.");
  }
  return String(snap.docs[0].id);
}

function positiveRupees(value: unknown, name = "Amount") {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be greater than zero.`);
  }
  const minor = Math.round(n * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new Error(`${name} is too large or invalid.`);
  }
  return minor;
}

function nonNegativeRupees(value: unknown, name = "Amount") {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative amount.`);
  }
  const minor = Math.round(n * 100);
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error(`${name} is too large or invalid.`);
  }
  return minor;
}

export async function GET(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const url = new URL(request.url);
    const businessId = (url.searchParams.get("businessId") ?? "").trim();
    if (!businessId) return fail("Business ID is required.");

    const member = await requireMembership(db, businessId, token.uid);
    if (!allowed(member, "view")) {
      return fail("Cash & Bank view permission denied.", 403);
    }

    const ref = businessRef(db, businessId);
    const financialYearId = await currentFinancialYear(db, businessId);
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const accountQuery = includeInactive
      ? ref.collection("bankAccounts")
      : ref.collection("bankAccounts").where("status", "==", "active");

    const [accountSnapshot, ledgerSnapshot, glSnapshot] = await Promise.all([
      accountQuery.get(),
      ref.collection("ledgerEntries").where("financialYearId", "==", financialYearId).get(),
      ref.collection("accounts").where("active", "==", true).get(),
    ]);

    const accountDocs = accountSnapshot.docs.map((doc: any) => ({
      accountId: doc.id,
      ...doc.data(),
    }));

    const ledgerBalance = new Map<string, number>();
    for (const doc of ledgerSnapshot.docs) {
      const entry = doc.data() as any;
      const accountId = String(entry.accountId ?? "");
      if (!accountId) continue;
      ledgerBalance.set(
        accountId,
        (ledgerBalance.get(accountId) ?? 0) +
          Number(entry.debit ?? 0) -
          Number(entry.credit ?? 0),
      );
    }

    const glMap = new Map<string, any>(
      glSnapshot.docs.map((doc: any) => [doc.id, { accountId: doc.id, ...doc.data() }]),
    );

    const accounts = accountDocs.map((account: any) => {
      const ledgerAccountId = String(account.ledgerAccountId ?? "");
      const gl = glMap.get(ledgerAccountId);
      const opening =
        Number(gl?.openingDebit ?? 0) - Number(gl?.openingCredit ?? 0);
      const activity = Number(ledgerBalance.get(ledgerAccountId) ?? 0);
      return {
        ...account,
        currentBalance: opening + activity,
        balanceSource: "accountingLedger",
        ledgerHealthy: Boolean(
          gl && gl.type === "asset" && gl.active !== false,
        ),
      };
    });

    const glAccounts = glSnapshot.docs
      .map((doc: any) => ({ accountId: doc.id, ...doc.data() }))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));

    const ledger = ledgerSnapshot.docs
      .map((doc: any) => ({ lineId: doc.id, ...doc.data() }))
      .sort((a: any, b: any) =>
        `${b.date}:${b.voucherNumber ?? ""}:${b.lineNo ?? 0}`.localeCompare(
          `${a.date}:${a.voucherNumber ?? ""}:${a.lineNo ?? 0}`,
        ),
      )
      .slice(0, 300);

    return NextResponse.json({
      success: true,
      financialYearId,
      accounts,
      glAccounts,
      ledger,
      hasMoreLedger: ledgerSnapshot.size > 300,
    });
  } catch (error: any) {
    return fail(
      error?.message ?? "Unable to load cash and bank data.",
      error?.status ?? 500,
    );
  }
}

export async function POST(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const body = (await request.json()) as Record<string, any>;
    const businessId = String(body.businessId ?? "").trim();
    if (!businessId) return fail("Business ID is required.");

    const member = await requireMembership(db, businessId, token.uid);
    const action = String(body.action ?? "") as
      | "entry"
      | "transfer"
      | "account"
      | "account_update"
      | "account_status"
      | "reverse"
      | "";

    if (["entry", "transfer", "account"].includes(action) && !allowed(member, "create")) {
      return fail("Cash & Bank create permission denied.", 403);
    }
    if (["account_update", "account_status", "reverse"].includes(action) && !allowed(member, "edit")) {
      return fail("Cash & Bank edit permission denied.", 403);
    }

    const ref = businessRef(db, businessId);
    const repo = createAdminAccountingRepository(businessId);
    const financialYearId = String(
      body.financialYearId ?? (await currentFinancialYear(db, businessId)),
    );

    if (action === "entry") {
      const accountId = String(body.accountId ?? "");
      const type = String(body.type ?? "");
      const allowedTypes = [
        "deposit",
        "withdrawal",
        "cash_deposit",
        "cash_withdrawal",
      ];
      if (!allowedTypes.includes(type)) {
        return fail("Invalid Cash & Bank entry type.");
      }

      const accountSnapshot = await ref
        .collection("bankAccounts")
        .doc(accountId)
        .get();
      if (!accountSnapshot.exists) return fail("Cash/bank account not found.");

      const account = accountSnapshot.data() as any;
      if (account.status !== "active") {
        return fail("Cash/bank account is inactive.");
      }

      const amount = positiveRupees(body.amount);
      const result = await postCashBankEntry(
        repo,
        {
          businessId,
          financialYearId,
          date: String(body.date ?? ""),
          userId: token.uid,
          idempotencyKey: idempotencyKey(body),
          accountId,
          ledgerAccountId: String(account.ledgerAccountId ?? ""),
          type: type as "deposit" | "withdrawal" | "cash_deposit" | "cash_withdrawal",
          amount,
          contraAccountId: String(body.contraAccountId ?? ""),
          narration: String(body.name ?? "Cash/Bank transaction"),
          reference: String(body.reference ?? ""),
          notes: String(body.notes ?? ""),
        },
        deps(),
      );
      return NextResponse.json({ success: true, result });
    }

    if (action === "transfer") {
      const fromAccountId = String(body.fromAccountId ?? "");
      const toAccountId = String(body.toAccountId ?? "");
      if (fromAccountId === toAccountId) {
        return fail("Source and destination accounts must be different.");
      }

      const [fromSnapshot, toSnapshot] = await Promise.all([
        ref.collection("bankAccounts").doc(fromAccountId).get(),
        ref.collection("bankAccounts").doc(toAccountId).get(),
      ]);
      if (!fromSnapshot.exists || !toSnapshot.exists) {
        return fail("Both cash/bank accounts are required.");
      }

      const fromAccount = fromSnapshot.data() as any;
      const toAccount = toSnapshot.data() as any;
      if (fromAccount.status !== "active" || toAccount.status !== "active") {
        return fail("Both cash/bank accounts must be active.");
      }

      const amount = positiveRupees(body.amount);
      const result = await postCashBankTransfer(
        repo,
        {
          businessId,
          financialYearId,
          date: String(body.date ?? ""),
          userId: token.uid,
          idempotencyKey: idempotencyKey(body),
          fromAccountId,
          fromLedgerAccountId: String(fromAccount.ledgerAccountId ?? ""),
          toAccountId,
          toLedgerAccountId: String(toAccount.ledgerAccountId ?? ""),
          amount,
          narration: String(body.notes ?? "Cash/Bank transfer"),
          reference: String(body.reference ?? ""),
          notes: String(body.notes ?? ""),
        },
        deps(),
      );
      return NextResponse.json({ success: true, result });
    }

    if (action === "account") {
      const kind = body.kind === "cash" ? "cash" : "bank";
      const displayName = String(body.displayName ?? "").trim();
      if (!displayName) return fail("Account name is required.");

      const openingBalance = nonNegativeRupees(
        body.openingBalance === undefined ? 0 : body.openingBalance,
        "Opening balance",
      );
      const accountId = `${kind}-${randomUUID()}`;
      const ledgerAccountId = `cashbank-${randomUUID()}`;
      const now = Timestamp.now();
      const parentId = kind === "cash" ? "acct-cash" : "acct-bank";
      const parentSnapshot = await ref.collection("accounts").doc(parentId).get();
      if (!parentSnapshot.exists || parentSnapshot.data()?.type !== "asset") {
        return fail("Cash/Bank parent account is not configured.");
      }

      const openingBalanceDate = String(
        body.openingBalanceDate ?? new Date().toISOString().slice(0, 10),
      );
      if (!/^\d{4}-\d{2}-\d{2}$/.test(openingBalanceDate)) {
        return fail("Opening balance date must be YYYY-MM-DD.");
      }

      const batch = db.batch();
      batch.set(ref.collection("accounts").doc(ledgerAccountId), {
        id: ledgerAccountId,
        businessId,
        code: `CB-${Date.now()}`,
        name: displayName,
        type: "asset",
        parentId,
        systemAccount: false,
        active: true,
        openingDebit: openingBalance,
        openingCredit: 0,
        createdAt: now.toDate().toISOString(),
        updatedAt: now.toDate().toISOString(),
      });
      batch.set(ref.collection("bankAccounts").doc(accountId), {
        businessId,
        accountId,
        displayName,
        kind,
        ledgerAccountId,
        openingBalance,
        openingBalanceDate,
        currentBalance: openingBalance,
        printQrOnInvoice: Boolean(body.printQrOnInvoice),
        printDetailsOnInvoice: Boolean(body.printDetailsOnInvoice),
        accountNumber: String(body.accountNumber ?? ""),
        ifscCode: String(body.ifscCode ?? ""),
        upiId: String(body.upiId ?? ""),
        bankName: String(body.bankName ?? ""),
        accountHolderName: String(body.accountHolderName ?? ""),
        status: "active",
        createdBy: token.uid,
        createdAt: now,
        updatedAt: now,
      });
      batch.set(ref.collection("auditLogs").doc(`audit-${randomUUID()}`), {
        businessId,
        entityType: "cash_bank_account",
        entityId: accountId,
        action: "ACCOUNT_CREATED",
        userId: token.uid,
        timestamp: now.toDate().toISOString(),
        after: {
          accountId,
          ledgerAccountId,
          displayName,
          kind,
          status: "active",
          openingBalance,
        },
      });
      await batch.commit();
      return NextResponse.json({ success: true, accountId, ledgerAccountId });
    }

    if (action === "account_update") {
      const accountId = String(body.accountId ?? "");
      const accountSnapshot = await ref.collection("bankAccounts").doc(accountId).get();
      if (!accountSnapshot.exists) return fail("Cash/bank account not found.");

      const before = accountSnapshot.data() as any;
      const displayName = String(body.displayName ?? before.displayName).trim();
      if (!displayName) return fail("Account name is required.");

      const after = {
        businessId,
        accountId,
        displayName,
        bankName: String(body.bankName ?? before.bankName ?? ""),
        accountNumber: String(body.accountNumber ?? before.accountNumber ?? ""),
        ifscCode: String(body.ifscCode ?? before.ifscCode ?? ""),
        upiId: String(body.upiId ?? before.upiId ?? ""),
        accountHolderName: String(
          body.accountHolderName ?? before.accountHolderName ?? "",
        ),
        printQrOnInvoice:
          body.printQrOnInvoice === undefined
            ? Boolean(before.printQrOnInvoice)
            : Boolean(body.printQrOnInvoice),
        printDetailsOnInvoice:
          body.printDetailsOnInvoice === undefined
            ? Boolean(before.printDetailsOnInvoice)
            : Boolean(body.printDetailsOnInvoice),
        updatedAt: Timestamp.now(),
      };

      await ref.collection("bankAccounts").doc(accountId).set(after, { merge: true });
      await ref.collection("auditLogs").doc(`audit-${randomUUID()}`).set({
        businessId,
        entityType: "cash_bank_account",
        entityId: accountId,
        action: "ACCOUNT_UPDATED",
        userId: token.uid,
        timestamp: new Date().toISOString(),
        before,
        after,
      });
      return NextResponse.json({ success: true });
    }

    if (action === "account_status") {
      const accountId = String(body.accountId ?? "");
      const status = String(body.status ?? "");
      if (!["active", "inactive"].includes(status)) {
        return fail("Account status must be active or inactive.");
      }

      const accountSnapshot = await ref.collection("bankAccounts").doc(accountId).get();
      if (!accountSnapshot.exists) return fail("Cash/bank account not found.");

      const before = accountSnapshot.data() as any;
      const ledgerAccountId = String(before.ledgerAccountId ?? "");
      const batch = db.batch();
      batch.set(
        ref.collection("bankAccounts").doc(accountId),
        { businessId, accountId, status, updatedAt: Timestamp.now() },
        { merge: true },
      );
      if (ledgerAccountId) {
        batch.set(
          ref.collection("accounts").doc(ledgerAccountId),
          { businessId, active: status === "active", updatedAt: new Date().toISOString() },
          { merge: true },
        );
      }
      batch.set(ref.collection("auditLogs").doc(`audit-${randomUUID()}`), {
        businessId,
        entityType: "cash_bank_account",
        entityId: accountId,
        action: status === "active" ? "ACCOUNT_ACTIVATED" : "ACCOUNT_DEACTIVATED",
        userId: token.uid,
        timestamp: new Date().toISOString(),
        before,
        after: { ...before, status },
      });
      await batch.commit();
      return NextResponse.json({ success: true, status });
    }

    if (action === "reverse") {
      const voucherId = String(body.voucherId ?? "");
      const voucherSnapshot = await ref.collection("vouchers").doc(voucherId).get();
      if (!voucherSnapshot.exists) return fail("Voucher not found.");

      const voucher = voucherSnapshot.data() as any;
      if (voucher.businessId !== businessId) {
        return fail("Voucher does not belong to this business.", 403);
      }
      if (!["cash_bank", "cash_bank_transfer"].includes(String(voucher.referenceType ?? ""))) {
        return fail("Only Cash & Bank vouchers can be reversed from this module.", 403);
      }
      if (!["RECEIPT", "PAYMENT", "CONTRA"].includes(String(voucher.voucherType ?? ""))) {
        return fail("Only Cash & Bank receipt, payment and contra vouchers can be reversed here.", 403);
      }

      const originalFinancialYearId = String(voucher.financialYearId ?? "");
      if (!originalFinancialYearId) return fail("Voucher has no financial year.");

      const reversalDate = String(body.date ?? voucher.date ?? new Date().toISOString().slice(0, 10));
      const result = await reversePostedVoucher(
        repo,
        {
          businessId,
          financialYearId: originalFinancialYearId,
          voucherId,
          userId: token.uid,
          idempotencyKey: idempotencyKey(body),
          date: reversalDate,
          narration: String(
            body.narration ??
              `Cash/Bank transaction reversal of ${voucher.voucherNumber ?? voucherId}`,
          ),
        },
        deps(),
      );
      return NextResponse.json({ success: true, result });
    }

    return fail("Unknown Cash & Bank action.");
  } catch (error: any) {
    return fail(
      error?.message ?? "Cash & Bank operation failed.",
      error?.status ?? 400,
    );
  }
}
