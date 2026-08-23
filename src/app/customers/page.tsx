"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp } from "firebase/firestore";
import type { ChangeEvent, FormEvent } from "react";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { firestoreDb } from "../../lib/firebase";
import { useBusiness } from "../../context/BusinessContext";

type Customer = { id: string; name?: string; phone?: string; email?: string; address?: string; gstType?: string; state?: string; balance?: number; customerCode?: string; status?: string };
type FormValues = { name: string; phone: string; email: string; address: string; gstType: string; state: string; balance: string };
type CustomerTransaction = { id: string; type: "Sales Invoice" | "Payment"; number: string; date: string; total: number; balance: number };
const emptyForm: FormValues = { name: "", phone: "", email: "", address: "", gstType: "Unregistered/Consumer", state: "", balance: "" };
const Icon = ({ name, className = "h-4 w-4" }: { name: "search" | "plus" | "users" | "close"; className?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{name === "search" && <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>}{name === "plus" && <path d="M12 5v14M5 12h14" />}{name === "close" && <path d="m6 6 12 12M18 6 6 18" />}{name === "users" && <><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="8" r="3" /><path d="M16.5 11.5a3 3 0 0 1 3 3v1" /><path d="M15.5 5.5a3 3 0 0 1 0 5.7" /></>}</svg>;
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
const dateText = (value: unknown) => { try { const date = typeof (value as { toDate?: () => Date })?.toDate === "function" ? (value as { toDate: () => Date }).toDate() : new Date(String(value || "")); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN"); } catch { return "—"; } };

export default function CustomersPage() {
  const { activeBusinessId, loading: businessLoading } = useBusiness();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<CustomerTransaction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [activeTab, setActiveTab] = useState<"address" | "gst" | "balance">("address");
  const [loading, setLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (businessLoading) return;
      if (!firestoreDb) { setError("Firebase is not configured. Check your .env.local file."); setLoading(false); return; }
      if (!activeBusinessId) { setCustomers([]); setSelectedId(null); setTransactions([]); setLoading(false); return; }
      setLoading(true); setError("");
      try {
        const snapshot = await getDocs(collection(firestoreDb, "businesses", activeBusinessId, "customers"));
        setCustomers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })) as Customer[]);
        // Do not auto-select the first customer. Details open only after an explicit row click.
        setSelectedId(null);
      } catch (reason) { console.error(reason); setError("Could not load customers. Check Firestore rules and your business membership."); }
      finally { setLoading(false); }
    }
    load();
  }, [activeBusinessId, businessLoading]);

  useEffect(() => {
    async function loadTransactions() {
      if (!firestoreDb || !activeBusinessId || !selectedId) { setTransactions([]); return; }
      setTransactionsLoading(true);
      try {
        const [invoiceSnapshot, paymentSnapshot] = await Promise.all([
          getDocs(collection(firestoreDb, "businesses", activeBusinessId, "invoices")),
          getDocs(collection(firestoreDb, "businesses", activeBusinessId, "payments")),
        ]);
        const invoices = invoiceSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as { id: string; customerId?: string; invoiceNumber?: string; number?: string; date?: unknown; grandTotal?: number; balanceAmount?: number }).filter((row) => row.customerId === selectedId).map((row) => ({ id: row.id, type: "Sales Invoice" as const, number: row.invoiceNumber || row.number || row.id.slice(0, 8).toUpperCase(), date: dateText(row.date), total: Number(row.grandTotal || 0), balance: Number(row.balanceAmount || 0) }));
        const payments = paymentSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }) as { id: string; partyId?: string; paymentNumber?: string; date?: unknown; amount?: number }).filter((row) => row.partyId === selectedId).map((row) => ({ id: row.id, type: "Payment" as const, number: row.paymentNumber || row.id.slice(0, 8).toUpperCase(), date: dateText(row.date), total: Number(row.amount || 0), balance: 0 }));
        setTransactions([...invoices, ...payments]);
      } catch (reason) { console.error(reason); setTransactions([]); }
      finally { setTransactionsLoading(false); }
    }
    loadTransactions();
  }, [activeBusinessId, selectedId]);

  const filtered = useMemo(() => customers.filter((customer) => [customer.name, customer.phone, customer.email, customer.customerCode].join(" ").toLowerCase().includes(query.toLowerCase())), [customers, query]);
  const totals = useMemo(() => ({ total: customers.length, active: customers.filter((customer) => (customer.status || "Active").toLowerCase() === "active").length, outstanding: customers.reduce((sum, customer) => sum + Number(customer.balance || 0), 0) }), [customers]);
  const selected = selectedId ? customers.find((customer) => customer.id === selectedId) ?? null : null;
  const update = (field: keyof FormValues) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const openAdd = () => { setForm(emptyForm); setActiveTab("address"); setError(""); setShowForm(true); };

  async function save(event: FormEvent<HTMLFormElement>, keepOpen = false) {
    event.preventDefault();
    if (!firestoreDb || !activeBusinessId) { setError("Select a business before saving a customer."); return; }
    setSaving(true); setError("");
    try {
      const values = { ...form, balance: Number(form.balance) || 0, type: "Customer", status: "Active", customerCode: `CUS-${Date.now().toString().slice(-8)}`, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
      const saved = await addDoc(collection(firestoreDb, "businesses", activeBusinessId, "customers"), values);
      setCustomers((current) => [{ ...values, id: saved.id } as Customer, ...current]);
      setSelectedId(saved.id);
      if (keepOpen) setForm(emptyForm); else setShowForm(false);
    } catch (reason) { console.error(reason); setError("Could not save customer. Check Firestore rules and try again."); }
    finally { setSaving(false); }
  }

  async function removeSelected() {
    if (!selected || !firestoreDb || !activeBusinessId || deleting) return;
    if (!window.confirm(`Delete ${selected.name || "this customer"}? Existing invoices and payments will not be deleted.`)) return;
    setDeleting(true); setError("");
    try {
      await deleteDoc(doc(firestoreDb, "businesses", activeBusinessId, "customers", selected.id));
      setCustomers((current) => current.filter((item) => item.id !== selected.id));
      setSelectedId(null); setTransactions([]);
    } catch (reason) { console.error(reason); setError("Could not delete customer. Your role may not have permission to delete customers."); }
    finally { setDeleting(false); }
  }

  return <AuthGate><div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar /><main className="min-w-0 flex-1 px-4 pb-10 pt-0 sm:px-6 lg:px-8"><TopNav /><div className="mx-auto max-w-[1450px]">
    <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="text-sm font-semibold text-[#4f46e5]">Customer management</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#182230]">Customers</h1><p className="mt-2 max-w-xl text-sm text-[#667085]">Manage customer details, outstanding balances, and account information in one workspace.</p></div><button type="button" onClick={openAdd} disabled={!activeBusinessId} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#4f46e5] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,.22)] hover:bg-[#4338ca] disabled:cursor-not-allowed disabled:opacity-50"><Icon name="plus" /> Add customer</button></section>
    {error && <div role="alert" className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
    <section className="mb-7 grid gap-4 sm:grid-cols-3">{[[String(totals.total), "Total customers", "Across this business", "text-[#4f46e5]"], [String(totals.active), "Active customers", "Currently active", "text-[#168361]"], [money(totals.outstanding), "Outstanding", "Current recorded balance", "text-[#b7791f]"]].map(([value, label, note, tone]) => <article key={label} className="rounded-2xl border border-[#e7e5e4] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]"><p className="text-sm font-medium text-[#667085]">{label}</p><p className={`mt-3 text-2xl font-bold tracking-tight ${tone}`}>{value}</p><p className="mt-1 text-xs text-[#98a2b3]">{note}</p></article>)}</section>
    <section className="overflow-hidden rounded-2xl border border-[#e7e5e4] bg-white shadow-[0_3px_10px_rgba(16,24,40,.04)]"><div className="flex flex-col justify-between gap-4 border-b border-[#eaecf0] p-5 lg:flex-row lg:items-center"><div><h2 className="font-bold text-[#182230]">Customer list</h2><p className="mt-1 text-sm text-[#667085]">{filtered.length} customer{filtered.length === 1 ? "" : "s"} shown</p></div><label className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"><Icon name="search" /></span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone or email" className="h-10 w-full rounded-xl border border-[#d0d5dd] pl-9 pr-3 text-sm outline-none focus:border-[#4f46e5] sm:w-72" /></label></div>
      {businessLoading || loading ? <p className="p-16 text-center text-sm text-[#667085]">Loading customers…</p> : !activeBusinessId ? <div className="flex min-h-80 flex-col items-center justify-center p-10 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eeedff] text-[#4f46e5]"><Icon name="users" className="h-7 w-7" /></div><h3 className="mt-4 font-bold text-[#182230]">Select a business first</h3><p className="mt-2 max-w-sm text-sm text-[#667085]">Choose an active business from the top navigation to manage its customers.</p></div> : customers.length === 0 ? <div className="flex min-h-80 flex-col items-center justify-center p-10 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eeedff] text-[#4f46e5]"><Icon name="users" className="h-7 w-7" /></div><h3 className="mt-4 font-bold text-[#182230]">Your customer list is ready for its first customer</h3><p className="mt-2 max-w-sm text-sm text-[#667085]">Create a customer to track contact details, opening balances, and future transactions.</p><button type="button" onClick={openAdd} className="mt-5 text-sm font-bold text-[#4f46e5] hover:underline">Add customer</button></div> : filtered.length === 0 ? <div className="flex min-h-64 items-center justify-center p-10 text-center text-sm text-[#667085]">No customers match your search.</div> : <div className="overflow-x-auto"><table className="min-w-[850px] w-full text-left"><thead className="bg-[#fbfaf9] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr>{["Customer", "Phone", "Email", "Opening balance", "Status", ""].map((heading) => <th key={heading} className="px-5 py-3">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#eaecf0]">{filtered.map((customer) => { const active = (customer.status || "Active").toLowerCase() === "active"; return <tr key={customer.id} onClick={() => setSelectedId(customer.id)} className={`cursor-pointer transition hover:bg-[#fafafa] ${selected?.id === customer.id ? "bg-[#f8f7ff]" : ""}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eeedff] text-[#4f46e5]"><Icon name="users" className="h-5 w-5" /></span><span><span className="block font-semibold text-[#182230]">{customer.name || "Unnamed customer"}</span><span className="mt-0.5 block text-xs text-[#98a2b3]">{customer.customerCode || "—"}</span></span></div></td><td className="px-5 py-4 text-sm text-[#667085]">{customer.phone || "—"}</td><td className="px-5 py-4 text-sm text-[#667085]">{customer.email || "—"}</td><td className="px-5 py-4 text-sm font-semibold text-[#182230]">{money(Number(customer.balance || 0))}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-[#e8f8f1] text-[#168361]" : "bg-[#f2f4f7] text-[#667085]"}`}>{active ? "Active" : "Inactive"}</span></td><td className="px-5 py-4 text-right text-[#98a2b3]">›</td></tr>; })}</tbody></table></div>}
    </section></div></main></div>
    {selected && <><button type="button" aria-label="Close customer details overlay" onClick={() => setSelectedId(null)} className="fixed inset-0 z-40 bg-[#101828]/30" /><aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[#e4e7ec] bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-[#eaecf0] p-6"><div><p className="text-sm font-semibold text-[#4f46e5]">Customer details</p><h2 className="mt-1 text-xl font-bold text-[#182230]">{selected.name}</h2><p className="mt-1 text-sm text-[#667085]">{selected.customerCode || "Customer"}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close customer details" className="rounded-lg p-2 text-[#667085] hover:bg-[#f2f4f7]"><Icon name="close" /></button></header><div className="flex-1 overflow-y-auto p-6"><div className="grid gap-3 sm:grid-cols-2">{[["Phone", selected.phone || "—"], ["Email", selected.email || "—"], ["GST type", selected.gstType || "—"], ["State", selected.state || "—"], ["Balance", money(Number(selected.balance || 0))], ["Status", selected.status || "Active"]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#eaecf0] bg-[#fbfaf9] p-4"><p className="text-xs font-medium uppercase tracking-wide text-[#98a2b3]">{label}</p><p className="mt-2 text-sm font-semibold text-[#344054]">{value}</p></div>)}</div><div className="mt-4 rounded-xl border border-[#eaecf0] p-4"><p className="text-xs font-medium uppercase tracking-wide text-[#98a2b3]">Address</p><p className="mt-2 text-sm leading-6 text-[#475467]">{selected.address || "No address added."}</p></div><div className="mt-6 rounded-xl border border-[#eaecf0] p-4"><div className="flex items-center justify-between"><div><p className="font-semibold text-[#182230]">Transactions</p><p className="mt-1 text-xs text-[#667085]">Sales invoices and payments</p></div><span className="rounded-full bg-[#eeedff] px-2.5 py-1 text-xs font-semibold text-[#4f46e5]">{transactions.length}</span></div>{transactionsLoading ? <p className="py-8 text-center text-sm text-[#667085]">Loading transactions…</p> : transactions.length === 0 ? <p className="py-8 text-center text-sm text-[#667085]">No transactions to show yet.</p> : <div className="mt-4 overflow-x-auto"><table className="min-w-[560px] w-full text-left text-xs"><thead className="border-y border-[#eaecf0] text-[#98a2b3]"><tr>{["Type", "Number", "Date", "Total", "Balance"].map((head) => <th key={head} className="px-3 py-2.5 font-semibold">{head}</th>)}</tr></thead><tbody className="divide-y divide-[#f0f1f3]">{transactions.map((tx) => <tr key={`${tx.type}-${tx.id}`}><td className="px-3 py-3 font-medium text-[#344054]">{tx.type}</td><td className="px-3 py-3 text-[#667085]">{tx.number}</td><td className="px-3 py-3 text-[#667085]">{tx.date}</td><td className="px-3 py-3 font-semibold text-[#182230]">{money(tx.total)}</td><td className="px-3 py-3 text-[#667085]">{money(tx.balance)}</td></tr>)}</tbody></table></div>}</div></div><footer className="border-t border-[#eaecf0] p-5"><button type="button" onClick={removeSelected} disabled={deleting} className="w-full rounded-xl border border-[#fecdca] px-4 py-2.5 text-sm font-semibold text-[#b42318] hover:bg-[#fef3f2] disabled:cursor-not-allowed disabled:opacity-50">{deleting ? "Deleting customer…" : "Delete customer"}</button><p className="mt-2 text-center text-[11px] text-[#98a2b3]">Deleting a customer does not delete existing invoices or payments.</p></footer></aside></>}
    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/55 p-4"><form onSubmit={save} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[#e4e7ec] bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-[#eaecf0] px-6 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-[#4f46e5]">Customer setup</p><h2 className="mt-1 text-lg font-bold text-[#182230]">Add customer</h2></div><button type="button" onClick={() => setShowForm(false)} aria-label="Close add customer form" className="rounded-lg p-2 text-[#667085] hover:bg-[#f2f4f7]"><Icon name="close" /></button></header><div className="overflow-y-auto px-6 py-6"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[#344054]">Customer name<input required value={form.name} onChange={update("name")} placeholder="e.g. ABC Traders" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#4f46e5]/10" /></label><label className="text-sm font-semibold text-[#344054]">Phone<input value={form.phone} onChange={update("phone")} placeholder="+91 98765 43210" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#4f46e5]/10" /></label></div><div className="mt-7 flex gap-5 border-b border-[#eaecf0]">{([["address", "Address"], ["gst", "GST"], ["balance", "Opening balance"]] as const).map(([key, label]) => <button type="button" key={key} onClick={() => setActiveTab(key)} className={`border-b-2 px-1 pb-3 text-sm font-semibold ${activeTab === key ? "border-[#4f46e5] text-[#4f46e5]" : "border-transparent text-[#98a2b3]"}`}>{label}</button>)}</div><div className="pt-6">{activeTab === "address" && <div className="grid gap-4"><label className="text-sm font-semibold text-[#344054]">Billing address<textarea value={form.address} onChange={update("address")} placeholder="Enter billing address" className="mt-2 h-28 w-full resize-none rounded-xl border border-[#d0d5dd] p-3 text-sm outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#4f46e5]/10" /></label><label className="text-sm font-semibold text-[#344054]">Email<input type="email" value={form.email} onChange={update("email")} placeholder="business@example.com" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#4f46e5]/10" /></label></div>}{activeTab === "gst" && <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[#344054]">GST type<select value={form.gstType} onChange={update("gstType")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm outline-none focus:border-[#4f46e5]"><option>Unregistered/Consumer</option><option>Registered Business</option><option>Composition</option></select></label><label className="text-sm font-semibold text-[#344054]">State<input value={form.state} onChange={update("state")} placeholder="Bihar" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#4f46e5]/10" /></label></div>}{activeTab === "balance" && <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[#344054]">Opening balance<input type="number" min="0" value={form.balance} onChange={update("balance")} placeholder="0" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5] focus:ring-4 focus:ring-[#4f46e5]/10" /></label><label className="text-sm font-semibold text-[#344054]">As of date<input readOnly value={new Date().toLocaleDateString("en-GB")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-[#f9fafb] px-3 text-sm text-[#667085]" /></label></div>}</div></div><footer className="flex justify-end gap-3 border-t border-[#eaecf0] px-6 py-4"><button type="button" onClick={() => setShowForm(false)} className="h-10 rounded-xl border border-[#d0d5dd] px-4 text-sm font-semibold text-[#344054]">Cancel</button><button type="submit" disabled={saving} className="h-10 rounded-xl bg-[#4f46e5] px-5 text-sm font-semibold text-white shadow-sm disabled:opacity-50">{saving ? "Saving…" : "Save customer"}</button></footer></form></div>}
  </AuthGate>;
}
