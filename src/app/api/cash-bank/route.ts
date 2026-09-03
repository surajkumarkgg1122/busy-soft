import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getAdminServices } from "@/infrastructure/firebase/admin";
import { createAdminAccountingRepository } from "@/infrastructure/firebase/adminAccountingRepository";
import { createCashBankAccount, postCashBankEntry, postCashBankTransfer } from "@/core/accounting/cashBank";
import { reversePostedVoucher } from "@/core/accounting/voucherReversal";
import { buildCashBankLedgerHistory } from "@/core/accounting/cashBankHistory";

export const runtime = "nodejs";
type Member = { role?: string; status?: string; permissions?: Record<string, any> };
const fail = (message: string, status = 400) => NextResponse.json({ success: false, error: message }, { status });
const businessRef = (db: any, businessId: string) => db.collection("businesses").doc(businessId);
const deps = () => ({ ids: { next: (prefix: string) => `${prefix}-${randomUUID()}` }, clock: { now: () => new Date().toISOString() } });

async function authenticate(request: Request) {
  const { auth, db } = getAdminServices();
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) throw Object.assign(new Error("Authentication is required."), { status: 401 });
  try { return { db, token: await auth.verifyIdToken(header.slice(7)) }; }
  catch { throw Object.assign(new Error("Authentication token is invalid or expired."), { status: 401 }); }
}
async function requireMembership(db: any, businessId: string, uid: string): Promise<Member> {
  const snap = await businessRef(db, businessId).collection("members").doc(uid).get();
  if (!snap.exists || snap.data()?.status !== "active") throw Object.assign(new Error("You are not an active member of this business."), { status: 403 });
  return (snap.data() ?? {}) as Member;
}
function allowed(member: Member, action: "create" | "edit" | "view") { return member.role === "owner" || member.role === "admin" || member.permissions?.cashBank?.[action] === true; }
function idempotencyKey(body: Record<string, unknown>) { const key = String(body.idempotencyKey ?? "").trim(); if (key.length < 16 || key.length > 128) throw new Error("A valid idempotency key is required."); return key; }
function date(value: unknown, name = "Date") { const v = String(value ?? ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${name} must be YYYY-MM-DD.`); return v; }
function rupees(value: unknown, name = "Amount") { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be zero or greater.`); const minor = Math.round(n * 100); if (!Number.isSafeInteger(minor)) throw new Error(`${name} is too large or invalid.`); return minor; }
function positiveRupees(value: unknown, name = "Amount") { const minor = rupees(value, name); if (minor <= 0) throw new Error(`${name} must be greater than zero.`); return minor; }

async function currentFinancialYear(db: any, businessId: string) {
  const snap = await businessRef(db, businessId).collection("financialYears").where("locked", "==", false).get();
  const years = snap.docs.map((doc: any) => ({ id: doc.id, startDate: String(doc.data()?.startDate ?? "") })).sort((a: any, b: any) => b.startDate.localeCompare(a.startDate));
  if (!years.length) throw new Error("No open financial year is configured for this business.");
  return years[0].id;
}

export async function GET(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const url = new URL(request.url);
    const businessId = String(url.searchParams.get("businessId") ?? "").trim();
    if (!businessId) return fail("Business ID is required.");
    const member = await requireMembership(db, businessId, token.uid);
    if (!allowed(member, "view")) return fail("Cash & Bank view permission denied.", 403);
    const ref = businessRef(db, businessId);
    const financialYearId = await currentFinancialYear(db, businessId);
    const includeInactive = url.searchParams.get("includeInactive") === "true";
    const accountQuery = includeInactive ? ref.collection("bankAccounts") : ref.collection("bankAccounts").where("status", "==", "active");
    const [accountSnapshot, glSnapshot, partySnapshot] = await Promise.all([
      accountQuery.get(),
      ref.collection("accounts").where("active", "==", true).get(),
      ref.collection("parties").where("status", "==", "active").get(),
    ]);

    const accountDocs = accountSnapshot.docs.map((doc: any) => ({ accountId: doc.id, ...doc.data() }));
    const ledgerAccountIds = accountDocs.map((account: any) => String(account.ledgerAccountId ?? "")).filter(Boolean);
    const history = await buildCashBankLedgerHistory(db, ref, financialYearId, ledgerAccountIds);
    const ledger = history.rows;
    const glMap = new Map<string, any>(glSnapshot.docs.map((doc: any) => [doc.id, { accountId: doc.id, ...doc.data() }]));
    const activity = new Map<string, number>();
    for (const row of ledger) activity.set(row.accountId, (activity.get(row.accountId) ?? 0) + Number(row.debit ?? 0) - Number(row.credit ?? 0));

    const accounts = accountDocs.map((account: any) => {
      const ledgerAccountId = String(account.ledgerAccountId ?? "");
      const gl = glMap.get(ledgerAccountId);
      const storedOpening = Number(account.openingBalance ?? 0) * (String(account.openingBalanceType ?? "debit") === "credit" ? -1 : 1);
      const glOpening = Number(gl?.openingDebit ?? 0) - Number(gl?.openingCredit ?? 0);
      const hasCanonicalOpening = Boolean(account.openingVoucherId) || account.openingBalance !== undefined;
      const opening = hasCanonicalOpening ? storedOpening : glOpening;
      return { ...account, currentBalance: opening + Number(activity.get(ledgerAccountId) ?? 0), balanceSource: history.source, ledgerHealthy: Boolean(gl && gl.type === "asset" && gl.active !== false) };
    });

    const glAccounts = glSnapshot.docs.map((doc: any) => ({ accountId: doc.id, ...doc.data() })).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    const parties = partySnapshot.docs.map((doc: any) => { const p = doc.data() as any; return { partyId: doc.id, name: String(p.name ?? doc.id), kind: p.kind, ledgerAccountId: String(p.ledgerAccountId ?? "") }; }).filter((p: any) => p.ledgerAccountId).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
    return NextResponse.json({ success: true, financialYearId, accounts, glAccounts, parties, ledger: ledger.slice(-1000).reverse(), hasMoreLedger: ledger.length > 1000, historySource: history.source });
  } catch (error: any) { return fail(error?.message ?? "Unable to load cash and bank data.", error?.status ?? 500); }
}

