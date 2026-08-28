"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs } from "firebase/firestore";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { firestoreDb } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";

type Tx = {
  id: string;
  date: string;
  refNo: string;
  party: string;
  particulars: string;
  category: string;
  voucherType: string;
  debit: number;
  credit: number;
  total: number;
  receivedPaid: number;
  balance: number;
};

const COLLECTIONS = [
  ["sales", "Sale", "Sale"],
  ["purchases", "Purchase", "Purchase"],
  ["payments", "Payment", "Payment"],
  ["salesReturns", "Credit Note", "Sale Return"],
  ["purchaseReturns", "Debit Note", "Purchase Return"],
  ["quotations", "Estimate", "Estimate"],
  ["salesOrders", "Sale Order", "Sale Order"],
  ["purchaseOrders", "Purchase Order", "Purchase Order"],
  ["expenses", "Expense", "Expenses"],
  ["cashTransactions", "Cash Entry", "Cash & Bank"],
  ["bankTransactions", "Bank Entry", "Bank"],
] as const;

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);
const dateKey = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const v = value as { toDate?: () => Date };
  if (v?.toDate) return v.toDate().toISOString().slice(0, 10);
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};
const dateLabel = (value: string) => value ? new Date(`${value}T00:00:00`).toLocaleDateString("en-IN") : "—";
const num = (...values: unknown[]) => {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};

function normalize(id: string, data: Record<string, any>, type: string, category: string): Tx {
  const date = dateKey(data.invoiceDate || data.date || data.orderDate || data.returnDate || data.createdAt || data.updatedAt);
  const refNo = String(data.invoiceNumber ?? data.returnNumber ?? data.orderNumber ?? data.paymentNumber ?? data.referenceNumber ?? data.refNo ?? data.number ?? "—");
  const party = String(data.customerName ?? data.supplierName ?? data.partyName ?? data.name ?? (data.direction === "in" ? "Cash / Bank" : "—") ?? "—");
  const amount = num(data.total, data.amount, data.grandTotal, data.netTotal, data.value);
  const paid = num(data.paid, data.received, data.receivedAmount, data.paymentAmount, data.amount && data.direction === "in" ? data.amount : 0);
  const balance = num(data.balance, data.outstanding);
  let debit = num(data.debit);
  let credit = num(data.credit);
  if (!debit && !credit) {
    if (["Sale", "Expense", "Purchase Return"].includes(type)) debit = amount;
    if (["Purchase", "Credit Note"].includes(type)) credit = amount;
    if (type === "Payment") {
      if (data.direction === "out") debit = amount;
      else credit = amount;
    }
    if (type === "Sale Order" || type === "Estimate" || type === "Purchase Order") {
      debit = 0;
      credit = 0;
    }
  }
  return {
    id, date, refNo, party,
    particulars: String(data.particulars ?? data.description ?? data.note ?? type),
    category,
    voucherType: String(data.voucherType ?? type),
    debit, credit,
    total: amount,
    receivedPaid: paid,
    balance: balance || Math.max(0, debit - credit - paid),
  };
}

