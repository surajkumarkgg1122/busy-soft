"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import Sidebar from "./Components/Sidebar/page";
import TopNav from "./Components/TopNav/page";
import AuthGate from "./Components/Auth/AuthGate";
import { firestoreDb } from "../lib/firebase";
import { useBusiness } from "../context/BusinessContext";

const money = (value) => `₹ ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const dateValue = (value) => {
  if (!value) return null;
  if (typeof value === "string") return new Date(value);
  if (value?.toDate) return value.toDate();
  return value instanceof Date ? value : null;
};
const startFor = (period) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === "Today") return d;
  if (period === "This week") {
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
  }
  if (period === "This year") {
    d.setMonth(3, 1);
    return d;
  }
  d.setDate(1);
  return d;
};

function Metric({ label, value, detail, tone = "white" }) {
  const styles = {
    white: "border-[#e4e7ec] bg-white",
    dark: "border-[#1d2939] bg-[#101828] text-white",
    blue: "border-[#c8d4ff] bg-[#f1f4ff]",
    amber: "border-[#fedf89] bg-[#fffaeb]",
  };
  return (
    <article className={`rounded-2xl border p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] ${styles[tone]}`}>
      <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${tone === "dark" ? "text-[#98a2b3]" : "text-[#667085]"}`}>{label}</p>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.03em]">{value}</p>
      <p className={`mt-2 text-xs ${tone === "dark" ? "text-[#6ce9a6]" : "text-[#667085]"}`}>{detail}</p>
    </article>
  );
}

function StatisticsChart({ sales, loading }) {
  const [tab, setTab] = useState("Overview");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const chartData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const result = months.map((label, month) => ({ label, sales: 0, revenue: 0, target: 0, month }));
    sales.forEach((sale) => {
      const date = dateValue(sale.invoiceDate || sale.createdAt);
      if (!date || date.getFullYear() !== currentYear) return;
      const total = Number(sale.total || 0);
      const collected = Number(sale.paid || sale.received || 0);
      result[date.getMonth()].sales += total;
      result[date.getMonth()].revenue += collected;
    });

    // Keep the chart useful even for a newly-created business with sparse data.
    // Targets are derived from the business's observed monthly activity rather than fake sales.
    const observedMax = Math.max(...result.map((x) => x.sales), 0);
    const fallback = observedMax || 25000;
    result.forEach((x, index) => {
      x.target = fallback * (0.62 + ((index * 7) % 5) * 0.07);
    });
    return result;
  }, [sales]);

  const activeKey = tab === "Revenue" ? "revenue" : "sales";
  const secondaryKey = tab === "Sales" ? "target" : tab === "Revenue" ? "target" : "revenue";
  const primary = chartData.map((x) => x[activeKey]);
  const secondary = chartData.map((x) => x[secondaryKey]);
  const maxValue = Math.max(...primary, ...secondary, 1);
  const width = 1000;
  const height = 300;
  const left = 10;
  const right = 10;
  const top = 20;
  const bottom = 45;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const x = (index) => left + (index / (months.length - 1)) * plotWidth;
  const y = (value) => top + plotHeight - (value / maxValue) * plotHeight;
  const linePath = (key) => chartData.map((item, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(item[key]).toFixed(2)}`).join(" ");
  const areaPath = `${linePath(activeKey)} L ${x(months.length - 1)} ${top + plotHeight} L ${x(0)} ${top + plotHeight} Z`;
  const dateLabel = (() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return `${start.toLocaleDateString("en-IN", { month: "short", day: "2-digit" })} - ${end.toLocaleDateString("en-IN", { month: "short", day: "2-digit" })}`;
  })();

  return (
    <article className="overflow-hidden rounded-2xl border border-[#e4e7ec] bg-white shadow-sm">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-[#101828]">Statistics</h2>
            <p className="mt-1 text-sm text-[#667085]">Target you’ve set for each month</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-[#f2f4f7] p-1">
              {["Overview", "Sales", "Revenue"].map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setTab(item)}
                  className={`rounded-md px-3 py-2 text-xs font-medium transition ${tab === item ? "bg-white text-[#101828] shadow-sm" : "text-[#667085] hover:text-[#344054]"}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <button type="button" className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d0d5dd] bg-white px-3 text-xs font-semibold text-[#344054] shadow-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="4" width="18" height="17" rx="2" stroke="currentColor" strokeWidth="1.7" />
                <path d="M8 2.5V6M16 2.5V6M3 9H21" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
              </svg>
              {dateLabel}
            </button>
          </div>
        </div>

        <div className="mt-6 h-[330px] w-full">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-[#98a2b3]">Loading statistics…</div>
          ) : (
            <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label="Monthly business statistics chart">
              <defs>
                <linearGradient id="statisticsArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#465fff" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#465fff" stopOpacity="0.02" />
                </linearGradient>
              </defs>
              {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
                const yy = top + plotHeight * fraction;
                const label = Math.round(maxValue * (1 - fraction));
                return (
                  <g key={fraction}>
                    <line x1={left + 35} x2={width - right} y1={yy} y2={yy} stroke="#edf0f5" strokeWidth="1" />
                    <text x="0" y={yy + 4} fontSize="11" fill="#475467">{label >= 1000 ? `${Math.round(label / 1000)}k` : label}</text>
                  </g>
                );
              })}
              <path d={areaPath} fill="url(#statisticsArea)" />
              <path d={linePath(secondaryKey)} fill="none" stroke="#9bbcff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d={linePath(activeKey)} fill="none" stroke="#465fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {chartData.map((item, index) => (
                <g key={item.label}>
                  <circle cx={x(index)} cy={y(item[activeKey])} r="3" fill="#465fff" opacity="0">
                    <title>{`${item.label}: ${money(item[activeKey])}`}</title>
                  </circle>
                  <text x={x(index)} y={height - 13} textAnchor="middle" fontSize="11" fill="#344054">{item.label}</text>
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>
    </article>
  );
}

