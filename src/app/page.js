"use client";

import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import Sidebar from "./Components/Sidebar/page";
import TopNav from "./Components/TopNav/page";
import AuthGate from "./Components/Auth/AuthGate";
import { firestoreDb } from "../lib/firebase";

function money(value) {
  return `\u20B9 ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function Sparkline({ values, color = "#465fff" }) {
  const safeValues = values.length ? values : [0, 0, 0, 0, 0, 0, 0];
  const maximum = Math.max(...safeValues, 1);
  const points = safeValues.map((value, index) => `${(safeValues.length === 1 ? 500 : (index / (safeValues.length - 1)) * 1000)},${190 - (value / maximum) * 150}`).join(" ");
  return <svg viewBox="0 0 1000 210" preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Sales trend"><path d="M0 190H1000" stroke="#eaecf0" /><path d="M0 115H1000" stroke="#eaecf0" strokeDasharray="5 7" /><path d="M0 40H1000" stroke="#eaecf0" strokeDasharray="5 7" /><polyline points={points} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />{safeValues.map((value, index) => <circle key={`${value}-${index}`} cx={safeValues.length === 1 ? 500 : (index / (safeValues.length - 1)) * 1000} cy={190 - (value / maximum) * 150} r="5" fill="white" stroke={color} strokeWidth="3" />)}</svg>;
}

function Metric({ label, value, detail, tone = "white" }) {
  const styles = { white: "border-[#e4e7ec] bg-white", dark: "border-[#1d2939] bg-[#101828] text-white", blue: "border-[#c8d4ff] bg-[#f1f4ff]", amber: "border-[#fedf89] bg-[#fffaeb]" };
  return <article className={`rounded-2xl border p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${styles[tone]}`}><p className={`text-xs font-semibold uppercase tracking-[0.14em] ${tone === "dark" ? "text-[#98a2b3]" : "text-[#667085]"}`}>{label}</p><p className="mt-4 text-2xl font-semibold tracking-[-0.03em]">{value}</p><p className={`mt-2 text-xs ${tone === "dark" ? "text-[#6ce9a6]" : "text-[#667085]"}`}>{detail}</p></article>;
}

export default function NewDashboard() {
  const [sales, setSales] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("This month");

  useEffect(() => {
    async function loadData() {
      if (!firestoreDb) return setLoading(false);
      try {
        const [salesSnapshot, customersSnapshot] = await Promise.all([getDocs(collection(firestoreDb, "sales")), getDocs(collection(firestoreDb, "customers"))]);
        setSales(salesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
        setCustomers(customersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const totalSales = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const paidSales = sales.reduce((sum, sale) => sum + Number(sale.paid || 0), 0);
  const receivables = customers.reduce((sum, customer) => sum + Math.max(0, Number(customer.balance || 0)), 0);
  const expenses = sales.reduce((sum, sale) => sum + Number(sale.expense || 0), 0);
  const profit = totalSales - expenses;
  const pendingInvoices = sales.filter((sale) => (sale.paymentStatus || "Pending") !== "Paid").length;
  const collectionRate = totalSales ? Math.min(100, Math.round((paidSales / totalSales) * 100)) : 0;
  const trend = sales.slice(-7).map((sale) => Number(sale.total || 0));
  const brief = loading ? "Preparing your business summary..." : `You have ${money(totalSales)} in sales and ${money(receivables)} in receivables. ${pendingInvoices ? `${pendingInvoices} invoices need follow-up.` : "Your invoices are up to date."}`;

  return <AuthGate><div className="flex min-h-screen bg-[#f5f7fb]"><Sidebar /><main className="min-w-0 flex-1 px-5 pb-10 sm:px-8 lg:px-10"><TopNav /><div className="mx-auto max-w-[1440px]">
    <header className="flex flex-col justify-between gap-5 border-b border-[#e4e7ec] pb-6 pt-2 lg:flex-row lg:items-end"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#465fff]">Dashboard</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#101828]">Business Command Center</h1><p className="mt-2 text-sm text-[#667085]">A focused view of what is happening in Ganpati Neer.</p></div><div className="flex flex-wrap gap-2"><select value={period} onChange={(event) => setPeriod(event.target.value)} aria-label="Dashboard period" className="h-10 rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm text-[#344054] outline-none focus:border-[#465fff]"><option>Today</option><option>This week</option><option>This month</option><option>This year</option></select><a href="/sales" className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#465fff] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[#3648d8]"><span className="text-lg leading-none">+</span> Quick sale</a></div></header>

    <section aria-label="AI business brief" className="mt-6 rounded-2xl border border-[#c8d4ff] bg-[#eef2ff] p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#465fff]">AI business brief</p><p className="mt-2 max-w-3xl text-sm leading-6 text-[#344054]">{brief}</p></div><a href="#insights" className="shrink-0 text-sm font-semibold text-[#465fff]">View insights <span aria-hidden="true">-&gt;</span></a></div></section>

    <section aria-label="Business metrics" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Net sales" value={money(totalSales)} detail="Live from recorded invoices" tone="dark" /><Metric label="Gross profit" value={money(profit)} detail={`${totalSales ? Math.round((profit / totalSales) * 100) : 0}% estimated margin`} /><Metric label="Cash position" value={money(paidSales)} detail={`${collectionRate}% of sales collected`} tone="blue" /><Metric label="Outstanding" value={money(receivables)} detail={`${pendingInvoices} invoices pending`} tone="amber" /></section>

    <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.8fr)]"><article className="rounded-2xl border border-[#e4e7ec] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#98a2b3]">Performance</p><h2 className="mt-1 text-lg font-semibold text-[#101828]">Sales vs collected</h2></div><div className="flex items-center gap-4 text-xs text-[#667085]"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#465fff]" />Sales</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#12b76a]" />Collected</span></div></div><div className="mt-8 h-[240px]"><Sparkline values={trend} /></div><div className="flex justify-between text-xs text-[#98a2b3]"><span>{period}</span><span>Latest activity</span></div></article><article className="rounded-2xl border border-[#e4e7ec] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-6"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#98a2b3]">Action center</p><h2 className="mt-1 text-lg font-semibold text-[#101828]">Needs attention</h2></div><span className="rounded-full bg-[#101828] px-2.5 py-1 text-[11px] font-semibold text-white">{pendingInvoices}</span></div><div className="mt-5 divide-y divide-[#eaecf0]">{[{ title: "Overdue collections", detail: `${pendingInvoices} invoices to follow up`, action: "Collect", href: "/payments", color: "#f04438" }, { title: "Stock review", detail: "Review minimum stock levels", action: "Restock", href: "#insights", color: "#f79009" }, { title: "Customer coverage", detail: `${customers.length} customer records`, action: "Open", href: "/customers", color: "#465fff" }].map((item) => <div key={item.title} className="flex items-center gap-3 py-4"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-[#344054]">{item.title}</p><p className="mt-1 truncate text-xs text-[#98a2b3]">{item.detail}</p></div><a href={item.href} className="shrink-0 text-xs font-semibold text-[#465fff]">{item.action} -&gt;</a></div>)}</div></article></section>

    <section id="insights" className="mt-5"><div className="flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#98a2b3]">Business insights</p><h2 className="mt-1 text-lg font-semibold text-[#101828]">Make the next decision faster</h2></div><span className="text-xs text-[#98a2b3]">Live workspace data</span></div><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><article className="rounded-2xl border border-[#e4e7ec] bg-white p-5"><p className="text-xs text-[#667085]">Top customers</p><p className="mt-4 truncate text-sm font-semibold text-[#101828]">{customers[0]?.name || customers[0]?.customerName || "No customer data"}</p><p className="mt-1 text-xs text-[#98a2b3]">{customers.length} total records</p></article><article className="rounded-2xl border border-[#e4e7ec] bg-white p-5"><p className="text-xs text-[#667085]">Recorded expenses</p><p className="mt-4 text-sm font-semibold text-[#101828]">{money(expenses)}</p><p className="mt-1 text-xs text-[#98a2b3]">Deducted from estimated profit</p></article><article className="rounded-2xl border border-[#e4e7ec] bg-white p-5"><p className="text-xs text-[#667085]">Inventory watch</p><p className="mt-4 text-sm font-semibold text-[#101828]">Review stock levels</p><p className="mt-1 text-xs text-[#b54708]">Prevent missed sales</p></article><article className="rounded-2xl border border-[#e4e7ec] bg-white p-5"><p className="text-xs text-[#667085]">Next best action</p><p className="mt-4 text-sm font-semibold text-[#101828]">Follow up on payments</p><p className="mt-1 text-xs text-[#465fff]">Protect cash flow</p></article></div></section>
  </div></main></div></AuthGate>;
}