export default function DayBookPage() {
  const { activeBusinessId, loading: businessLoading } = useBusiness();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [party, setParty] = useState("All parties");
  const [type, setType] = useState("All transactions");
  const [rows, setRows] = useState<Tx[]>([]);
  const [parties, setParties] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (businessLoading) return;
    if (!firestoreDb || !activeBusinessId) { setRows([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const business = doc(firestoreDb, "businesses", activeBusinessId);
      const results = await Promise.all(COLLECTIONS.map(async ([name, voucher, category]) => {
        try {
          const snap = await getDocs(collection(business, name));
          return snap.docs.map((d) => normalize(d.id, d.data(), voucher, category));
        } catch (e) {
          console.warn(`Skipping ${name}`, e);
          return [] as Tx[];
        }
      }));
      const all = results.flat().filter((r) => r.date === date).sort((a, b) => a.refNo.localeCompare(b.refNo, undefined, { numeric: true }));
      setRows(all);
      setParties(Array.from(new Set(all.map((r) => r.party).filter(Boolean))).sort());
    } catch (e) {
      console.error(e);
      setError("Could not load Day Book. Check Firestore rules and your business membership.");
    } finally { setLoading(false); }
  }, [activeBusinessId, businessLoading, date]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => (party === "All parties" || r.party === party) && (type === "All transactions" || r.voucherType === type)), [rows, party, type]);
  const totals = useMemo(() => filtered.reduce((a, r) => ({ debit: a.debit + r.debit, credit: a.credit + r.credit, moneyIn: a.moneyIn + (r.voucherType === "Payment" && r.credit > 0 ? r.credit : r.voucherType === "Sale" ? r.receivedPaid : 0), moneyOut: a.moneyOut + (r.voucherType === "Payment" && r.debit > 0 ? r.debit : r.voucherType === "Expense" ? r.debit : 0) }), { debit: 0, credit: 0, moneyIn: 0, moneyOut: 0 }), [filtered]);

  const exportCsv = () => {
    const lines = [["Date", "Ref No.", "Party Name", "Particulars", "Voucher Type", "Category", "Debit", "Credit", "Balance"], ...filtered.map(r => [r.date, r.refNo, r.party, r.particulars, r.voucherType, r.category, r.debit, r.credit, r.balance])];
    const csv = lines.map(line => line.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = `day-book-${date}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return <AuthGate><div className="flex min-h-screen bg-[var(--erp-background)]"><Sidebar/><main className="min-w-0 flex-1 px-4 pb-8 sm:px-6 lg:px-8"><TopNav/><div className="mx-auto max-w-[1500px] py-5">
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-[var(--erp-primary)]">Reports / Transaction report</p><h1 className="mt-1 text-2xl font-bold text-[var(--erp-text)]">Day Book</h1><p className="mt-1 text-sm text-[var(--erp-text-muted)]">Chronological view of all business transactions for a selected day.</p></div><div className="flex gap-2"><button onClick={exportCsv} className="h-9 rounded-lg border border-[var(--erp-border)] bg-white px-3 text-sm font-semibold">Export Excel</button><button onClick={() => window.print()} className="h-9 rounded-lg border border-[var(--erp-border)] bg-white px-3 text-sm font-semibold">Print</button></div></div>
    <section className="erp-card overflow-hidden rounded-xl"><div className="flex flex-wrap items-center gap-3 border-b border-[var(--erp-border)] bg-white p-4"><label className="text-xs font-semibold text-[var(--erp-text-muted)]">Date<input type="date" value={date} onChange={e => setDate(e.target.value)} className="erp-input ml-2 h-9 w-40 px-2"/></label><label className="text-xs font-semibold text-[var(--erp-text-muted)]">Filters<select value={type} onChange={e => setType(e.target.value)} className="erp-input ml-2 h-9 w-44 px-2"><option>All transactions</option>{Array.from(new Set(COLLECTIONS.map(x => x[1]))).map(v => <option key={v}>{v}</option>)}</select></label><label className="text-xs font-semibold text-[var(--erp-text-muted)]">Party<select value={party} onChange={e => setParty(e.target.value)} className="erp-input ml-2 h-9 w-48 px-2"><option>All parties</option>{parties.map(p => <option key={p}>{p}</option>)}</select></label><button onClick={load} className="ml-auto h-9 rounded-lg bg-[var(--erp-primary)] px-4 text-sm font-semibold text-white">↻ Refresh</button></div>
      {error && <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <div className="border-b border-[var(--erp-border)] px-4 py-3"><h2 className="font-bold text-[var(--erp-text)]">TRANSACTIONS</h2></div>
      <div className="overflow-auto"><table className="w-full min-w-[1050px] border-collapse text-[12px]"><thead className="bg-[#f3f4f6] text-[11px] font-bold uppercase text-[var(--erp-text-muted)]"><tr>{["DATE","REF NO.","PARTY NAME","PARTICULARS","VOUCHER TYPE","CATEGORY","DEBIT (₹)","CREDIT (₹)","BALANCE (₹)"].map(h=><th key={h} className="border-r border-[var(--erp-border)] px-3 py-2.5 text-left last:text-right">{h}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={9} className="p-12 text-center text-sm text-[var(--erp-text-muted)]">Loading transactions…</td></tr> : filtered.map((r, i) => <tr key={`${r.id}-${i}`} className="border-b border-[var(--erp-border)] odd:bg-white even:bg-[#fafafa] hover:bg-blue-50"><td className="px-3 py-2.5">{dateLabel(r.date)}</td><td className="px-3 py-2.5 font-medium">{r.refNo}</td><td className="px-3 py-2.5">{r.party}</td><td className="max-w-[220px] px-3 py-2.5">{r.particulars}</td><td className="px-3 py-2.5">{r.voucherType}</td><td className="px-3 py-2.5">{r.category}</td><td className="px-3 py-2.5 text-right">{r.debit ? money(r.debit) : "₹ 0.00"}</td><td className="px-3 py-2.5 text-right">{r.credit ? money(r.credit) : "₹ 0.00"}</td><td className="px-3 py-2.5 text-right font-semibold">{money(r.balance)}</td></tr>)}{!loading && !filtered.length && <tr><td colSpan={9} className="p-14 text-center text-sm text-[var(--erp-text-muted)]">No transactions found for {dateLabel(date)}.</td></tr>}</tbody><tfoot><tr className="bg-[#f8fafc] font-bold"><td colSpan={6} className="px-3 py-3 text-right text-[var(--erp-text-muted)]">TOTAL</td><td className="px-3 py-3 text-right text-emerald-600">{money(totals.debit)}</td><td className="px-3 py-3 text-right text-red-500">{money(totals.credit)}</td><td className="px-3 py-3 text-right text-[var(--erp-text)]">{money(totals.debit - totals.credit)}</td></tr></tfoot></table></div>
      <div className="flex flex-wrap justify-between gap-3 border-t border-[var(--erp-border)] bg-white px-4 py-3 text-sm"><span className="font-semibold text-emerald-600">Total Money-In: {money(totals.moneyIn)}</span><span className="font-semibold text-red-500">Total Money-Out: {money(totals.moneyOut)}</span><span className="font-bold">Net: {money(totals.moneyIn - totals.moneyOut)}</span></div>
    </section>
  </div></main></div></AuthGate>;
}
