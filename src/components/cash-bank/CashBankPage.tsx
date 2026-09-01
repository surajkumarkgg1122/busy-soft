"use client";

import { useEffect, useMemo, useState } from "react";
import { firebaseAuth } from "@/lib/firebase";
import { useBusiness } from "@/context/BusinessContext";
import Sidebar from "@/app/Components/Sidebar/page";
import TopNav from "@/app/Components/TopNav/page";
import AuthGate from "@/app/Components/Auth/AuthGate";

type Account = {
  accountId: string;
  displayName: string;
  kind: "cash" | "bank";
  ledgerAccountId: string;
  currentBalance: number;
  openingBalance?: number;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  upiId?: string;
  accountHolderName?: string;
  status: string;
};
type GL = { accountId: string; name: string; type: string; active: boolean };
type Ledger = { lineId: string; date: string; voucherNumber?: string; voucherType?: string; accountId: string; description?: string; debit: number; credit: number };

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format((Number(n) || 0) / 100);
const today = () => new Date().toISOString().slice(0, 10);

async function api(path: string, body?: Record<string, unknown>) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error("You must be signed in.");
  const token = await user.getIdToken();
  const response = await fetch(path, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
  const data = await response.json().catch(() => ({ success: false, error: "Invalid server response." }));
  if (!response.ok || !data.success) throw new Error(data.error || "Request failed.");
  return data;
}

