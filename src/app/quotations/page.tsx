"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, getDocs, serverTimestamp } from "firebase/firestore";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { firestoreDb } from "../../lib/firebase";
import { useBusiness } from "../../context/BusinessContext";

type Customer = { id: string; name?: string; status?: string };
type Item = { id: string; name?: string; unit?: string; salePrice?: number };
type Line = { itemId: string; name: string; unit: string; quantity: number; price: number };

const emptyLine: Line = { itemId: "", name: "", unit: "Piece", quantity: 1, price: 0 };
const money = (v: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(v);
const nextNumber = (count: number) => String(1001 + count);

export default function QuotationsPage() {
  const { activeBusinessId, loading: businessLoading } = useBusiness();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [number, setNumber] = useState("1001");
  const [customerId, setCustomerId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    if (businessLoading || !firestoreDb || !activeBusinessId) return;
    try {
      const ref = doc(firestoreDb, "businesses", activeBusinessId);
      const [c, i, q] = await Promise.all([getDocs(collection(ref, "customers")), getDocs(collection(ref, "items")), getDocs(collection(ref, "quotations"))]);
      setCustomers(c.docs.map(x => ({ id: x.id, ...x.data() })) as Customer[]);
      setItems(i.docs.map(x => ({ id: x.id, ...x.data() })) as Item[]);
      const loaded = q.docs.map(x => ({ id: x.id, ...x.data() }));
      setRows(loaded); setNumber(nextNumber(loaded.length));
    } catch (e) { console.error(e); setError("Could not load quotations."); }
  }
  useEffect(() => { load(); }, [activeBusinessId, businessLoading]);
  const total = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.price, 0), [lines]);
  const customer = customers.find(c => c.id === customerId);
  const updateLine = (idx: number, value: string) => setLines(cur => cur.map((l, i) => i !== idx ? l : (() => { const item = items.find(x => x.id === value); return { ...l, itemId: value, name: item?.name || "", unit: item?.unit || "Piece", price: Number(item?.salePrice || 0) }; })()));
  async function save() {
    if (!firestoreDb || !activeBusinessId || !number.trim() || !lines.some(l => l.itemId)) return setError("Enter a quotation number and add at least one item.");
    if (rows.some(r => String(r.quotationNumber) === number.trim())) return setError("Quotation number already exists in this business.");
    setSaving(true); setError("");
    try {
      const ref = doc(firestoreDb, "businesses", activeBusinessId);
      await addDoc(collection(ref, "quotations"), { quotationNumber: number.trim(), customerId: customerId || null, customerName: customer?.name || "Walk-in customer", validUntil, items: lines.filter(l => l.itemId), total, status: "Draft", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setShowForm(false); setLines([{ ...emptyLine }]); await load();
    } catch (e) { console.error(e); setError("Could not save quotation."); } finally { setSaving(false); }
  }
  return <AuthGate><div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar/><main className="min-w-0 flex-1 px-4 sm:px-6 lg:px-8"><TopNav/><div className="mx-auto max-w-[1450px] py-6"><header className="mb-7 flex items-end justify-between"><div><p className="text-sm font-semibold text-[#4f46e5]">Sales documents</p><h1 className="mt-1 text-3xl font-bold text-[#182230]">Quotations</h1><p className="mt-2 text-sm text-[#667085]">Prepare price offers before converting them into sales.</p></div><button onClick={()=>{setNumber(nextNumber(rows.length));setShowForm(true);setError("")}} className="rounded-xl bg-[#4f46e5] px-4 py-2.5 text-sm font-semibold text-white">+ New quotation</button></header>{error&&<div className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] p-3 text-sm text-[#b42318]">{error}</div>}<section className="overflow-hidden rounded-2xl border border-[#e7e5e4] bg-white"><div className="border-b border-[#eaecf0] p-5"><h2 className="font-bold text-[#182230]">Quotation list</h2></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-[#fbfaf9] text-xs uppercase text-[#667085]"><tr><th className="p-4">Number</th><th className="p-4">Customer</th><th className="p-4">Valid until</th><th className="p-4">Total</th><th className="p-4">Status</th></tr></thead><tbody className="divide-y divide-[#eaecf0]">{rows.map(r=><tr key={r.id}><td className="p-4 font-semibold">{r.quotationNumber}</td><td className="p-4">{r.customerName}</td><td className="p-4">{r.validUntil||"—"}</td><td className="p-4 font-semibold">{money(Number(r.total||0))}</td><td className="p-4"><span className="rounded-full bg-[#fff7e8] px-2.5 py-1 text-xs font-semibold text-[#b7791f]">{r.status||"Draft"}</span></td></tr>)}</tbody></table>{!rows.length&&<div className="p-16 text-center text-sm text-[#667085]">No quotations yet.</div>}</div></section></div></main></div>{showForm&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#182230]/45 p-4"><div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b p-5"><div><p className="text-sm font-semibold text-[#4f46e5]">New quotation</p><h2 className="text-xl font-bold">Quotation {number}</h2></div><button onClick={()=>setShowForm(false)} className="text-2xl text-[#667085]">×</button></header><div className="space-y-5 p-6"><div className="grid gap-4 md:grid-cols-3"><label className="text-sm font-semibold">Quotation number<input value={number} onChange={e=>setNumber(e.target.value.replace(/[^0-9]/g,""))} className="mt-2 h-11 w-full rounded-xl border px-3"/></label><label className="text-sm font-semibold">Customer<select value={customerId} onChange={e=>setCustomerId(e.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-white px-3"><option value="">Walk-in customer</option>{customers.filter(c=>(c.status||"Active")==="Active").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="text-sm font-semibold">Valid until<input type="date" value={validUntil} onChange={e=>setValidUntil(e.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3"/></label></div><div className="space-y-3">{lines.map((l,i)=><div key={i} className="grid gap-3 md:grid-cols-[1fr_100px_120px_120px]"><select value={l.itemId} onChange={e=>updateLine(i,e.target.value)} className="h-10 rounded-xl border bg-white px-3"><option value="">Select item</option>{items.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><input type="number" min="1" value={l.quantity} onChange={e=>setLines(cur=>cur.map((x,j)=>j===i?{...x,quantity:Number(e.target.value)||1}:x))} className="h-10 rounded-xl border px-3"/><input type="number" min="0" value={l.price} onChange={e=>setLines(cur=>cur.map((x,j)=>j===i?{...x,price:Number(e.target.value)||0}:x))} className="h-10 rounded-xl border px-3"/><div className="flex items-center font-semibold">{money(l.quantity*l.price)}</div></div>)}</div><button onClick={()=>setLines(cur=>[...cur,{...emptyLine}])} className="text-sm font-semibold text-[#4f46e5]">+ Add line</button><div className="flex justify-end gap-3 border-t pt-5"><button onClick={()=>setShowForm(false)} className="px-4 py-2 text-sm font-semibold text-[#667085]">Cancel</button><button onClick={save} disabled={saving} className="rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-semibold text-white">{saving?"Saving…":"Save quotation"}</button></div></div></div></div>}</AuthGate>;
}