export async function POST(request: Request) {
  try {
    const { db, token } = await authenticate(request);
    const body = (await request.json()) as Record<string, any>;
    const businessId = String(body.businessId ?? "").trim();
    if (!businessId) return fail("Business ID is required.");
    const member = await requireMembership(db, businessId, token.uid);
    const action = String(body.action ?? "");
    if (["entry", "transfer", "account"].includes(action) && !allowed(member, "create")) return fail("Cash & Bank create permission denied.", 403);
    if (["account_update", "account_status", "reverse"].includes(action) && !allowed(member, "edit")) return fail("Cash & Bank edit permission denied.", 403);
    const ref = businessRef(db, businessId);
    const financialYearId = String(body.financialYearId ?? (await currentFinancialYear(db, businessId)));
    const repo = createAdminAccountingRepository(businessId);

    if (action === "account") {
      const kind = body.kind === "cash" ? "cash" : "bank";
      const displayName = String(body.displayName ?? "").trim();
      if (!displayName) return fail("Account name is required.");
      const openingBalance = rupees(body.openingBalance ?? 0, "Opening balance");
      const openingBalanceType = body.openingBalanceType === "credit" ? "credit" : "debit";
      const openingBalanceDate = date(body.openingBalanceDate ?? new Date().toISOString().slice(0, 10), "Opening balance date");
      const accountId = `${kind}-${randomUUID()}`;
      const ledgerAccountId = `cashbank-${randomUUID()}`;
      const parentAccountId = kind === "cash" ? "acct-cash" : "acct-bank";
      const parent = await ref.collection("accounts").doc(parentAccountId).get();
      if (!parent.exists || parent.data()?.type !== "asset") return fail("Cash/Bank parent account is not configured.");
      const result = await createCashBankAccount(repo, { businessId, financialYearId, accountId, displayName, ledgerAccountId, kind, parentAccountId, openingBalance, openingBalanceType, openingBalanceDate, createdBy: token.uid, details: { printQrOnInvoice: Boolean(body.printQrOnInvoice), printDetailsOnInvoice: Boolean(body.printDetailsOnInvoice), accountNumber: String(body.accountNumber ?? ""), ifscCode: String(body.ifscCode ?? ""), upiId: String(body.upiId ?? ""), bankName: String(body.bankName ?? ""), accountHolderName: String(body.accountHolderName ?? "") } }, deps());
      return NextResponse.json({ success: true, ...result });
    }

    if (action === "account_update") {
      const accountId = String(body.accountId ?? "");
      const snap = await ref.collection("bankAccounts").doc(accountId).get();
      if (!snap.exists) return fail("Cash/bank account not found.");
      const before = snap.data() as any;
      const displayName = String(body.displayName ?? before.displayName).trim();
      if (!displayName) return fail("Account name is required.");
      await ref.collection("bankAccounts").doc(accountId).set({ businessId, accountId, displayName, bankName: String(body.bankName ?? before.bankName ?? ""), accountNumber: String(body.accountNumber ?? before.accountNumber ?? ""), ifscCode: String(body.ifscCode ?? before.ifscCode ?? ""), upiId: String(body.upiId ?? before.upiId ?? ""), accountHolderName: String(body.accountHolderName ?? before.accountHolderName ?? ""), updatedAt: new Date() }, { merge: true });
      return NextResponse.json({ success: true });
    }

    if (action === "account_status") {
      const accountId = String(body.accountId ?? "");
      const status = String(body.status ?? "");
      if (status !== "active" && status !== "inactive") return fail("Account status must be active or inactive.");
      const snap = await ref.collection("bankAccounts").doc(accountId).get();
      if (!snap.exists) return fail("Cash/bank account not found.");
      const before = snap.data() as any;
      const batch = db.batch();
      batch.set(ref.collection("bankAccounts").doc(accountId), { businessId, accountId, status, updatedAt: new Date() }, { merge: true });
      if (before.ledgerAccountId) batch.set(ref.collection("accounts").doc(String(before.ledgerAccountId)), { active: status === "active", updatedAt: new Date().toISOString() }, { merge: true });
      batch.set(ref.collection("auditLogs").doc(`audit-${randomUUID()}`), { businessId, entityType: "cash_bank_account", entityId: accountId, action: status === "active" ? "ACCOUNT_ACTIVATED" : "ACCOUNT_DEACTIVATED", userId: token.uid, timestamp: new Date().toISOString(), before, after: { ...before, status } });
      await batch.commit();
      return NextResponse.json({ success: true, status });
    }

    if (action === "entry") {
      const accountId = String(body.accountId ?? "");
      const snap = await ref.collection("bankAccounts").doc(accountId).get();
      if (!snap.exists) return fail("Cash/bank account not found.");
      const account = snap.data() as any;
      if (account.status !== "active") return fail("Cash/bank account is inactive.");
      const type = String(body.type ?? "") as any;
      if (!["deposit", "withdrawal", "cash_deposit", "cash_withdrawal"].includes(type)) return fail("Invalid Cash & Bank entry type.");
      const contraAccountId = String(body.contraAccountId ?? "").trim();
      if (!contraAccountId) return fail("Counter account is required.");
      const result = await postCashBankEntry(repo, { businessId, financialYearId, date: date(body.date), userId: token.uid, idempotencyKey: idempotencyKey(body), accountId, ledgerAccountId: String(account.ledgerAccountId ?? ""), type, amount: positiveRupees(body.amount), contraAccountId, partyId: String(body.partyId ?? "").trim() || undefined, narration: String(body.name ?? "Cash/Bank transaction"), reference: String(body.reference ?? ""), notes: String(body.notes ?? "") }, deps());
      return NextResponse.json({ success: true, voucherId: result.voucher.id, voucherNumber: result.voucher.voucherNumber });
    }

    if (action === "transfer") {
      const fromAccountId = String(body.fromAccountId ?? "");
      const toAccountId = String(body.toAccountId ?? "");
      const [fromSnap, toSnap] = await Promise.all([ref.collection("bankAccounts").doc(fromAccountId).get(), ref.collection("bankAccounts").doc(toAccountId).get()]);
      if (!fromSnap.exists || !toSnap.exists) return fail("Both cash/bank accounts are required.");
      const from = fromSnap.data() as any;
      const to = toSnap.data() as any;
      const result = await postCashBankTransfer(repo, { businessId, financialYearId, date: date(body.date), userId: token.uid, idempotencyKey: idempotencyKey(body), fromAccountId, fromLedgerAccountId: String(from.ledgerAccountId ?? ""), toAccountId, toLedgerAccountId: String(to.ledgerAccountId ?? ""), amount: positiveRupees(body.amount), narration: String(body.notes ?? "Cash/Bank transfer"), reference: String(body.reference ?? ""), notes: String(body.notes ?? "") }, deps());
      return NextResponse.json({ success: true, voucherId: result.voucher.id, voucherNumber: result.voucher.voucherNumber, fromAccountId, toAccountId });
    }

    if (action === "reverse") {
      const voucherId = String(body.voucherId ?? "");
      const voucherSnap = await ref.collection("vouchers").doc(voucherId).get();
      if (!voucherSnap.exists) return fail("Voucher not found.");
      const voucher = voucherSnap.data() as any;
      if (voucher.businessId !== businessId) return fail("Voucher does not belong to this business.", 403);
      if (!["cash_bank", "cash_bank_transfer"].includes(String(voucher.referenceType ?? ""))) return fail("Only Cash & Bank transaction vouchers can be reversed from this module.", 403);
      if (!["RECEIPT", "PAYMENT", "CONTRA"].includes(String(voucher.voucherType ?? ""))) return fail("Only posted receipt, payment and contra vouchers can be reversed here.", 403);
      const result = await reversePostedVoucher(repo, { businessId, financialYearId: String(voucher.financialYearId ?? financialYearId), voucherId, userId: token.uid, idempotencyKey: idempotencyKey(body), date: date(body.date ?? voucher.date, "Reversal date"), narration: String(body.narration ?? `Cash/Bank transaction reversal of ${voucher.voucherNumber ?? voucherId}`) }, deps());
      return NextResponse.json({ success: true, voucherId: result.voucher.id, voucherNumber: result.voucher.voucherNumber });
    }

    return fail("Unknown Cash & Bank action.");
  } catch (error: any) { return fail(error?.message ?? "Unable to process Cash & Bank request.", error?.status ?? 500); }
}
