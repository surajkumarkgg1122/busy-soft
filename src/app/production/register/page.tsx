"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { auth } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";

type Production = { id: string; date: string; voucherNumber: string; itemName: string; itemId: string; quantity: number; totalCost: number; unitCost: number; status: string; materialCost: number; labourCost: number; electricityCost: number; machineCost: number; overheadCost: number; otherCost: number; warehouseId?: string | null };
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format((n || 0) / 100);

export default function ProductionRegisterPage() {
  const { activeBusinessId, businessName, loading } = useBusiness();
  const [rows, setRows] = useState<Production[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Production | null>(null);

  useEffect(() => {
    if (loading || !activeBusinessId) return;
    void (async () => {
      try {
        if (!auth.currentUser) throw new Error("Please sign in again.");
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(`/api/production?businessId=${activeBusinessId}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load production register.");
        setRows(data.productions || []);
      } catch (e) { setError(e instanceof Error ? e.message : "Unable to load production register."); }
    })();
  }, [activeBusinessId, loading]);

  const filtered = useMemo(() => rows.filter(row => `${row.voucherNumber} ${row.itemName} ${row.itemId}`.toLowerCase().includes(query.trim().toLowerCase())), [rows, query]);
  const total = filtered.reduce((sum, row) => sum + Number(row.totalCost || 0), 0);
  const quantity = filtered.reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  return <AuthGate><div className="flex min-h-screen bg-slate-50"><Sidebar /><main className="min-w-0 flex-1 px-4 pb-10 sm:px-8"><TopNav /><div className="mx-auto max-w-[1450px] py-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-indigo-600">{businessName || "Business"} · Manufacturing</p><h1 className="text-3xl font-bold text-slate-900">Production Register</h1><p className="mt-1 text-sm text-slate-500">Review posted production vouchers and finished-goods valuation.</p></div><a href="/production" className="rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white">+ Production Entry</a></div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="mt-6 grid gap-4 md:grid-cols-3"><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Vouchers</p><b className="mt-2 block text-2xl">{filtered.length}</b></div><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Finished Quantity</p><b className="mt-2 block text-2xl">{quantity.toFixed(3)}</b></div><div className="rounded-2xl border bg-white p-5"><p className="text-sm text-slate-500">Production Cost</p><b className="mt-2 block text-2xl">{money(total)}</b></div></div>
    <section className="mt-5 overflow-hidden rounded-2xl border bg-white"><div className="flex justify-between gap-3 border-b p-5"><h2 className="font-bold">Production Vouchers</h2><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search voucher / item" className="h-10 w-full max-w-sm rounded-xl border px-3 text-sm" /></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-5 py-3">Date</th><th className="px-5 py-3">Voucher</th><th className="px-5 py-3">Finished Item</th><th className="px-5 py-3">Qty</th><th className="px-5 py-3">Material</th><th className="px-5 py-3">Conversion Cost</th><th className="px-5 py-3">Total</th><th className="px-5 py-3">Unit Cost</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y">{filtered.map(row => <tr key={row.id} onClick={() => setSelected(row)} className="cursor-pointer hover:bg-slate-50"><td className="px-5 py-4">{row.date}</td><td className="px-5 py-4 font-semibold">{row.voucherNumber}</td><td className="px-5 py-4"><b>{row.itemName}</b><div className="text-xs text-slate-400">{row.itemId}</div></td><td className="px-5 py-4">{Number(row.quantity).toFixed(3)}</td><td className="px-5 py-4">{money(row.materialCost)}</td><td className="px-5 py-4">{money(Number(row.totalCost) - Number(row.materialCost))}</td><td className="px-5 py-4 font-semibold">{money(row.totalCost)}</td><td className="px-5 py-4">{money(row.unitCost)}</td><td className="px-5 py-4 capitalize">{row.status}</td></tr>)}</tbody></table></div></section>
    {selected && <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l bg-white p-6 shadow-2xl"><button type="button" onClick={() => setSelected(null)} className="float-right text-2xl">×</button><h2 className="text-2xl font-bold">{selected.voucherNumber}</h2><p className="text-sm text-slate-500">{selected.date} · {selected.itemName}</p><div className="mt-6 space-y-3 text-sm">{[["Material", selected.materialCost],["Labour", selected.labourCost],["Electricity", selected.electricityCost],["Machine", selected.machineCost],["Factory overhead", selected.overheadCost],["Other", selected.otherCost],["Total", selected.totalCost]].map(([label, value]) => <div key={String(label)} className="flex justify-between border-b pb-2"><span>{label}</span><b>{money(Number(value))}</b></div>)}</div><div className="mt-6 rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Finished quantity</p><b className="text-xl">{Number(selected.quantity).toFixed(3)}</b><p className="mt-3 text-xs text-slate-500">Unit cost</p><b className="text-xl">{money(selected.unitCost)}</b></div></aside>}
  </div></main></div></AuthGate>;
}