function Icon({ name }: { name: "cash" | "bank" | "transfer" | "plus" | "search" | "more" | "arrow" }) {
  const paths: Record<string, string> = {
    cash: "M4 7h16v12H4zM7 7V5h10v2M8 13h8M12 10v6",
    bank: "M3 10 12 4l9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 18h18",
    transfer: "M7 7h10l-3-3m3 3-3 3M17 17H7l3 3m-3-3 3-3",
    plus: "M12 5v14M5 12h14",
    search: "m21 21-4.5-4.5M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
    more: "M6 12h.01M12 12h.01M18 12h.01",
    arrow: "m9 18 6-6-6-6",
  };
  return <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export default function CashBankPage() {
  const { activeBusinessId, activeBusiness, can, loading: businessLoading } = useBusiness();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [gl, setGl] = useState<GL[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [fy, setFy] = useState("");
  const [selected, setSelected] = useState<Account | null>(null);
  const [kind, setKind] = useState<"cash" | "bank">("bank");
  const [modal, setModal] = useState<"account" | "entry" | "transfer" | null>(null);
  const [entryType, setEntryType] = useState<"deposit" | "withdrawal">("deposit");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ displayName: "", openingBalance: "0", openingBalanceDate: today(), bankName: "", accountNumber: "", ifscCode: "", upiId: "", accountHolderName: "" });
  const [entry, setEntry] = useState({ name: "", amount: "", date: today(), reference: "", notes: "", contra: "" });
  const [transfer, setTransfer] = useState({ from: "", to: "", amount: "", date: today(), reference: "", notes: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const create = can("cashBank", "create");

  async function load() {
    if (!activeBusinessId) return;
    setLoading(true);
    setError("");
    try {
      const data = await api(`/api/cash-bank?businessId=${encodeURIComponent(activeBusinessId)}`);
      setAccounts(data.accounts || []);
      setGl(data.glAccounts || []);
      setLedger(data.ledger || []);
      setFy(data.financialYearId || "");
      setSelected((prev: Account | null) => (data.accounts || []).find((a: Account) => a.accountId === prev?.accountId) || (data.accounts || [])[0] || null);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load Cash & Bank."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (!businessLoading) void load(); }, [activeBusinessId, businessLoading]);

  const selectedLedger = useMemo(() => {
    const value = query.trim().toLowerCase();
    return selected ? ledger.filter((x) => x.accountId === selected.ledgerAccountId && (!value || `${x.voucherNumber || ""} ${x.description || ""} ${x.voucherType || ""}`.toLowerCase().includes(value))) : [];
  }, [selected, ledger, query]);

  const totals = useMemo(() => ({
    cash: accounts.filter((a) => a.kind === "cash").reduce((s, a) => s + a.currentBalance, 0),
    bank: accounts.filter((a) => a.kind === "bank").reduce((s, a) => s + a.currentBalance, 0),
    total: accounts.reduce((s, a) => s + a.currentBalance, 0),
  }), [accounts]);

  async function submitEntry() {
    if (!selected) return;
    const amount = Number(entry.amount);
    const contra = gl.find((x) => x.accountId === entry.contra);
    if (!entry.name.trim() || amount <= 0 || !contra) return setError("Enter a description, positive amount, and counter account.");
    try {
      await api("/api/cash-bank", { action: "entry", businessId: activeBusinessId, financialYearId: fy, accountId: selected.accountId, type: entryType, amount, name: entry.name, date: entry.date, reference: entry.reference, notes: entry.notes, contraAccountId: contra.accountId, idempotencyKey: `cb-${crypto.randomUUID()}` });
      closeModal(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to post transaction."); }
  }

  async function submitTransfer() {
    try {
      const amount = Number(transfer.amount);
      if (!transfer.from || !transfer.to || transfer.from === transfer.to || amount <= 0) return setError("Select different source/destination accounts and a positive amount.");
      await api("/api/cash-bank", { action: "transfer", businessId: activeBusinessId, financialYearId: fy, fromAccountId: transfer.from, toAccountId: transfer.to, amount, date: transfer.date, reference: transfer.reference, notes: transfer.notes, idempotencyKey: `cb-transfer-${crypto.randomUUID()}` });
      closeModal(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to post transfer."); }
  }

  async function createAccount() {
    try {
      if (!form.displayName.trim()) return setError("Account name is required.");
      await api("/api/cash-bank", { action: "account", businessId: activeBusinessId, kind, displayName: form.displayName, openingBalance: Number(form.openingBalance || 0), openingBalanceDate: form.openingBalanceDate, bankName: form.bankName, accountNumber: form.accountNumber, ifscCode: form.ifscCode, upiId: form.upiId, accountHolderName: form.accountHolderName });
      closeModal(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create account."); }
  }

  function closeModal() {
    setModal(null); setError("");
    setEntry({ name: "", amount: "", date: today(), reference: "", notes: "", contra: "" });
    setTransfer({ from: "", to: "", amount: "", date: today(), reference: "", notes: "" });
    setForm({ displayName: "", openingBalance: "0", openingBalanceDate: today(), bankName: "", accountNumber: "", ifscCode: "", upiId: "", accountHolderName: "" });
  }

  return (
    <AuthGate>
      <div className="flex min-h-screen bg-[#f8f9fb]">
        <Sidebar />
        <main className="min-w-0 flex-1 px-5 pb-10 sm:px-8 lg:px-10">
          <TopNav />
          <div className="mx-auto max-w-[1500px] py-5">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-[#465fff]">{activeBusiness?.business.name || "Business"} · Money</p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#101828]">Cash & Bank</h1>
                <p className="mt-1 text-sm text-[#667085]">Manage cash, bank accounts, deposits, withdrawals and contra transfers.</p>
              </div>
              {create && <div className="flex gap-2">
                <button type="button" onClick={() => setModal("transfer")} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d0d5dd] bg-white px-4 text-sm font-semibold text-[#344054] shadow-sm hover:bg-[#f9fafb]"><Icon name="transfer" /> Transfer</button>
                <button type="button" onClick={() => setModal("account")} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#465fff] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#3641d8]"><Icon name="plus" /> New Account</button>
              </div>}
            </header>

            {error && <div className="mt-4 flex items-center justify-between rounded-lg border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss" className="font-semibold">×</button></div>}

            <section className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-[#e4e7ec] bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-medium text-[#667085]">Total liquidity</span><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#edf2ff] text-[#465fff]"><Icon name="bank" /></span></div><p className="mt-3 text-2xl font-bold text-[#101828]">{money(totals.total)}</p><p className="mt-1 text-xs text-[#98a2b3]">Cash + bank balances</p></div>
              <div className="rounded-xl border border-[#e4e7ec] bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-medium text-[#667085]">Cash in hand</span><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ecfdf3] text-[#039855]"><Icon name="cash" /></span></div><p className="mt-3 text-2xl font-bold text-[#101828]">{money(totals.cash)}</p><p className="mt-1 text-xs text-[#98a2b3]">Across active cash accounts</p></div>
              <div className="rounded-xl border border-[#e4e7ec] bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-sm font-medium text-[#667085]">Bank balance</span><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#fff6ed] text-[#f79009]"><Icon name="bank" /></span></div><p className="mt-3 text-2xl font-bold text-[#101828]">{money(totals.bank)}</p><p className="mt-1 text-xs text-[#98a2b3]">Across active bank accounts</p></div>
            </section>

            <section className="mt-6 rounded-xl border border-[#e4e7ec] bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaecf0] px-5 py-4">
                <div><h2 className="font-bold text-[#101828]">Accounts</h2><p className="mt-0.5 text-xs text-[#98a2b3]">Financial year {fy || "—"} · {accounts.length} active accounts</p></div>
                <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"><Icon name="search" /></span><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ledger" className="h-9 w-56 rounded-lg border border-[#d0d5dd] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#465fff]" /></div>
              </div>
              <div className="grid gap-0 lg:grid-cols-[360px_1fr]">
                <div className="border-b border-[#eaecf0] lg:border-b-0 lg:border-r">
                  {loading ? <div className="space-y-3 p-5">{[1,2,3].map((x) => <div key={x} className="h-20 animate-pulse rounded-lg bg-[#f2f4f7]" />)}</div> : accounts.length === 0 ? <div className="p-8 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#f2f4f7] text-[#667085]"><Icon name="bank" /></div><h3 className="mt-3 font-semibold text-[#101828]">No accounts yet</h3><p className="mt-1 text-sm text-[#667085]">Create your first cash or bank account to start recording transactions.</p>{create && <button type="button" onClick={() => setModal("account")} className="mt-4 text-sm font-semibold text-[#465fff]">Create account →</button>}</div> : <div className="divide-y divide-[#eaecf0]">{accounts.map((account) => <button key={account.accountId} type="button" onClick={() => setSelected(account)} className={`w-full px-5 py-4 text-left transition-colors hover:bg-[#f9fafb] ${selected?.accountId === account.accountId ? "bg-[#f5f7ff]" : ""}`}><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${account.kind === "cash" ? "bg-[#ecfdf3] text-[#039855]" : "bg-[#edf2ff] text-[#465fff]"}`}><Icon name={account.kind} /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-semibold text-[#344054]">{account.displayName}</span><span className="text-xs text-[#98a2b3]"><Icon name="arrow" /></span></span><span className="mt-1 block text-xs text-[#98a2b3]">{account.kind === "bank" ? account.bankName || "Bank account" : "Cash account"}</span><span className="mt-2 block text-base font-bold text-[#101828]">{money(account.currentBalance)}</span></span></div></button>)}</div>}
                </div>
                <div className="min-w-0">
                  {selected ? <><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaecf0] px-5 py-4"><div><div className="flex items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-md ${selected.kind === "cash" ? "bg-[#ecfdf3] text-[#039855]" : "bg-[#edf2ff] text-[#465fff]"}`}><Icon name={selected.kind} /></span><h3 className="font-bold text-[#101828]">{selected.displayName}</h3></div><p className="mt-1 text-xs text-[#98a2b3]">{selected.kind === "bank" ? `${selected.bankName || "Bank"}${selected.accountNumber ? ` · •••• ${selected.accountNumber.slice(-4)}` : ""}` : "Cash account"}</p></div>{create && <div className="flex gap-2"><button type="button" onClick={() => { setEntryType("deposit"); setModal("entry"); }} className="h-9 rounded-lg bg-[#039855] px-3 text-xs font-semibold text-white hover:bg-[#027a44]">+ Deposit</button><button type="button" onClick={() => { setEntryType("withdrawal"); setModal("entry"); }} className="h-9 rounded-lg bg-[#d92d20] px-3 text-xs font-semibold text-white hover:bg-[#b42318]">− Withdrawal</button></div>}</div><div className="flex items-center justify-between border-b border-[#eaecf0] bg-[#fcfcfd] px-5 py-3"><span className="text-xs font-semibold uppercase tracking-wide text-[#667085]">Posted ledger</span><span className="text-sm font-bold text-[#101828]">Closing balance {money(selected.currentBalance)}</span></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-[#f9fafb] text-left text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Voucher</th><th className="px-5 py-3">Particulars</th><th className="px-5 py-3 text-right">Debit</th><th className="px-5 py-3 text-right">Credit</th></tr></thead><tbody className="divide-y divide-[#eaecf0]">{selectedLedger.map((x) => <tr key={x.lineId} className="hover:bg-[#f9fafb]"><td className="whitespace-nowrap px-5 py-3.5 text-[#667085]">{x.date}</td><td className="whitespace-nowrap px-5 py-3.5 font-medium text-[#344054]">{x.voucherNumber || "—"}</td><td className="max-w-[280px] truncate px-5 py-3.5 text-[#344054]">{x.description || x.voucherType || "—"}</td><td className="px-5 py-3.5 text-right font-medium text-[#039855]">{x.debit ? money(x.debit) : "—"}</td><td className="px-5 py-3.5 text-right font-medium text-[#d92d20]">{x.credit ? money(x.credit) : "—"}</td></tr>)}</tbody></table>{!selectedLedger.length && <div className="p-12 text-center"><p className="font-semibold text-[#344054]">No posted entries</p><p className="mt-1 text-sm text-[#98a2b3]">Transactions for this account will appear here.</p></div>}</div></> : <div className="grid min-h-[430px] place-items-center p-10 text-center"><div><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#f2f4f7] text-[#667085]"><Icon name="bank" /></div><h3 className="mt-4 font-semibold text-[#101828]">Select an account</h3><p className="mt-1 max-w-sm text-sm text-[#667085]">Choose a cash or bank account from the list to view its ledger and post transactions.</p></div></div>}
                </div>
              </div>
            </section>
          </div>
        </main>

        {modal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/45 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) closeModal(); }}><div className="w-full max-w-lg overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-[#eaecf0] px-6 py-4"><div><h2 className="font-bold text-[#101828]">{modal === "account" ? "Create account" : modal === "transfer" ? "Transfer money" : `Record ${entryType}`}</h2><p className="mt-0.5 text-xs text-[#98a2b3]">Changes are posted through the accounting engine.</p></div><button type="button" onClick={closeModal} className="text-xl text-[#98a2b3] hover:text-[#344054]">×</button></div><div className="space-y-4 p-6">
          {modal === "account" && <><div className="grid grid-cols-2 gap-2">{(["bank", "cash"] as const).map((value) => <button key={value} type="button" onClick={() => setKind(value)} className={`h-10 rounded-lg border text-sm font-semibold ${kind === value ? "border-[#465fff] bg-[#f5f7ff] text-[#465fff]" : "border-[#d0d5dd] text-[#667085]"}`}>{value === "bank" ? "Bank account" : "Cash account"}</button>)}</div><Field label="Account name"><input className="input" placeholder="e.g. HDFC Current Account" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field><Field label="Opening balance"><input className="input" type="number" min="0" placeholder="0.00" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} /></Field>{kind === "bank" && <div className="grid gap-4 sm:grid-cols-2"><Field label="Bank name"><input className="input" placeholder="Bank name" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} /></Field><Field label="Account number"><input className="input" placeholder="Account number" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} /></Field><Field label="IFSC"><input className="input" placeholder="IFSC code" value={form.ifscCode} onChange={(e) => setForm({ ...form, ifscCode: e.target.value })} /></Field><Field label="UPI ID"><input className="input" placeholder="UPI ID" value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} /></Field></div>}<button type="button" onClick={createAccount} className="w-full h-10 rounded-lg bg-[#465fff] text-sm font-semibold text-white hover:bg-[#3641d8]">Create account</button></>}
          {modal === "transfer" && <><Field label="From account"><select className="input" value={transfer.from} onChange={(e) => setTransfer({ ...transfer, from: e.target.value })}><option value="">Select source account</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.displayName}</option>)}</select></Field><Field label="To account"><select className="input" value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })}><option value="">Select destination account</option>{accounts.map((a) => <option key={a.accountId} value={a.accountId}>{a.displayName}</option>)}</select></Field><Field label="Amount"><input className="input" type="number" min="0.01" placeholder="0.00" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Date"><input className="input" type="date" value={transfer.date} onChange={(e) => setTransfer({ ...transfer, date: e.target.value })} /></Field><Field label="Reference"><input className="input" placeholder="Optional" value={transfer.reference} onChange={(e) => setTransfer({ ...transfer, reference: e.target.value })} /></Field></div><button type="button" onClick={submitTransfer} className="w-full h-10 rounded-lg bg-[#465fff] text-sm font-semibold text-white">Post transfer</button></>}
          {modal === "entry" && <><Field label="Description"><input className="input" placeholder={entryType === "deposit" ? "e.g. Cash received" : "e.g. Office expense"} value={entry.name} onChange={(e) => setEntry({ ...entry, name: e.target.value })} /></Field><Field label="Amount"><input className="input" type="number" min="0.01" placeholder="0.00" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} /></Field><Field label="Counter account"><select className="input" value={entry.contra} onChange={(e) => setEntry({ ...entry, contra: e.target.value })}><option value="">Select counter account</option>{gl.filter((a) => a.accountId !== selected?.ledgerAccountId).map((a) => <option key={a.accountId} value={a.accountId}>{a.name}</option>)}</select></Field><div className="grid grid-cols-2 gap-4"><Field label="Date"><input className="input" type="date" value={entry.date} onChange={(e) => setEntry({ ...entry, date: e.target.value })} /></Field><Field label="Reference"><input className="input" placeholder="Optional" value={entry.reference} onChange={(e) => setEntry({ ...entry, reference: e.target.value })} /></Field></div><button type="button" onClick={submitEntry} className={`w-full h-10 rounded-lg text-sm font-semibold text-white ${entryType === "deposit" ? "bg-[#039855] hover:bg-[#027a44]" : "bg-[#d92d20] hover:bg-[#b42318]"}`}>Post {entryType}</button></>}
        </div></div></div>}
      </div>
    </AuthGate>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-[#344054]">{label}</span>{children}</label>; }