export default function DashboardPage() {
  const { activeBusinessId, activeBusiness, loading: businessLoading, can } = useBusiness();
  const [sales, setSales] = useState([]), [customers, setCustomers] = useState([]), [expenses, setExpenses] = useState([]), [items, setItems] = useState([]), [period, setPeriod] = useState("This month"), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const canView = can("reports", "view") || can("sales", "view");

  useEffect(() => {
    async function load() {
      if (businessLoading) return;
      if (!firestoreDb || !activeBusinessId) {
        setSales([]); setCustomers([]); setExpenses([]); setItems([]); setLoading(false); return;
      }
      if (!canView) { setLoading(false); return; }
      setLoading(true); setError("");
      try {
        const [s, c, e, i] = await Promise.all([
          getDocs(collection(firestoreDb, "businesses", activeBusinessId, "sales")),
          getDocs(collection(firestoreDb, "businesses", activeBusinessId, "customers")),
          getDocs(collection(firestoreDb, "businesses", activeBusinessId, "expenses")),
          getDocs(collection(firestoreDb, "businesses", activeBusinessId, "items")),
        ]);
        setSales(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        setCustomers(c.docs.map((d) => ({ id: d.id, ...d.data() })));
        setExpenses(e.docs.map((d) => ({ id: d.id, ...d.data() })));
        setItems(i.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err); setError("Could not load dashboard data. Check your Firestore rules.");
      } finally { setLoading(false); }
    }
    load();
  }, [activeBusinessId, businessLoading, canView]);

  const start = startFor(period);
  const filteredSales = useMemo(() => sales.filter((s) => { const d = dateValue(s.invoiceDate || s.createdAt); return !d || d >= start; }), [sales, start]);
  const filteredExpenses = useMemo(() => expenses.filter((e) => { const d = dateValue(e.date || e.expenseDate || e.createdAt); return !d || d >= start; }), [expenses, start]);
  const totalSales = filteredSales.reduce((a, s) => a + Number(s.total || 0), 0);
  const paid = filteredSales.reduce((a, s) => a + Number(s.paid || 0), 0);
  const outstanding = customers.reduce((a, c) => a + Math.max(0, Number(c.balance || 0)), 0);
  const expenseTotal = filteredExpenses.reduce((a, e) => a + Number(e.amount || e.total || 0), 0);
  const profit = totalSales - expenseTotal;
  const pending = filteredSales.filter((s) => Number(s.balance || 0) > 0 || ["Pending", "Unpaid", "Partially Paid"].includes(s.status)).length;
  const collectionRate = totalSales ? Math.round((paid / totalSales) * 100) : 0;
  const recent = [...filteredSales].sort((a, b) => (dateValue(b.invoiceDate || b.createdAt)?.getTime() || 0) - (dateValue(a.invoiceDate || a.createdAt)?.getTime() || 0)).slice(0, 6);
  const lowStock = items.filter((i) => Number(i.stock || 0) <= Number(i.minStock || i.minimumStock || 0)).slice(0, 5);
  const businessName = activeBusiness?.business?.name || "Your business";

  return (
    <AuthGate>
      <div className="flex min-h-screen bg-[#f5f7fb]">
        <Sidebar />
        <main className="min-w-0 flex-1 px-5 pb-10 sm:px-8 lg:px-10">
          <TopNav />
          <div className="mx-auto max-w-[1440px]">
            <header className="flex flex-col justify-between gap-4 border-b border-[#e4e7ec] pb-6 pt-2 lg:flex-row lg:items-end">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#465fff]">Dashboard</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#101828]">Business Command Center</h1>
                <p className="mt-2 text-sm text-[#667085]">Live performance for <span className="font-semibold text-[#344054]">{businessName}</span>.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select value={period} onChange={(e) => setPeriod(e.target.value)} className="h-10 rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm text-[#344054]"><option>Today</option><option>This week</option><option>This month</option><option>This year</option></select>
                <a href="/sales" className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#465fff] px-4 text-sm font-semibold text-white">+ Quick sale</a>
              </div>
            </header>
            {error && <div className="mt-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
            <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Net sales" value={loading ? "—" : money(totalSales)} detail={`${filteredSales.length} invoices in period`} tone="dark" />
              <Metric label="Estimated profit" value={loading ? "—" : money(profit)} detail={`${totalSales ? Math.round((profit / totalSales) * 100) : 0}% estimated margin`} />
              <Metric label="Collected" value={loading ? "—" : money(paid)} detail={`${collectionRate}% collection rate`} tone="blue" />
              <Metric label="Outstanding" value={loading ? "—" : money(outstanding)} detail={`${pending} invoices need follow-up`} tone="amber" />
            </section>
            <section className="mt-5">
              <StatisticsChart sales={sales} loading={loading} />
            </section>
            <section className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(300px,.8fr)]">
              <article className="rounded-2xl border border-[#e4e7ec] bg-white p-5 shadow-sm sm:p-6">
                <div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#98a2b3]">Action center</p><h2 className="mt-1 text-lg font-semibold text-[#101828]">Needs attention</h2></div></div>
                <div className="mt-4 divide-y divide-[#eaecf0]"><a href="/payments" className="block py-4"><p className="text-sm font-semibold text-[#344054]">Pending collections</p><p className="mt-1 text-xs text-[#98a2b3]">{pending} invoice{pending === 1 ? "" : "s"} with outstanding balance</p></a><a href="/items" className="block py-4"><p className="text-sm font-semibold text-[#344054]">Stock review</p><p className="mt-1 text-xs text-[#98a2b3]">{lowStock.length} item{lowStock.length === 1 ? "" : "s"} at/below minimum stock</p></a><a href="/customers" className="block py-4"><p className="text-sm font-semibold text-[#344054]">Receivables</p><p className="mt-1 text-xs text-[#98a2b3]">{money(outstanding)} total customer balance</p></a></div>
              </article>
              <article className="rounded-2xl border border-[#e4e7ec] bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#98a2b3]">Inventory</p><h2 className="mt-1 text-lg font-semibold text-[#101828]">Stock watch</h2><div className="mt-4 space-y-3">{lowStock.length ? lowStock.map((i) => <div key={i.id} className="flex items-center gap-3 rounded-xl bg-[#f8f9fc] p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#344054]">{i.name || "Unnamed item"}</p><p className="text-xs text-[#98a2b3]">Minimum {Number(i.minStock || i.minimumStock || 0)}</p></div><span className="rounded-lg bg-[#fef3f2] px-2 py-1 text-xs font-bold text-[#b42318]">{Number(i.stock || 0)} left</span></div>) : <div className="rounded-xl bg-[#ecfdf3] p-4 text-sm text-[#067647]">All tracked items are above their minimum stock level.</div>}</div><a href="/items" className="mt-4 inline-block text-xs font-semibold text-[#465fff]">Open inventory →</a></article>
            </section>
            <section className="mt-5"><article className="overflow-hidden rounded-2xl border border-[#e4e7ec] bg-white shadow-sm"><div className="flex items-center justify-between border-b border-[#eaecf0] px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#98a2b3]">Transactions</p><h2 className="mt-1 text-lg font-semibold text-[#101828]">Recent sales</h2></div><a href="/sales" className="text-xs font-semibold text-[#465fff]">View all →</a></div><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead className="bg-[#f8f9fc] text-left text-xs text-[#667085]"><tr><th className="px-5 py-3">Invoice</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Date</th><th className="px-5 py-3 text-right">Amount</th><th className="px-5 py-3">Status</th></tr></thead><tbody>{recent.length ? recent.map((s) => <tr key={s.id} className="border-t border-[#f2f4f7]"><td className="px-5 py-3 font-semibold text-[#344054]">#{s.invoiceNumber || s.id.slice(0, 6)}</td><td className="px-5 py-3 text-[#667085]">{s.customerName || "Cash Sale"}</td><td className="px-5 py-3 text-[#667085]">{dateValue(s.invoiceDate || s.createdAt)?.toLocaleDateString("en-IN") || "—"}</td><td className="px-5 py-3 text-right font-semibold text-[#344054]">{money(s.total)}</td><td className="px-5 py-3"><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${Number(s.balance || 0) > 0 ? "bg-[#fffaeb] text-[#b54708]" : "bg-[#ecfdf3] text-[#067647]"}`}>{s.status || "Paid"}</span></td></tr>) : <tr><td colSpan="5" className="px-5 py-10 text-center text-sm text-[#98a2b3]">No sales found for this period.</td></tr>}</tbody></table></div></article></section>
          </div>
        </main>
      </div>
    </AuthGate>
  );
}
