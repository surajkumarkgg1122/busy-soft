"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { firebaseAuth } from "@/lib/firebase";
import { useBusiness } from "@/context/BusinessContext";
import Sidebar from "@/app/Components/Sidebar/page";
import TopNav from "@/app/Components/TopNav/page";
import AuthGate from "@/app/Components/Auth/AuthGate";

type Account = {
  accountId: string;
  businessId: string;
  displayName: string;
  kind: "cash" | "bank";
  ledgerAccountId: string;
  currentBalance: number;
  openingBalance: number;
  openingBalanceType?: "debit" | "credit";
  openingBalanceDate?: string;
  openingVoucherId?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  upiId?: string;
  accountHolderName?: string;
  status: "active" | "inactive";
  ledgerHealthy?: boolean;
};

type GL = { accountId: string; name: string; type: string; active: boolean };
type Party = { partyId: string; name: string; kind: "customer" | "supplier"; ledgerAccountId: string };
type Ledger = {
  lineId: string;
  voucherId: string;
  date: string;
  voucherNumber?: string;
  voucherType?: string;
  accountId: string;
  partyId?: string;
  description?: string;
  debit: number;
  credit: number;
};

type Modal = "account" | "entry" | "transfer" | null;
type EntryType = "deposit" | "withdrawal";
type CounterMode = "ledger" | "party";

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((Number(value) || 0) / 100);

const inputClass =
  "w-full rounded-lg border border-[#d0d5dd] bg-white px-3 py-2.5 text-sm text-[#101828] outline-none transition focus:border-[#465fff] focus:ring-2 focus:ring-[#465fff]/10";
const buttonClass =
  "inline-flex items-center justify-center rounded-lg border border-[#d0d5dd] bg-white px-3.5 py-2 text-sm font-semibold text-[#344054] shadow-sm transition hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-50";
const primaryButtonClass =
  "inline-flex items-center justify-center rounded-lg bg-[#465fff] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#364bdc] disabled:cursor-not-allowed disabled:opacity-50";

async function api(path: string, body?: Record<string, unknown>) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("You must be signed in.");

  const token = await user.getIdToken();
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  const text = await response.text();
  let payload: Record<string, any> = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      text.trim()
        ? `Server returned a non-JSON response (HTTP ${response.status}).`
        : `Server returned an empty response (HTTP ${response.status}).`,
    );
  }

  if (!response.ok || payload.success !== true) {
    throw new Error(String(payload.error || `Server request failed (HTTP ${response.status}).`));
  }
  return payload;
}

