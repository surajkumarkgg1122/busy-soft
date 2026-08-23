"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { firestoreDb } from "../../../lib/firebase";

function formatCurrency(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function PartyWiseStatementPage() {
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadStatement() {
      if (!firestoreDb) { setError("Firebase is not configured. Check your .env.local file."); setLoading(false); return; }
      try {
        const [customerSnapshot, salesSnapshot] = await Promise.all([
          getDocs(collection(firestoreDb, "customers")),
          getDocs(collection(firestoreDb, "sales")),
        ]);
        const customers = customerSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
        const sales = salesSnapshot.docs.map((item) => item.data());
        setRows(customers.map((customer) => {
          const customerSales = sales.filter((sale) => sale.customerId === customer.id);
          return {
            id: customer.id,
            name: customer.name || "Unnamed customer",
            customerId: customer.customerId || customer.id,
            sales: customerSales.reduce((total, sale) => total + Number(sale.total || 0), 0),
            paid: customerSales.reduce((total, sale) => total + Number(sale.paid || 0), 0),
            balance: Math.max(0, Number(customer.balance || 0)),
          };
        }));
      } catch (loadError) {
        console.error("Could not load party statement:", loadError);
        setError("Could not load party statement. Enable Firestore and check its rules.");
      } finally { setLoading(false); }
    }
    loadStatement();
  }, []);

  const filteredRows = useMemo(() => rows.filter((row) => `${row.name} ${row.customerId}`.toLowerCase().includes(query.toLowerCase())), [query, rows]);
  const totals = filteredRows.reduce((summary, row) => ({ sales: summary.sales + row.sales, paid: summary.paid + row.paid, balance: summary.balance + row.balance }), { sales: 0, paid: 0, balance: 0 });

  return <AuthGate><div className="flex min-h-screen bg-[#f7f8fc]"><Sidebar /><main className="min-w-0 flex-1 px-6 pb-8 pt-0 lg:px-10"><TopNav /><div className="mx-auto max-w-[1400px]">
    <div className="mb-8"><p className="mb-2 text-sm font-medium text-[#465fff]">Reports</p><h1 className="text-3xl font-bold tracking-tight text-[#1c2940]">Party wise statement</h1><p className="mt-2 text-sm text-[#667085]">Review sales, payments, and outstanding balances by customer.</p></div>
    {error && <div role="alert" className="mb-5 rounded-lg border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
    <section className="overflow-hidden rounded-xl border border-[#e4e7ec] bg-white shadow-sm"><div className="flex flex-col justify-between gap-3 border-b border-[#eaecf0] p-5 sm:flex-row sm:items-center"><div><h2 className="font-semibold text-[#101828]">Customer balances</h2><p className="mt-1 text-xs text-[#667085]">{filteredRows.length} parties</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search party" className="h-10 rounded-lg border border-[#d0d5dd] px-3 text-sm outline-none focus:border-[#465fff] sm:w-64" /></div>
      <div className="overflow-x-auto">{loading ? <p className="p-10 text-center text-sm text-[#667085]">Loading statement...</p> : <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#f9fafb] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr><th className="px-5 py-3">Party</th><th className="px-5 py-3">Total sales</th><th className="px-5 py-3">Paid amount</th><th className="px-5 py-3">Outstanding</th></tr></thead><tbody className="divide-y divide-[#eaecf0]">{filteredRows.map((row) => <tr key={row.id}><td className="px-5 py-4"><div className="font-semibold text-[#1c2940]">{row.name}</div><div className="text-xs text-[#98a2b3]">{row.customerId}</div></td><td className="px-5 py-4">{formatCurrency(row.sales)}</td><td className="px-5 py-4 text-[#027a48]">{formatCurrency(row.paid)}</td><td className="px-5 py-4 font-semibold text-[#b54708]">{formatCurrency(row.balance)}</td></tr>)}</tbody><tfoot className="border-t border-[#eaecf0] bg-[#f9fafb] font-semibold"><tr><td className="px-5 py-4">Total</td><td className="px-5 py-4">{formatCurrency(totals.sales)}</td><td className="px-5 py-4 text-[#027a48]">{formatCurrency(totals.paid)}</td><td className="px-5 py-4 text-[#b54708]">{formatCurrency(totals.balance)}</td></tr></tfoot></table>}{!loading && filteredRows.length === 0 && <p className="p-10 text-center text-sm text-[#667085]">No parties found.</p>}</div>
    </section>
  </div></main></div></AuthGate>;
}
