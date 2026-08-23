"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { firestoreDb } from "../../lib/firebase";
import { recordCustomerPayment } from "../../lib/customerBalance";

const emptyForm = { customerId: "", amount: "", direction: "in", method: "Cash", note: "" };

export default function PaymentsPage() {
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadCustomers() {
      if (!firestoreDb) { setError("Firebase is not configured. Check your .env.local file."); setLoading(false); return; }
      try {
        const snapshot = await getDocs(collection(firestoreDb, "customers"));
        setCustomers(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        const paymentSnapshot = await getDocs(collection(firestoreDb, "payments"));
        setPayments(paymentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      } catch (loadError) {
        console.error("Could not load payments:", loadError);
        setError("Could not load payments. Enable Firestore and check its rules.");
      } finally { setLoading(false); }
    }
    loadCustomers();
  }, []);

  function updateForm(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function savePayment(event) {
    event.preventDefault();
    if (!firestoreDb) return;
    setSaving(true); setError("");
    const customer = customers.find((item) => item.id === form.customerId);
    try {
      await recordCustomerPayment(firestoreDb, {
        customerId: form.customerId,
        amount: Number(form.amount),
        direction: form.direction,
        method: form.method,
        note: form.note,
        customerName: customer?.name || "",
      });
      setForm(emptyForm);
      const paymentSnapshot = await getDocs(collection(firestoreDb, "payments"));
      setPayments(paymentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setCustomers((current) => current.map((item) => item.id === form.customerId ? { ...item, balance: Math.max(0, Number(item.balance || 0) + (form.direction === "out" ? Number(form.amount) : -Number(form.amount))) } : item));
    } catch (saveError) {
      console.error("Could not save payment:", saveError);
      setError(saveError.message || "Could not save payment. Check Firestore rules and try again.");
    } finally { setSaving(false); }
  }

  return <AuthGate><div className="flex min-h-screen bg-[#f7f8fc]"><Sidebar /><main className="min-w-0 flex-1 px-6 pb-8 pt-0 lg:px-10"><TopNav /><div className="mx-auto max-w-[1100px]">
    <div className="mb-8"><p className="mb-2 text-sm font-medium text-[#465fff]">Accounts receivable</p><h1 className="text-3xl font-bold tracking-tight text-[#1c2940]">Payments</h1><p className="mt-2 text-sm text-[#667085]">Record money received from or returned to customers.</p></div>
    {error && <div role="alert" className="mb-5 rounded-lg border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
    <section className="mb-6 rounded-xl border border-[#e4e7ec] bg-white p-5 shadow-sm"><h2 className="mb-4 font-semibold text-[#101828]">Record payment</h2><form onSubmit={savePayment} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-sm font-medium text-[#344054] lg:col-span-2">Customer<select required value={form.customerId} onChange={updateForm("customerId")} className="mt-1 h-10 w-full rounded-lg border border-[#d0d5dd] bg-white px-3"><option value="">Select customer</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · ₹{Number(customer.balance || 0).toLocaleString("en-IN")}</option>)}</select></label>
      <label className="text-sm font-medium text-[#344054]">Direction<select value={form.direction} onChange={updateForm("direction")} className="mt-1 h-10 w-full rounded-lg border border-[#d0d5dd] bg-white px-3"><option value="in">Payment in</option><option value="out">Payment out</option></select></label>
      <label className="text-sm font-medium text-[#344054]">Amount<input required min="1" type="number" value={form.amount} onChange={updateForm("amount")} className="mt-1 h-10 w-full rounded-lg border border-[#d0d5dd] px-3" /></label>
      <label className="text-sm font-medium text-[#344054]">Method<select value={form.method} onChange={updateForm("method")} className="mt-1 h-10 w-full rounded-lg border border-[#d0d5dd] bg-white px-3"><option>Cash</option><option>UPI</option><option>Card</option><option>Bank transfer</option></select></label>
      <label className="text-sm font-medium text-[#344054] sm:col-span-2 lg:col-span-4">Note<input value={form.note} onChange={updateForm("note")} className="mt-1 h-10 w-full rounded-lg border border-[#d0d5dd] px-3" /></label>
      <button disabled={saving || loading} type="submit" className="h-10 self-end rounded-lg bg-[#465fff] px-4 text-sm font-semibold text-white hover:bg-[#364bd9] disabled:opacity-50">{saving ? "Saving..." : "Save payment"}</button>
    </form></section>
    <section className="overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-sm"><div className="border-b border-[#eaecf0] p-5"><h2 className="font-semibold text-[#101828]">Payment history</h2></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-[#f9fafb] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Direction</th><th className="px-5 py-3">Method</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#eaecf0]">{payments.map((payment) => <tr key={payment.id}><td className="px-5 py-4">{payment.customerName || customers.find((customer) => customer.id === payment.customerId)?.name || "Customer"}</td><td className="px-5 py-4">{payment.direction === "out" ? "Payment out" : "Payment in"}</td><td className="px-5 py-4">{payment.method}</td><td className="px-5 py-4 font-medium">₹{Number(payment.amount || 0).toLocaleString("en-IN")}</td><td className="px-5 py-4"><span className="rounded-full bg-[#ecfdf3] px-2.5 py-1 text-xs font-semibold text-[#027a48]">Recorded</span></td></tr>)}</tbody></table>{!loading && payments.length === 0 && <p className="p-10 text-center text-sm text-[#667085]">No payments recorded.</p>}</div></section>
  </div></main></div></AuthGate>;
}