function Icon({ name }: { name: "cash" | "bank" | "transfer" | "plus" | "refresh" | "edit" | "undo" | "power" | "search" }) {
  const paths = {
    cash: "M4 7h16v12H4zM7 7V5h10v2M8 13h8M12 10v6",
    bank: "M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 18h18",
    transfer: "M7 7h10l-3-3m3 3-3 3M17 17H7l3 3m-3-3 3-3",
    plus: "M12 5v14M5 12h14",
    refresh: "M20 11a8 8 0 0 0-14.7-4L3 10m0 0h5m-5 0V5m1 8a8 8 0 0 0 14.7 4L21 14m0 0h-5m5 0v5",
    edit: "m4 20 4.3-1 10.1-10.1a2.1 2.1 0 0 0-3-3L5.3 16 4 20ZM14.8 7.2l2 2",
    undo: "M9 8H4v5m0-5 4 4",
    power: "M12 3v9m6.4-6.4a9 9 0 1 1-12.8 0",
    search: "m21 21-4.5-4.5M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  } as const;

  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-[#344054]">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-[#98a2b3]">{hint}</span> : null}
    </label>
  );
}

function ModalShell({
  title,
  subtitle,
  children,
  footer,
  onClose,
  error,
  width = "max-w-2xl",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  error?: string;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`w-full ${width} overflow-hidden rounded-2xl border border-[#e4e7ec] bg-white shadow-2xl`}>
        <div className="flex items-start justify-between border-b border-[#eaecf0] px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#101828]">{title}</h2>
            {subtitle ? <p className="mt-1 text-xs text-[#667085]">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xl text-[#667085] hover:bg-[#f2f4f7]">
            ×
          </button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto px-6 py-5">
          {error ? <div className="mb-4 rounded-lg border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div> : null}
          {children}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#eaecf0] bg-[#f9fafb] px-6 py-4">{footer}</div>
      </div>
    </div>
  );
}

function SummaryCard({ title, value, subtitle, icon }: { title: string; value: string; subtitle: string; icon: "cash" | "bank" }) {
  return (
    <div className="rounded-xl border border-[#e4e7ec] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#98a2b3]">{title}</p>
          <p className="mt-2 text-2xl font-bold text-[#101828]">{value}</p>
          <p className="mt-1 text-xs text-[#667085]">{subtitle}</p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f5f7ff] text-[#465fff]"><Icon name={icon} /></span>
      </div>
    </div>
  );
}

function Metric({ title, value, tone = "normal" }: { title: string; value: string; tone?: "normal" | "good" | "bad" }) {
  const toneClass = tone === "good" ? "text-[#027a48]" : tone === "bad" ? "text-[#b42318]" : "text-[#101828]";
  return (
    <div className="border-r border-[#eaecf0] px-5 py-4 last:border-r-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#98a2b3]">{title}</p>
      <p className={`mt-1 text-sm font-bold ${toneClass}`}>{value}</p>
    </div>
  );
}

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-[#e4e7ec] bg-white p-4">
      <p className="text-xs font-bold text-[#344054]">{title}</p>
      <p className="mt-1 text-xs leading-5 text-[#667085]">{text}</p>
    </div>
  );
}

export default function CashBankPage() {
  const { activeBusinessId, activeBusiness, can, loading: businessLoading } = useBusiness();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [gl, setGl] = useState<GL[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [financialYearId, setFinancialYearId] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const [kind, setKind] = useState<"cash" | "bank">("bank");
  const [openingType, setOpeningType] = useState<"debit" | "credit">("debit");
  const [entryType, setEntryType] = useState<EntryType>("deposit");
  const [counterMode, setCounterMode] = useState<CounterMode>("ledger");

  const [accountForm, setAccountForm] = useState({
    displayName: "",
    openingBalance: "0",
    openingBalanceDate: today(),
    bankName: "",
    accountNumber: "",
    ifscCode: "",
    upiId: "",
    accountHolderName: "",
  });
  const [entryForm, setEntryForm] = useState({ name: "", amount: "", date: today(), reference: "", notes: "", contra: "", party: "" });
  const [transferForm, setTransferForm] = useState({ from: "", to: "", amount: "", date: today(), reference: "", notes: "" });

  const canCreate = can("cashBank", "create");
  const canEdit = can("cashBank", "edit");
  const isEditing = editingAccountId !== null;

  async function load() {
    if (!activeBusinessId) {
      setAccounts([]);
      setSelected(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/cash-bank?businessId=${encodeURIComponent(activeBusinessId)}&includeInactive=${showInactive}`);
      const nextAccounts = (data.accounts || []) as Account[];
      setAccounts(nextAccounts);
      setGl((data.glAccounts || []) as GL[]);
      setParties((data.parties || []) as Party[]);
      setLedger((data.ledger || []) as Ledger[]);
      setFinancialYearId(String(data.financialYearId || ""));
      setSelected((previous) => nextAccounts.find((a) => a.accountId === previous?.accountId) || nextAccounts.find((a) => a.status === "active") || nextAccounts[0] || null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load Cash & Bank.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!businessLoading) void load();
  }, [activeBusinessId, businessLoading, showInactive]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((account) => !q || `${account.displayName} ${account.bankName || ""} ${account.accountNumber || ""}`.toLowerCase().includes(q));
  }, [accounts, query]);

  const activeAccounts = useMemo(() => accounts.filter((account) => account.status === "active"), [accounts]);
  const totals = useMemo(
    () => ({
      cash: activeAccounts.filter((account) => account.kind === "cash").reduce((sum, account) => sum + account.currentBalance, 0),
      bank: activeAccounts.filter((account) => account.kind === "bank").reduce((sum, account) => sum + account.currentBalance, 0),
    }),
    [activeAccounts],
  );

  const selectedRows = useMemo(
    () => (selected ? ledger.filter((row) => row.accountId === selected.ledgerAccountId).sort((a, b) => `${a.date}:${a.voucherNumber || ""}:${a.lineId}`.localeCompare(`${b.date}:${b.voucherNumber || ""}:${b.lineId}`)) : []),
    [selected, ledger],
  );

  const running = useMemo(() => {
    const start = Number(selected?.openingBalance || 0);
    return selectedRows.reduce<{ rows: Array<Ledger & { balance: number }>; balance: number }>((state, row) => {
      const balance = state.balance + Number(row.debit || 0) - Number(row.credit || 0);
      state.rows.push({ ...row, balance });
      return state;
    }, { rows: [], balance: start });
  }, [selectedRows, selected]);

  const ledgerAccounts = useMemo(() => gl.filter((account) => account.active !== false && account.accountId !== selected?.ledgerAccountId), [gl, selected]);
  const selectedParty = parties.find((party) => party.partyId === entryForm.party);
  const source = activeAccounts.find((account) => account.accountId === transferForm.from);
  const destination = activeAccounts.find((account) => account.accountId === transferForm.to);
  const lastActivity = selectedRows.length ? selectedRows[selectedRows.length - 1].date : "—";

  function closeModal() {
    setModal(null);
    setEditingAccountId(null);
    setActionError("");
    setSaving(false);
  }

  function openNewAccount() {
    setEditingAccountId(null);
    setKind("bank");
    setOpeningType("debit");
    setAccountForm({ displayName: "", openingBalance: "0", openingBalanceDate: today(), bankName: "", accountNumber: "", ifscCode: "", upiId: "", accountHolderName: "" });
    setActionError("");
    setModal("account");
  }

  function openEdit() {
    if (!selected) return;
    setEditingAccountId(selected.accountId);
    setKind(selected.kind);
    setAccountForm({ displayName: selected.displayName, openingBalance: (Number(selected.openingBalance || 0) / 100).toFixed(2), openingBalanceDate: selected.openingBalanceDate || today(), bankName: selected.bankName || "", accountNumber: selected.accountNumber || "", ifscCode: selected.ifscCode || "", upiId: selected.upiId || "", accountHolderName: selected.accountHolderName || "" });
    setActionError("");
    setModal("account");
  }

  function openEntry(type: EntryType) {
    if (!selected || selected.status !== "active" || !selected.ledgerHealthy) return;
    setEntryType(type);
    setCounterMode("ledger");
    setEntryForm({ name: "", amount: "", date: today(), reference: "", notes: "", contra: "", party: "" });
    setActionError("");
    setModal("entry");
  }

  function openTransfer() {
    const preferred = selected?.status === "active" ? selected.accountId : "";
    const fallback = activeAccounts.find((account) => account.accountId !== preferred)?.accountId || "";
    setTransferForm({ from: preferred || activeAccounts[0]?.accountId || "", to: preferred ? fallback : activeAccounts[1]?.accountId || "", amount: "", date: today(), reference: "", notes: "" });
    setActionError("");
    setModal("transfer");
  }

  async function submitAccount() {
    if (!activeBusinessId) return;
    try {
      setSaving(true);
      setActionError("");
      if (!accountForm.displayName.trim()) throw new Error("Account name is required.");
      const amount = Number(accountForm.openingBalance);
      if (!isEditing && (!Number.isFinite(amount) || amount < 0)) throw new Error("Opening balance must be zero or greater.");
      if (!isEditing && kind === "bank" && !accountForm.bankName.trim()) throw new Error("Bank name is required for a bank account.");

      const body = isEditing
        ? { action: "account_update", businessId: activeBusinessId, accountId: editingAccountId, displayName: accountForm.displayName.trim(), bankName: accountForm.bankName, accountNumber: accountForm.accountNumber, ifscCode: accountForm.ifscCode, upiId: accountForm.upiId, accountHolderName: accountForm.accountHolderName }
        : { action: "account", businessId: activeBusinessId, financialYearId, kind, displayName: accountForm.displayName.trim(), openingBalance: amount, openingBalanceType: openingType, openingBalanceDate: accountForm.openingBalanceDate, bankName: accountForm.bankName, accountNumber: accountForm.accountNumber, ifscCode: accountForm.ifscCode, upiId: accountForm.upiId, accountHolderName: accountForm.accountHolderName };

      await api("/api/cash-bank", body);
      closeModal();
      await load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Unable to save account.");
    } finally {
      setSaving(false);
    }
  }

  async function submitEntry() {
    if (!activeBusinessId || !selected) return;
    try {
      setSaving(true);
      setActionError("");
      const amount = Number(entryForm.amount);
      if (!selected.ledgerHealthy) throw new Error("This account is not linked to a healthy ledger account.");
      if (!entryForm.name.trim()) throw new Error("Description is required.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive amount.");

      let contraAccountId = entryForm.contra;
      let partyId: string | undefined;
      if (counterMode === "party") {
        if (!selectedParty) throw new Error("Select a customer or supplier.");
        contraAccountId = selectedParty.ledgerAccountId;
        partyId = selectedParty.partyId;
      } else if (!contraAccountId) {
        throw new Error("Select a counter ledger.");
      }

      await api("/api/cash-bank", {
        action: "entry",
        businessId: activeBusinessId,
        financialYearId,
        accountId: selected.accountId,
        type: entryType,
        amount,
        name: entryForm.name.trim(),
        date: entryForm.date,
        reference: entryForm.reference.trim(),
        notes: entryForm.notes.trim(),
        contraAccountId,
        ...(partyId ? { partyId } : {}),
        idempotencyKey: `cb-${crypto.randomUUID()}`,
      });

      closeModal();
      await load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Unable to post transaction.");
    } finally {
      setSaving(false);
    }
  }

  async function submitTransfer() {
    if (!activeBusinessId) return;
    try {
      setSaving(true);
      setActionError("");
      const amount = Number(transferForm.amount);
      if (!source || !destination) throw new Error("Select both active accounts.");
      if (source.accountId === destination.accountId) throw new Error("Source and destination accounts must be different.");
      if (!source.ledgerHealthy || !destination.ledgerHealthy) throw new Error("Both accounts must have healthy ledger links.");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive transfer amount.");

      await api("/api/cash-bank", {
        action: "transfer",
        businessId: activeBusinessId,
        financialYearId,
        fromAccountId: source.accountId,
        fromLedgerAccountId: source.ledgerAccountId,
        toAccountId: destination.accountId,
        toLedgerAccountId: destination.ledgerAccountId,
        amount,
        date: transferForm.date,
        reference: transferForm.reference.trim(),
        notes: transferForm.notes.trim(),
        idempotencyKey: `cb-transfer-${crypto.randomUUID()}`,
      });

      closeModal();
      await load();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Unable to post transfer.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!activeBusinessId || !selected) return;
    try {
      setSaving(true);
      setError("");
      await api("/api/cash-bank", { action: "account_status", businessId: activeBusinessId, accountId: selected.accountId, status: selected.status === "active" ? "inactive" : "active" });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change account status.");
    } finally {
      setSaving(false);
    }
  }

  async function reverse(voucherId: string, date: string) {
    if (!activeBusinessId) return;
    if (!window.confirm("Reverse this voucher? The original posting will remain in history and a controlled reversal will be created.")) return;
    try {
      setSaving(true);
      setError("");
      await api("/api/cash-bank", { action: "reverse", businessId: activeBusinessId, voucherId, date, idempotencyKey: `cb-reversal-${crypto.randomUUID()}` });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to reverse voucher.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthGate>
      <div className="min-h-screen bg-[#f8f9fb]">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8">
            <TopNav />
            <div className="mx-auto max-w-[1600px] py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#465fff]">{activeBusiness?.business.name || "Business"} · Accounting</p>
                  <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#101828]">Cash & Bank</h1>
                  <p className="mt-1 max-w-3xl text-sm text-[#667085]">Every cash or bank movement is a real accounting voucher. The same GL transaction feeds balances, party ledgers and reports.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={buttonClass} disabled={loading} onClick={() => void load()}><Icon name="refresh" /><span className="ml-2">Refresh</span></button>
                  {canCreate && activeAccounts.length >= 2 ? <button type="button" className={buttonClass} onClick={openTransfer}><Icon name="transfer" /><span className="ml-2">Transfer</span></button> : null}
                  {canCreate ? <button type="button" className={primaryButtonClass} onClick={openNewAccount}><Icon name="plus" /><span className="ml-2">New Account</span></button> : null}
                </div>
              </div>

              {error ? <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]"><span>{error}</span><button type="button" onClick={() => setError("")} className="font-bold">×</button></div> : null}

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <SummaryCard title="Total liquidity" value={money(totals.cash + totals.bank)} subtitle="Active cash + bank ledgers" icon="bank" />
                <SummaryCard title="Cash in hand" value={money(totals.cash)} subtitle={`${activeAccounts.filter((a) => a.kind === "cash").length} active cash account(s)`} icon="cash" />
                <SummaryCard title="Bank balance" value={money(totals.bank)} subtitle={`${activeAccounts.filter((a) => a.kind === "bank").length} active bank account(s)`} icon="bank" />
              </div>

              <section className="mt-6 overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaecf0] px-5 py-4">
                  <div>
                    <h2 className="font-bold text-[#101828]">Cash & Bank accounts</h2>
                    <p className="mt-0.5 text-xs text-[#98a2b3]">FY {financialYearId || "—"} · balances derive from canonical accounting entries</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-medium text-[#667085]"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />Show inactive</label>
                    <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"><Icon name="search" /></span><input className={`${inputClass} h-9 w-64 pl-9`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search account, bank or number" /></div>
                  </div>
                </div>

                <div className="grid lg:grid-cols-[390px_1fr]">
                  <aside className="border-b border-[#eaecf0] lg:border-b-0 lg:border-r">
                    {loading ? (
                      <div className="space-y-3 p-5">{[1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-lg bg-[#f2f4f7]" />)}</div>
                    ) : filtered.length === 0 ? (
                      <div className="p-10 text-center"><p className="text-sm font-semibold text-[#344054]">No accounts found</p><p className="mt-1 text-xs text-[#98a2b3]">Create a cash or bank account to start posting.</p></div>
                    ) : (
                      <div className="divide-y divide-[#eaecf0]">
                        {filtered.map((account) => (
                          <button key={account.accountId} type="button" onClick={() => setSelected(account)} className={`w-full p-5 text-left transition hover:bg-[#f9fafb] ${selected?.accountId === account.accountId ? "bg-[#f5f7ff]" : ""}`}>
                            <div className="flex items-start gap-3">
                              <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${account.kind === "cash" ? "bg-[#ecfdf3] text-[#039855]" : "bg-[#edf2ff] text-[#465fff]"}`}><Icon name={account.kind} /></span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-[#344054]">{account.displayName}</span><span className={`text-[11px] font-semibold ${account.status === "active" ? "text-[#039855]" : "text-[#98a2b3]"}`}>{account.status}</span></span>
                                <span className="mt-1 block truncate text-xs text-[#667085]">{account.kind === "bank" ? [account.bankName, account.accountNumber].filter(Boolean).join(" · ") || "Bank details not provided" : "Cash account"}</span>
                                <span className="mt-2 block text-lg font-bold text-[#101828]">{money(account.currentBalance)}</span>
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </aside>

                  <div className="min-h-[650px]">
                    {!selected ? (
                      <div className="flex min-h-[650px] items-center justify-center p-10 text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f2f4f7] text-[#667085]"><Icon name="bank" /></div><h3 className="mt-4 text-sm font-bold text-[#101828]">Select an account</h3><p className="mt-1 text-xs text-[#667085]">View accounting balance, vouchers and actions.</p></div></div>
                    ) : (
                      <>
                        <div className="border-b border-[#eaecf0] px-5 py-5">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2"><h3 className="text-xl font-bold text-[#101828]">{selected.displayName}</h3><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${selected.status === "active" ? "bg-[#ecfdf3] text-[#027a48]" : "bg-[#f2f4f7] text-[#667085]"}`}>{selected.status}</span></div>
                              <p className="mt-1 text-xs text-[#667085]">{selected.kind.toUpperCase()} · Ledger {selected.ledgerAccountId}</p>
                              {selected.kind === "bank" ? <p className="mt-1 text-xs text-[#98a2b3]">{[selected.bankName, selected.accountNumber, selected.ifscCode].filter(Boolean).join(" · ") || "Bank details not provided"}</p> : null}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {canCreate && selected.status === "active" ? <><button type="button" className={buttonClass} disabled={!selected.ledgerHealthy} onClick={() => openEntry("deposit")}>Receive / Deposit</button><button type="button" className={buttonClass} disabled={!selected.ledgerHealthy} onClick={() => openEntry("withdrawal")}>Pay / Withdraw</button></> : null}
                              {canEdit ? <button type="button" className={buttonClass} onClick={openEdit}><Icon name="edit" /><span className="ml-2">Edit</span></button> : null}
                              {canEdit ? <button type="button" className={buttonClass} disabled={saving} onClick={() => void toggleStatus()}><Icon name="power" /><span className="ml-2">{selected.status === "active" ? "Deactivate" : "Activate"}</span></button> : null}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 border-b border-[#eaecf0] sm:grid-cols-4">
                          <Metric title="Opening" value={`${selected.openingBalanceType === "credit" ? "Cr " : "Dr "}${money(selected.openingBalance || 0)}`} />
                          <Metric title="Current balance" value={`${selected.currentBalance < 0 ? "Cr " : "Dr "}${money(Math.abs(selected.currentBalance))}`} />
                          <Metric title="Ledger status" value={selected.ledgerHealthy ? "Healthy" : "Check link"} tone={selected.ledgerHealthy ? "good" : "bad"} />
                          <Metric title="Last activity" value={lastActivity} />
                        </div>

                        {!selected.ledgerHealthy ? <div className="mx-5 mt-4 rounded-lg border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-xs font-semibold text-[#b42318]">The linked GL account is unhealthy. Posting actions are disabled.</div> : null}

                        <div className="p-5">
                          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                            <div><h4 className="font-bold text-[#101828]">Account ledger</h4><p className="mt-0.5 text-xs text-[#98a2b3]">Opening and financial-year activity are shown from the same accounting ledger.</p></div>
                            {canCreate && activeAccounts.length >= 2 ? <button type="button" className={primaryButtonClass} onClick={openTransfer}><Icon name="transfer" /><span className="ml-2">Transfer Funds</span></button> : null}
                          </div>

                          {running.rows.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-[#d0d5dd] p-12 text-center"><p className="text-sm font-semibold text-[#344054]">No ledger activity</p><p className="mt-1 text-xs text-[#98a2b3]">Post a receipt, payment or transfer to see accounting activity here.</p></div>
                          ) : (
                            <div className="overflow-x-auto rounded-xl border border-[#eaecf0]">
                              <table className="w-full min-w-[900px] text-sm">
                                <thead className="bg-[#f9fafb] text-xs uppercase tracking-wide text-[#667085]"><tr><th className="px-3 py-3 text-left">Date</th><th className="px-3 py-3 text-left">Voucher</th><th className="px-3 py-3 text-left">Description</th><th className="px-3 py-3 text-right">Debit</th><th className="px-3 py-3 text-right">Credit</th><th className="px-3 py-3 text-right">Balance</th><th className="px-3 py-3" /></tr></thead>
                                <tbody className="divide-y divide-[#eaecf0]">
                                  {running.rows.map((row) => (
                                    <tr key={row.lineId} className="hover:bg-[#fcfcfd]">
                                      <td className="whitespace-nowrap px-3 py-3">{row.date}</td>
                                      <td className="whitespace-nowrap px-3 py-3 font-semibold">{row.voucherNumber || row.voucherId}</td>
                                      <td className="px-3 py-3">{row.description || row.voucherType || "—"}{row.partyId ? <span className="ml-2 rounded bg-[#f2f4f7] px-1.5 py-0.5 text-[10px] font-semibold text-[#667085]">Party</span> : null}</td>
                                      <td className="px-3 py-3 text-right">{row.debit ? money(row.debit) : "—"}</td>
                                      <td className="px-3 py-3 text-right">{row.credit ? money(row.credit) : "—"}</td>
                                      <td className="px-3 py-3 text-right font-bold">{row.balance < 0 ? "Cr " : "Dr "}{money(Math.abs(row.balance))}</td>
                                      <td className="px-3 py-3 text-right">{canEdit && !String(row.voucherType || "").toLowerCase().includes("reversal") && String(row.voucherType || "").toUpperCase() !== "OPENING" ? <button type="button" disabled={saving} onClick={() => void reverse(row.voucherId, row.date)} className="inline-flex items-center gap-1 rounded-md border border-[#fecdca] px-2 py-1 text-xs font-semibold text-[#b42318] hover:bg-[#fef3f2]"><Icon name="undo" />Reverse</button> : null}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </section>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <InfoCard title="One accounting source" text="Receipt, Payment, Contra and Opening are standard accounting vouchers, not a separate bank ledger." />
                <InfoCard title="Party-aware posting" text="Customer receipts and supplier payments can carry the party reference on the same voucher line used by party reports." />
                <InfoCard title="Reversible, not erasable" text="Posted vouchers remain in history. Reversal creates a compensating voucher instead of deleting accounting data." />
              </div>
            </div>
          </main>
        </div>

        {modal === "account" ? (
          <ModalShell
            title={isEditing ? "Edit Account" : "New Cash / Bank Account"}
            subtitle={isEditing ? "Update master information without changing posted accounting balances." : "Create the account and its GL master atomically; opening balance becomes an Opening voucher."}
            error={actionError}
            onClose={closeModal}
            footer={<><button type="button" className={buttonClass} onClick={closeModal}>Cancel</button><button type="button" disabled={saving} className={primaryButtonClass} onClick={() => void submitAccount()}>{saving ? "Saving…" : isEditing ? "Save Changes" : "Create Account"}</button></>}
          >
            {!isEditing ? <div className="mb-5 flex rounded-lg bg-[#f2f4f7] p-1"><button type="button" className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${kind === "cash" ? "bg-white text-[#101828] shadow-sm" : "text-[#667085]"}`} onClick={() => setKind("cash")}>Cash Account</button><button type="button" className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${kind === "bank" ? "bg-white text-[#101828] shadow-sm" : "text-[#667085]"}`} onClick={() => setKind("bank")}>Bank Account</button></div> : null}
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Account name"><input className={inputClass} value={accountForm.displayName} onChange={(event) => setAccountForm((form) => ({ ...form, displayName: event.target.value }))} placeholder={kind === "cash" ? "Cash Counter" : "HDFC Current Account"} /></Field>
              {!isEditing ? <Field label="Opening balance type"><select className={inputClass} value={openingType} onChange={(event) => setOpeningType(event.target.value as "debit" | "credit")}><option value="debit">Debit — normal asset balance</option><option value="credit">Credit — overdraft / credit balance</option></select></Field> : null}
              {!isEditing ? <Field label="Opening balance" hint="Entered in rupees; accounting stores minor currency units."><input className={inputClass} type="number" min="0" step="0.01" value={accountForm.openingBalance} onChange={(event) => setAccountForm((form) => ({ ...form, openingBalance: event.target.value }))} /></Field> : null}
              {!isEditing ? <Field label="Opening balance date"><input className={inputClass} type="date" value={accountForm.openingBalanceDate} onChange={(event) => setAccountForm((form) => ({ ...form, openingBalanceDate: event.target.value }))} /></Field> : null}
              {kind === "bank" ? <Field label="Bank name"><input className={inputClass} value={accountForm.bankName} onChange={(event) => setAccountForm((form) => ({ ...form, bankName: event.target.value }))} /></Field> : null}
              {kind === "bank" ? <Field label="Account number"><input className={inputClass} value={accountForm.accountNumber} onChange={(event) => setAccountForm((form) => ({ ...form, accountNumber: event.target.value }))} /></Field> : null}
              {kind === "bank" ? <Field label="IFSC"><input className={inputClass} value={accountForm.ifscCode} onChange={(event) => setAccountForm((form) => ({ ...form, ifscCode: event.target.value.toUpperCase() }))} /></Field> : null}
              {kind === "bank" ? <Field label="UPI ID"><input className={inputClass} value={accountForm.upiId} onChange={(event) => setAccountForm((form) => ({ ...form, upiId: event.target.value }))} /></Field> : null}
              {kind === "bank" ? <Field label="Account holder"><input className={inputClass} value={accountForm.accountHolderName} onChange={(event) => setAccountForm((form) => ({ ...form, accountHolderName: event.target.value }))} /></Field> : null}
            </div>
          </ModalShell>
        ) : null}

        {modal === "entry" && selected ? (
          <ModalShell
            title={entryType === "deposit" ? "Receive / Deposit" : "Pay / Withdraw"}
            subtitle={`${selected.displayName} · ${entryType === "deposit" ? "Receipt" : "Payment"} voucher`}
            error={actionError}
            onClose={closeModal}
            width="max-w-3xl"
            footer={<><button type="button" className={buttonClass} onClick={closeModal}>Cancel</button><button type="button" disabled={saving || !selected.ledgerHealthy} className={primaryButtonClass} onClick={() => void submitEntry()}>{saving ? "Posting…" : entryType === "deposit" ? "Post Receipt" : "Post Payment"}</button></>}
          >
            <div className="mb-5 flex rounded-lg bg-[#f2f4f7] p-1"><button type="button" className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${counterMode === "ledger" ? "bg-white text-[#101828] shadow-sm" : "text-[#667085]"}`} onClick={() => setCounterMode("ledger")}>Ledger Account</button><button type="button" className={`flex-1 rounded-md px-3 py-2 text-sm font-semibold ${counterMode === "party" ? "bg-white text-[#101828] shadow-sm" : "text-[#667085]"}`} onClick={() => setCounterMode("party")}>Customer / Supplier</button></div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Description"><input className={inputClass} value={entryForm.name} onChange={(event) => setEntryForm((form) => ({ ...form, name: event.target.value }))} placeholder={entryType === "deposit" ? "Customer receipt / other income" : "Supplier payment / expense"} /></Field>
              <Field label="Amount"><input className={inputClass} type="number" min="0.01" step="0.01" value={entryForm.amount} onChange={(event) => setEntryForm((form) => ({ ...form, amount: event.target.value }))} /></Field>
              <Field label="Date"><input className={inputClass} type="date" value={entryForm.date} onChange={(event) => setEntryForm((form) => ({ ...form, date: event.target.value }))} /></Field>
              {counterMode === "party" ? (
                <Field label={entryType === "deposit" ? "Customer" : "Supplier"}>
                  <select className={inputClass} value={entryForm.party} onChange={(event) => setEntryForm((form) => ({ ...form, party: event.target.value }))}>
                    <option value="">Select party</option>
                    {parties.filter((party) => entryType === "deposit" ? party.kind === "customer" : party.kind === "supplier").map((party) => <option key={party.partyId} value={party.partyId}>{party.name}</option>)}
                  </select>
                  {selectedParty ? <span className="mt-1 block text-[11px] text-[#667085]">Linked ledger: {selectedParty.ledgerAccountId}</span> : null}
                </Field>
              ) : (
                <Field label="Counter ledger"><select className={inputClass} value={entryForm.contra} onChange={(event) => setEntryForm((form) => ({ ...form, contra: event.target.value }))}><option value="">Select ledger</option>{ledgerAccounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.name}</option>)}</select></Field>
              )}
              <Field label="Reference"><input className={inputClass} value={entryForm.reference} onChange={(event) => setEntryForm((form) => ({ ...form, reference: event.target.value }))} placeholder="Cheque / UTR / reference no." /></Field>
              <Field label="Notes"><input className={inputClass} value={entryForm.notes} onChange={(event) => setEntryForm((form) => ({ ...form, notes: event.target.value }))} placeholder="Optional detail" /></Field>
            </div>
            <div className="mt-4 rounded-lg border border-[#d0d5dd] bg-[#f9fafb] px-4 py-3 text-xs text-[#667085]">Accounting effect: {entryType === "deposit" ? <><strong>Dr {selected.displayName}</strong> / <strong>Cr counter account{selectedParty ? ` (${selectedParty.name})` : ""}</strong></> : <><strong>Dr counter account{selectedParty ? ` (${selectedParty.name})` : ""}</strong> / <strong>Cr {selected.displayName}</strong></>}</div>
          </ModalShell>
        ) : null}

        {modal === "transfer" ? (
          <ModalShell
            title="Transfer Funds"
            subtitle="Cash-to-cash, bank-to-bank and cash-to-bank movements are Contra vouchers."
            error={actionError}
            onClose={closeModal}
            footer={<><button type="button" className={buttonClass} onClick={closeModal}>Cancel</button><button type="button" disabled={saving} className={primaryButtonClass} onClick={() => void submitTransfer()}>{saving ? "Posting…" : "Post Contra"}</button></>}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="From account"><select className={inputClass} value={transferForm.from} onChange={(event) => setTransferForm((form) => ({ ...form, from: event.target.value }))}><option value="">Select source</option>{activeAccounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.displayName} · {money(account.currentBalance)}</option>)}</select></Field>
              <Field label="To account"><select className={inputClass} value={transferForm.to} onChange={(event) => setTransferForm((form) => ({ ...form, to: event.target.value }))}><option value="">Select destination</option>{activeAccounts.filter((account) => account.accountId !== transferForm.from).map((account) => <option key={account.accountId} value={account.accountId}>{account.displayName}</option>)}</select></Field>
              <Field label="Amount"><input className={inputClass} type="number" min="0.01" step="0.01" value={transferForm.amount} onChange={(event) => setTransferForm((form) => ({ ...form, amount: event.target.value }))} /></Field>
              <Field label="Date"><input className={inputClass} type="date" value={transferForm.date} onChange={(event) => setTransferForm((form) => ({ ...form, date: event.target.value }))} /></Field>
              <Field label="Reference"><input className={inputClass} value={transferForm.reference} onChange={(event) => setTransferForm((form) => ({ ...form, reference: event.target.value }))} placeholder="Transfer / bank reference" /></Field>
              <Field label="Notes"><input className={inputClass} value={transferForm.notes} onChange={(event) => setTransferForm((form) => ({ ...form, notes: event.target.value }))} /></Field>
            </div>
            <div className="mt-4 rounded-lg border border-[#d0d5dd] bg-[#f9fafb] px-4 py-3 text-xs text-[#667085]">Accounting effect: <strong>Cr {source?.displayName || "source"}</strong> / <strong>Dr {destination?.displayName || "destination"}</strong>. No income or expense is created by a transfer.</div>
          </ModalShell>
        ) : null}
      </div>
    </AuthGate>
  );
}
