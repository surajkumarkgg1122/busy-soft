"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import type { ChangeEvent, FormEvent } from "react";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { firestoreDb } from "../../lib/firebase";
import { useBusiness } from "../../context/BusinessContext";

type Customer = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  gstType?: string;
  state?: string;
  balance?: number;
  customerCode?: string;
  status?: string;
};

type FormValues = {
  name: string;
  phone: string;
  email: string;
  address: string;
  gstType: string;
  state: string;
  balance: string;
};

type CustomerTransaction = {
  id: string;
  type: "Sales Invoice" | "Payment";
  number: string;
  date: string;
  total: number;
  balance: number;
};

const emptyForm: FormValues = {
  name: "",
  phone: "",
  email: "",
  address: "",
  gstType: "Unregistered/Consumer",
  state: "",
  balance: "",
};

function Icon({ name, className = "h-4 w-4" }: { name: "search" | "plus" | "users" | "close" | "edit" | "trash"; className?: string }) {
  const paths = {
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    edit: <><path d="M4 20h4l10.5-10.5a2.12 2.12 0 0 0-3-3L5 17v3Z" /><path d="m14.5 8.5 3 3" /></>,
    trash: <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>,
    users: <><path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" /><circle cx="10" cy="8" r="3" /><path d="M16.5 11.5a3 3 0 0 1 3 3v1" /><path d="M15.5 5.5a3.5 3.5 0 0 0 0 5.7" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name]}</svg>;
}

const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

function dateText(value: unknown) {
  try {
    const candidate = value as { toDate?: () => Date } | null;
    const date = candidate?.toDate ? candidate.toDate() : new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-IN");
  } catch {
    return "—";
  }
}

export default function CustomersPage() {
  const { activeBusinessId, loading: businessLoading } = useBusiness();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesTransactions, setSalesTransactions] = useState<CustomerTransaction[]>([]);
  const [paymentTransactions, setPaymentTransactions] = useState<CustomerTransaction[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<FormValues>(emptyForm);
  const [activeTab, setActiveTab] = useState<"address" | "gst" | "balance">("address");
  const [loading, setLoading] = useState(true);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyStatus, setBusyStatus] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (businessLoading) return;
    if (!firestoreDb) {
      setError("Firebase is not configured. Check your .env.local file.");
      setLoading(false);
      return;
    }
    if (!activeBusinessId) {
      setCustomers([]);
      setSalesTransactions([]);
      setPaymentTransactions([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSelectedId(null);
    const customerRef = collection(firestoreDb, "businesses", activeBusinessId, "customers");
    const salesRef = collection(firestoreDb, "businesses", activeBusinessId, "sales");
    const paymentsRef = collection(firestoreDb, "businesses", activeBusinessId, "payments");

    const unsubCustomers = onSnapshot(customerRef, (snapshot) => {
      setCustomers(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) as Customer[]);
      setLoading(false);
    }, (reason) => {
      console.error(reason);
      setError("Could not load customers. Check Firestore rules and your business membership.");
      setLoading(false);
    });

    setTransactionsLoading(true);
    const unsubSales = onSnapshot(salesRef, (snapshot) => {
      const rows = snapshot.docs.map((entry) => {
        const data = entry.data() as {
          customerId?: string | null;
          invoiceNumber?: string;
          invoiceDate?: string;
          total?: number;
          balance?: number;
        };
        return {
          id: entry.id,
          type: "Sales Invoice" as const,
          number: data.invoiceNumber || entry.id.slice(0, 8).toUpperCase(),
          date: data.invoiceDate || "—",
          total: Number(data.total || 0),
          balance: Number(data.balance || 0),
          customerId: data.customerId,
        };
      }).filter((row) => row.customerId);
      setSalesTransactions(rows);
      setTransactionsLoading(false);
    }, (reason) => {
      console.error(reason);
      setSalesTransactions([]);
      setTransactionsLoading(false);
    });

    const unsubPayments = onSnapshot(paymentsRef, (snapshot) => {
      const rows = snapshot.docs.map((entry) => {
        const data = entry.data() as {
          customerId?: string;
          partyId?: string;
          paymentNumber?: string;
          number?: string;
          date?: unknown;
          amount?: number;
        };
        return {
          id: entry.id,
          type: "Payment" as const,
          number: data.paymentNumber || data.number || entry.id.slice(0, 8).toUpperCase(),
          date: dateText(data.date),
          total: Number(data.amount || 0),
          balance: 0,
          customerId: data.customerId || data.partyId,
        };
      }).filter((row) => row.customerId);
      setPaymentTransactions(rows);
      setTransactionsLoading(false);
    }, (reason) => {
      console.error(reason);
      setPaymentTransactions([]);
    });

    return () => {
      unsubCustomers();
      unsubSales();
      unsubPayments();
    };
  }, [activeBusinessId, businessLoading]);

  const filtered = useMemo(() => customers.filter((customer) => [customer.name, customer.phone, customer.email, customer.customerCode].join(" ").toLowerCase().includes(query.toLowerCase())), [customers, query]);
  const totals = useMemo(() => ({
    total: customers.length,
    active: customers.filter((customer) => (customer.status || "Active").toLowerCase() === "active").length,
    outstanding: customers.reduce((sum, customer) => sum + Number(customer.balance || 0), 0),
  }), [customers]);

  const selected = selectedId ? customers.find((customer) => customer.id === selectedId) ?? null : null;
  const selectedTransactions = useMemo(() => {
    if (!selectedId) return [];
    return [
      ...salesTransactions.filter((row) => (row as CustomerTransaction & { customerId?: string }).customerId === selectedId),
      ...paymentTransactions.filter((row) => (row as CustomerTransaction & { customerId?: string }).customerId === selectedId),
    ].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [paymentTransactions, salesTransactions, selectedId]);

  const update = (field: keyof FormValues) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [field]: event.target.value }));

  function openAdd() {
    setEditing(null);
    setForm(emptyForm);
    setActiveTab("address");
    setError("");
    setShowForm(true);
  }

  function openEdit() {
    if (!selected) return;
    setEditing(selected);
    setForm({
      name: selected.name || "",
      phone: selected.phone || "",
      email: selected.email || "",
      address: selected.address || "",
      gstType: selected.gstType || "Unregistered/Consumer",
      state: selected.state || "",
      balance: String(selected.balance ?? 0),
    });
    setActiveTab("address");
    setError("");
    setShowForm(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firestoreDb || !activeBusinessId) {
      setError("Select a business before saving a customer.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        gstType: form.gstType,
        state: form.state.trim(),
        balance: Number(form.balance) || 0,
        updatedAt: serverTimestamp(),
      };
      if (editing) {
        await updateDoc(doc(firestoreDb, "businesses", activeBusinessId, "customers", editing.id), payload);
      } else {
        await addDoc(collection(firestoreDb, "businesses", activeBusinessId, "customers"), {
          ...payload,
          type: "Customer",
          status: "Active",
          customerCode: `CUS-${Date.now().toString().slice(-8)}`,
          createdAt: serverTimestamp(),
        });
      }
      setShowForm(false);
      setEditing(null);
    } catch (reason) {
      console.error(reason);
      setError("Could not save customer. Check Firestore rules and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (!selected || !firestoreDb || !activeBusinessId || busyStatus) return;
    const nextStatus = (selected.status || "Active").toLowerCase() === "active" ? "Inactive" : "Active";
    setBusyStatus(true);
    try {
      await updateDoc(doc(firestoreDb, "businesses", activeBusinessId, "customers", selected.id), { status: nextStatus, updatedAt: serverTimestamp() });
    } catch (reason) {
      console.error(reason);
      setError("Could not update customer status.");
    } finally {
      setBusyStatus(false);
    }
  }

  async function removeSelected() {
    if (!selected || !firestoreDb || !activeBusinessId || deleting) return;
    if (!window.confirm(`Delete ${selected.name || "this customer"}? Existing sales and payments will not be deleted.`)) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(firestoreDb, "businesses", activeBusinessId, "customers", selected.id));
      setSelectedId(null);
    } catch (reason) {
      console.error(reason);
      setError("Could not delete customer. Your role may not have permission to delete customers.");
    } finally {
      setDeleting(false);
    }
  }

  return <AuthGate>
    <div className="flex min-h-screen bg-[#f8f7f4]">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 pb-10 pt-0 sm:px-6 lg:px-8">
        <TopNav />
        <div className="mx-auto max-w-[1450px]">
          <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div><p className="text-sm font-semibold text-[#4f46e5]">Customer management</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#182230]">Customers</h1><p className="mt-2 max-w-xl text-sm text-[#667085]">Manage customer details, outstanding balances, and account information in one workspace.</p></div>
            <button type="button" onClick={openAdd} disabled={!activeBusinessId} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#4f46e5] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,.22)] hover:bg-[#4338ca] disabled:cursor-not-allowed disabled:opacity-50"><Icon name="plus" /> Add customer</button>
          </section>
          {error && <div role="alert" className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
          <section className="mb-7 grid gap-4 sm:grid-cols-3">
            {[[String(totals.total), "Total customers", "Across this business", "text-[#4f46e5]"], [String(totals.active), "Active customers", "Currently active", "text-[#168361]"], [money(totals.outstanding), "Outstanding", "Current recorded balance", "text-[#b7791f]"]].map(([value, label, note, tone]) => <article key={label} className="rounded-2xl border border-[#e7e5e4] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]"><p className="text-sm font-medium text-[#667085]">{label}</p><p className={`mt-3 text-2xl font-bold tracking-tight ${tone}`}>{value}</p><p className="mt-1 text-xs text-[#98a2b3]">{note}</p></article>)}
          </section>
          <section className="overflow-hidden rounded-2xl border border-[#e7e5e4] bg-white shadow-[0_3px_10px_rgba(16,24,40,.04)]">
            <div className="flex flex-col justify-between gap-4 border-b border-[#eaecf0] p-5 lg:flex-row lg:items-center"><div><h2 className="font-bold text-[#182230]">Customer list</h2><p className="mt-1 text-sm text-[#667085]">{filtered.length} customer{filtered.length === 1 ? "" : "s"} shown</p></div><label className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"><Icon name="search" /></span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, phone or email" className="h-10 w-full rounded-xl border border-[#d0d5dd] pl-9 pr-3 text-sm outline-none focus:border-[#4f46e5] sm:w-72" /></label></div>
            {businessLoading || loading ? <p className="p-16 text-center text-sm text-[#667085]">Loading customers…</p> : !activeBusinessId ? <div className="p-16 text-center text-sm text-[#667085]">Select a business first.</div> : filtered.length === 0 ? <div className="flex min-h-80 flex-col items-center justify-center p-10 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eeedff] text-[#4f46e5]"><Icon name="users" className="h-7 w-7" /></div><h3 className="mt-4 font-bold text-[#182230]">No customers yet</h3><p className="mt-2 text-sm text-[#667085]">Create your first customer to start tracking sales and balances.</p><button onClick={openAdd} className="mt-5 text-sm font-bold text-[#4f46e5]">Add customer</button></div> : <div className="overflow-x-auto"><table className="min-w-[850px] w-full text-left"><thead className="bg-[#fbfaf9] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr>{["Customer", "Phone", "Email", "Balance", "Status", ""].map((heading) => <th key={heading} className="px-5 py-3">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#eaecf0]">{filtered.map((customer) => { const active = (customer.status || "Active").toLowerCase() === "active"; return <tr key={customer.id} onClick={() => setSelectedId(customer.id)} className={`cursor-pointer transition hover:bg-[#fafafa] ${selected?.id === customer.id ? "bg-[#f8f7ff]" : ""}`}><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eeedff] text-[#4f46e5]"><Icon name="users" className="h-5 w-5" /></span><span><span className="block font-semibold text-[#182230]">{customer.name || "Unnamed customer"}</span><span className="mt-0.5 block text-xs text-[#98a2b3]">{customer.customerCode || "—"}</span></span></div></td><td className="px-5 py-4 text-sm text-[#667085]">{customer.phone || "—"}</td><td className="px-5 py-4 text-sm text-[#667085]">{customer.email || "—"}</td><td className="px-5 py-4 text-sm font-semibold text-[#182230]">{money(Number(customer.balance || 0))}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${active ? "bg-[#e8f8f1] text-[#168361]" : "bg-[#f2f4f7] text-[#667085]"}`}>{active ? "Active" : "Inactive"}</span></td><td className="px-5 py-4 text-right text-[#98a2b3]">›</td></tr>})}</tbody></table></div>}
          </section>
        </div>
      </main>
    </div>

    {selected && <>
      <div className="fixed inset-0 z-30 bg-[#101828]/20" onClick={() => setSelectedId(null)} />
      <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[#e4e7ec] bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-[#eaecf0] p-6"><div><p className="text-sm font-semibold text-[#4f46e5]">Customer details</p><h2 className="mt-1 text-xl font-bold text-[#182230]">{selected.name || "Unnamed customer"}</h2><p className="mt-1 text-sm text-[#667085]">{selected.customerCode || "Customer"}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close customer details" className="rounded-lg p-2 text-[#667085] hover:bg-[#f2f4f7]"><Icon name="close" /></button></header>
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#f6f5ff] p-4"><p className="text-xs font-medium uppercase text-[#98a2b3]">Current balance</p><p className="mt-2 text-xl font-bold text-[#4f46e5]">{money(Number(selected.balance || 0))}</p></div><div className="rounded-xl bg-[#ecfaf4] p-4"><p className="text-xs font-medium uppercase text-[#98a2b3]">Status</p><p className="mt-2 text-xl font-bold text-[#168361]">{(selected.status || "Active")}</p></div></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">{[["Phone", selected.phone || "—"], ["Email", selected.email || "—"], ["GST type", selected.gstType || "—"], ["State", selected.state || "—"]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#eaecf0] bg-[#fbfaf9] p-4"><p className="text-xs font-medium uppercase tracking-wide text-[#98a2b3]">{label}</p><p className="mt-2 text-sm font-semibold text-[#344054]">{value}</p></div>)}</div>
          <div className="mt-4 rounded-xl border border-[#eaecf0] p-4"><p className="text-xs font-medium uppercase tracking-wide text-[#98a2b3]">Address</p><p className="mt-2 text-sm leading-6 text-[#475467]">{selected.address || "No address added."}</p></div>
          <section className="mt-6"><div className="flex items-center justify-between"><div><h3 className="font-bold text-[#182230]">Transactions</h3><p className="mt-1 text-xs text-[#98a2b3]">Live sales and payment activity for this customer</p></div><span className="rounded-full bg-[#f2f4f7] px-2.5 py-1 text-xs font-semibold text-[#667085]">{selectedTransactions.length}</span></div>
            {transactionsLoading ? <p className="mt-4 text-sm text-[#667085]">Loading transactions…</p> : selectedTransactions.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-[#d0d5dd] p-5 text-center text-sm text-[#667085]">No transactions recorded yet.</div> : <div className="mt-4 overflow-hidden rounded-xl border border-[#eaecf0]"><table className="w-full text-left"><thead className="bg-[#fbfaf9] text-xs font-semibold text-[#667085]"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Number</th><th className="px-3 py-2">Date</th><th className="px-3 py-2 text-right">Amount</th></tr></thead><tbody className="divide-y divide-[#eaecf0]">{selectedTransactions.map((transaction) => <tr key={`${transaction.type}-${transaction.id}`}><td className="px-3 py-3 text-xs font-semibold text-[#344054]">{transaction.type === "Sales Invoice" ? "Sale" : "Payment"}</td><td className="px-3 py-3 text-xs text-[#667085]">{transaction.number}</td><td className="px-3 py-3 text-xs text-[#667085]">{transaction.date}</td><td className={`px-3 py-3 text-right text-xs font-semibold ${transaction.type === "Payment" ? "text-[#168361]" : "text-[#182230]"}`}>{money(transaction.total)}</td></tr>)}</tbody></table></div>}
          </section>
        </div>
        <footer className="space-y-3 border-t border-[#eaecf0] p-5"><div className="grid grid-cols-2 gap-3"><button type="button" onClick={openEdit} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#d0d5dd] py-2.5 text-sm font-semibold text-[#344054]"><Icon name="edit" /> Edit</button><button type="button" disabled={busyStatus} onClick={toggleStatus} className={`rounded-xl py-2.5 text-sm font-semibold ${String(selected.status || "Active").toLowerCase() === "active" ? "border border-[#f3d4a4] text-[#9a6700]" : "border border-[#b7e5d1] text-[#168361]"}`}>{busyStatus ? "Saving…" : String(selected.status || "Active").toLowerCase() === "active" ? "Mark inactive" : "Mark active"}</button></div><button type="button" disabled={deleting} onClick={removeSelected} className="w-full rounded-xl border border-[#fecdca] py-2.5 text-sm font-semibold text-[#b42318] hover:bg-[#fef3f2]">{deleting ? "Deleting…" : "Delete customer"}</button></footer>
      </aside>
    </>}

    {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/55 p-4"><form onSubmit={save} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-[#eaecf0] px-6 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-[#4f46e5]">Customer setup</p><h2 className="mt-1 text-lg font-bold text-[#182230]">{editing ? "Edit customer" : "Add customer"}</h2></div><button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-[#667085] hover:bg-[#f2f4f7]"><Icon name="close" /></button></header><div className="overflow-y-auto p-6"><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[#344054]">Customer name<input required value={form.name} onChange={update("name")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5]" /></label><label className="text-sm font-semibold text-[#344054]">Phone<input value={form.phone} onChange={update("phone")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5]" /></label></div><div className="mt-7 flex gap-5 border-b border-[#eaecf0]">{([["address", "Address"], ["gst", "GST"], ["balance", "Opening balance"]] as const).map(([key, label]) => <button type="button" key={key} onClick={() => setActiveTab(key)} className={`border-b-2 px-1 pb-3 text-sm font-semibold ${activeTab === key ? "border-[#4f46e5] text-[#4f46e5]" : "border-transparent text-[#98a2b3]"}`}>{label}</button>)}</div><div className="pt-6">{activeTab === "address" && <div className="grid gap-4"><label className="text-sm font-semibold text-[#344054]">Billing address<textarea value={form.address} onChange={update("address")} className="mt-2 h-28 w-full resize-none rounded-xl border border-[#d0d5dd] p-3 text-sm outline-none focus:border-[#4f46e5]" /></label><label className="text-sm font-semibold text-[#344054]">Email<input type="email" value={form.email} onChange={update("email")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5]" /></label></div>}{activeTab === "gst" && <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[#344054]">GST type<select value={form.gstType} onChange={update("gstType")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm outline-none focus:border-[#4f46e5]"><option>Unregistered/Consumer</option><option>Registered Business</option><option>Composition</option></select></label><label className="text-sm font-semibold text-[#344054]">State<input value={form.state} onChange={update("state")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5]" /></label></div>}{activeTab === "balance" && <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold text-[#344054]">Opening/current balance<input type="number" min="0" value={form.balance} onChange={update("balance")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#4f46e5]" /></label><div className="rounded-xl bg-[#fbfaf9] p-4 text-sm text-[#667085]">Sales invoices automatically add their outstanding balance to this customer.</div></div>}</div></div><footer className="flex justify-end gap-3 border-t border-[#eaecf0] px-6 py-4"><button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-[#d0d5dd] px-4 py-2.5 text-sm font-semibold text-[#344054]">Cancel</button><button type="submit" disabled={saving} className="rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : editing ? "Save changes" : "Save customer"}</button></footer></form></div>}
  </AuthGate>;
}
