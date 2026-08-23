"use client";

import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { firestoreDb } from "../../lib/firebase";
import { useBusiness } from "../../context/BusinessContext";

type Item = { id: string; name?: string; code?: string; unit?: string; salePrice?: number; purchasePrice?: number; stock?: number; minStock?: number; location?: string; itemType?: string; status?: string };
type ItemForm = { name: string; code: string; unit: string; salePrice: string; purchasePrice: string; stock: string; minStock: string; location: string; itemType: string };
const blank: ItemForm = { name: "", code: "", unit: "Piece", salePrice: "", purchasePrice: "", stock: "", minStock: "", location: "", itemType: "Product" };
const icon = { search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>, plus: <path d="M12 5v14M5 12h14" />, box: <><path d="m4 8 8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8M12 12v8" /></>, close: <path d="m6 6 12 12M18 6 6 18" /> };
function Icon({ name }: { name: keyof typeof icon }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon[name]}</svg>; }
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);

export default function ItemsPage() {
  const { activeBusinessId, loading: businessLoading } = useBusiness();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState<Item | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All items");
  const [form, setForm] = useState<ItemForm>(blank);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentMode, setAdjustmentMode] = useState<"add" | "remove">("add");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const itemCollection = activeBusinessId && firestoreDb ? collection(firestoreDb, "businesses", activeBusinessId, "items") : null;

  useEffect(() => {
    async function load() {
      if (businessLoading) return;
      if (!firestoreDb) { setError("Firebase is not configured. Check your .env.local file."); setLoading(false); return; }
      if (!activeBusinessId) { setItems([]); setSelected(null); setLoading(false); return; }
      setLoading(true); setError("");
      try {
        const snapshot = await getDocs(collection(firestoreDb, "businesses", activeBusinessId, "items"));
        setItems(snapshot.docs.map((record) => ({ id: record.id, ...record.data() })) as Item[]);
        setSelected(null);
      } catch (reason) { console.error(reason); setError("Could not load inventory. Check Firestore rules and your business membership."); }
      finally { setLoading(false); }
    }
    load();
  }, [activeBusinessId, businessLoading]);

  const filtered = useMemo(() => items.filter((item) => {
    const lowStock = Number(item.stock || 0) <= Number(item.minStock || 0);
    const matches = `${item.name || ""} ${item.code || ""}`.toLowerCase().includes(query.toLowerCase());
    return matches && (filter === "All items" || (filter === "Low stock" && lowStock) || (filter === "Out of stock" && !Number(item.stock || 0)));
  }), [filter, items, query]);

  const totals = useMemo(() => ({ total: items.length, low: items.filter((i) => Number(i.stock || 0) <= Number(i.minStock || 0)).length, empty: items.filter((i) => !Number(i.stock || 0)).length, value: items.reduce((s, i) => s + Number(i.stock || 0) * Number(i.purchasePrice || 0), 0) }), [items]);
  const update = (field: keyof ItemForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((current) => ({ ...current, [field]: event.target.value }));
  const openCreate = () => { setEditing(null); setForm(blank); setShowForm(true); setError(""); };
  const openEdit = () => {
    if (!selected) return;
    setEditing(selected);
    setForm({ name: selected.name || "", code: selected.code || "", unit: selected.unit || "Piece", salePrice: String(selected.salePrice || ""), purchasePrice: String(selected.purchasePrice || ""), stock: String(selected.stock || 0), minStock: String(selected.minStock || 0), location: selected.location || "", itemType: selected.itemType || "Product" });
    setShowForm(true);
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firestoreDb || !activeBusinessId || !itemCollection) { setError("Select a business before saving an item."); return; }
    setSaving(true); setError("");
    try {
      const record = { ...form, stock: Number(form.stock) || 0, minStock: Number(form.minStock) || 0, salePrice: Number(form.salePrice) || 0, purchasePrice: Number(form.purchasePrice) || 0, status: "Active", updatedAt: serverTimestamp(), ...(editing ? {} : { createdAt: serverTimestamp() }) };
      if (editing) {
        await updateDoc(doc(firestoreDb, "businesses", activeBusinessId, "items", editing.id), record);
        const next = { ...editing, ...record } as Item;
        setItems((current) => current.map((i) => i.id === editing.id ? next : i)); setSelected(next);
      } else {
        const saved = await addDoc(itemCollection, record);
        const next = { ...record, id: saved.id } as Item;
        setItems((current) => [next, ...current]); setSelected(next);
      }
      setShowForm(false); setEditing(null);
    } catch (reason) { console.error(reason); setError("Could not save item. Check Firestore rules and try again."); }
    finally { setSaving(false); }
  }

  async function remove() {
    if (!firestoreDb || !activeBusinessId || !selected || !window.confirm(`Delete ${selected.name || "this item"}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(firestoreDb, "businesses", activeBusinessId, "items", selected.id));
      setItems((current) => current.filter((i) => i.id !== selected.id)); setSelected(null);
    } catch (reason) { console.error(reason); setError("Could not delete item. Check your permissions and try again."); }
  }

  async function saveAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!firestoreDb || !activeBusinessId || !selected) return;
    const amount = Number(adjustmentAmount);
    if (!amount || amount < 0) return;
    const stock = Math.max(0, Number(selected.stock || 0) + (adjustmentMode === "add" ? amount : -amount));
    try {
      await updateDoc(doc(firestoreDb, "businesses", activeBusinessId, "items", selected.id), { stock, updatedAt: serverTimestamp() });
      const next = { ...selected, stock };
      setItems((current) => current.map((i) => i.id === next.id ? next : i)); setSelected(next); setAdjustmentAmount(""); setAdjusting(false);
    } catch (reason) { console.error(reason); setError("Could not adjust item quantity."); }
  }

  const status = (item: Item) => !Number(item.stock || 0) ? ["Out of stock", "bg-[#fff1ed] text-[#d45c3c]"] : Number(item.stock || 0) <= Number(item.minStock || 0) ? ["Low stock", "bg-[#fff7e8] text-[#b7791f]"] : ["In stock", "bg-[#e8f8f1] text-[#168361]"];

  return <AuthGate><div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar /><main className="min-w-0 flex-1 px-4 pb-10 pt-0 sm:px-6 lg:px-8"><TopNav /><div className="mx-auto max-w-[1450px]">
    <section className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="text-sm font-semibold text-[#4f46e5]">Inventory control</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#182230]">Items</h1><p className="mt-2 max-w-xl text-sm text-[#667085]">Keep your stock, pricing, and reorder levels in one clear workspace.</p></div><button type="button" onClick={openCreate} disabled={!activeBusinessId} className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#4f46e5] px-4 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,.22)] disabled:opacity-50"><span className="h-4 w-4"><Icon name="plus" /></span>New item</button></section>
    {error && <div role="alert" className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
    <section className="mb-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[[String(totals.total),"Total items","Across your catalogue","text-[#4f46e5]"],[String(totals.low),"Low stock","Needs a reorder soon","text-[#b7791f]"],[String(totals.empty),"Out of stock","Unavailable to sell","text-[#d45c3c]"],[money(totals.value),"Inventory value","At purchase cost","text-[#168361]"]].map(([value,label,note,tone])=><article key={label} className="rounded-2xl border border-[#e7e5e4] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]"><p className="text-sm font-medium text-[#667085]">{label}</p><p className={`mt-3 text-2xl font-bold tracking-tight ${tone}`}>{value}</p><p className="mt-1 text-xs text-[#98a2b3]">{note}</p></article>)}</section>
    <section className="overflow-hidden rounded-2xl border border-[#e7e5e4] bg-white shadow-[0_3px_10px_rgba(16,24,40,.04)]"><div className="flex flex-col justify-between gap-4 border-b border-[#eaecf0] p-5 lg:flex-row lg:items-center"><div><h2 className="font-bold text-[#182230]">Catalogue</h2><p className="mt-1 text-sm text-[#667085]">{filtered.length} item{filtered.length===1?"":"s"} shown</p></div><div className="flex flex-col gap-3 sm:flex-row"><label className="relative"><span className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98a2b3]"><Icon name="search" /></span><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search items or SKU" className="h-10 w-full rounded-xl border border-[#d0d5dd] pl-9 pr-3 text-sm outline-none focus:border-[#4f46e5] sm:w-60" /></label><select value={filter} onChange={(e)=>setFilter(e.target.value)} className="h-10 rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm"><option>All items</option><option>Low stock</option><option>Out of stock</option></select></div></div>
      {businessLoading||loading?<p className="p-16 text-center text-sm text-[#667085]">Loading inventory…</p>:!activeBusinessId?<div className="flex min-h-80 flex-col items-center justify-center p-10 text-center"><h3 className="font-bold text-[#182230]">Select a business first</h3><p className="mt-2 text-sm text-[#667085]">Choose an active business from the top navigation.</p></div>:filtered.length===0?<div className="flex min-h-80 flex-col items-center justify-center p-10 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eeedff] text-[#4f46e5]"><span className="h-7 w-7"><Icon name="box" /></span></div><h3 className="mt-4 font-bold text-[#182230]">Your inventory is ready for its first item</h3><p className="mt-2 text-sm text-[#667085]">Create an item to track price, location and stock.</p><button type="button" onClick={openCreate} className="mt-5 text-sm font-bold text-[#4f46e5]">Create item</button></div>:<div className="overflow-x-auto"><table className="min-w-[860px] w-full text-left"><thead className="bg-[#fbfaf9] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr>{["Item","Unit","Stock","Cost","Sale price","Status",""].map(h=><th key={h} className="px-5 py-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-[#eaecf0]">{filtered.map(item=>{const [label,tone]=status(item);return <tr key={item.id} onClick={()=>setSelected(item)} className="cursor-pointer transition hover:bg-[#fafafa]"><td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eeedff] text-[#4f46e5]"><span className="h-5 w-5"><Icon name="box" /></span></span><span><span className="block font-semibold text-[#182230]">{item.name||"Unnamed item"}</span><span className="mt-0.5 block text-xs text-[#98a2b3]">SKU: {item.code||"—"}</span></span></div></td><td className="px-5 py-4 text-sm text-[#667085]">{item.unit||"Piece"}</td><td className="px-5 py-4 text-sm font-semibold text-[#475467]">{Number(item.stock||0)} <span className="text-xs text-[#98a2b3]">/ min {Number(item.minStock||0)}</span></td><td className="px-5 py-4 text-sm text-[#475467]">{money(Number(item.purchasePrice||0))}</td><td className="px-5 py-4 text-sm font-semibold text-[#182230]">{money(Number(item.salePrice||0))}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{label}</span></td><td className="px-5 py-4 text-right text-[#98a2b3]">›</td></tr>})}</tbody></table></div>}
    </section></div></main></div>
    {selected&&<aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[#e4e7ec] bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-[#eaecf0] p-6"><div><p className="text-sm font-semibold text-[#4f46e5]">Item details</p><h2 className="mt-1 text-xl font-bold text-[#182230]">{selected.name}</h2><p className="mt-1 text-sm text-[#667085]">SKU: {selected.code||"Not assigned"}</p></div><button onClick={()=>setSelected(null)} className="rounded-lg p-2 text-[#667085] hover:bg-[#f2f4f7]" aria-label="Close item details"><span className="h-5 w-5 block"><Icon name="close" /></span></button></header><div className="flex-1 overflow-y-auto p-6"><div className="grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#f6f5ff] p-4"><p className="text-xs text-[#667085]">AVAILABLE</p><p className="mt-2 text-2xl font-bold text-[#4f46e5]">{selected.stock||0} {selected.unit||"units"}</p></div><div className="rounded-xl bg-[#ecfaf4] p-4"><p className="text-xs text-[#667085]">STOCK VALUE</p><p className="mt-2 text-xl font-bold text-[#168361]">{money(Number(selected.stock||0)*Number(selected.purchasePrice||0))}</p></div></div><dl className="mt-6 divide-y rounded-xl border border-[#eaecf0] text-sm"><div className="flex justify-between p-3"><dt>Sell price</dt><dd>{money(Number(selected.salePrice||0))}</dd></div><div className="flex justify-between p-3"><dt>Purchase cost</dt><dd>{money(Number(selected.purchasePrice||0))}</dd></div><div className="flex justify-between p-3"><dt>Location</dt><dd>{selected.location||"—"}</dd></div></dl></div><footer className="space-y-3 border-t border-[#eaecf0] p-5"><button onClick={()=>setAdjusting(true)} className="w-full rounded-xl bg-[#4f46e5] py-3 text-sm font-semibold text-white">Adjust quantity</button><div className="grid grid-cols-2 gap-3"><button onClick={openEdit} className="rounded-xl border border-[#d0d5dd] py-2.5 text-sm font-semibold text-[#344054]">Modify item</button><button onClick={remove} className="rounded-xl border border-[#f7c8bc] py-2.5 text-sm font-semibold text-[#c13c25]">Delete item</button></div></footer></aside>}
    {showForm&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#182230]/45 p-4"><form onSubmit={save} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b border-[#eaecf0] px-6 py-4"><div><p className="text-sm font-semibold text-[#4f46e5]">{editing?"Edit catalogue item":"New catalogue item"}</p><h2 className="mt-1 text-xl font-bold text-[#182230]">{editing?"Modify item":"Create an item"}</h2></div><button type="button" onClick={()=>setShowForm(false)} className="rounded-lg p-2 text-[#667085]"><span className="h-5 w-5 block"><Icon name="close" /></span></button></header><div className="grid gap-5 overflow-y-auto p-6 sm:grid-cols-2"><label className="sm:col-span-2 text-sm font-semibold text-[#344054]">Item name<input required value={form.name} onChange={update("name")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal" /></label><label className="text-sm font-semibold text-[#344054]">SKU / item code<input value={form.code} onChange={update("code")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal" /></label><label className="text-sm font-semibold text-[#344054]">Unit<select value={form.unit} onChange={update("unit")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal"><option>Piece</option><option>Box</option><option>Kg</option><option>Litre</option></select></label><label className="text-sm font-semibold text-[#344054]">Item type<select value={form.itemType} onChange={update("itemType")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal"><option>Product</option><option>Service</option></select></label><label className="text-sm font-semibold text-[#344054]">Location<input value={form.location} onChange={update("location")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal" /></label><label className="text-sm font-semibold text-[#344054]">Selling price<input type="number" min="0" value={form.salePrice} onChange={update("salePrice")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal" /></label><label className="text-sm font-semibold text-[#344054]">Purchase cost<input type="number" min="0" value={form.purchasePrice} onChange={update("purchasePrice")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal" /></label><label className="text-sm font-semibold text-[#344054]">{editing?"Current stock":"Opening stock"}<input type="number" min="0" value={form.stock} onChange={update("stock")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal" /></label><label className="text-sm font-semibold text-[#344054]">Reorder level<input type="number" min="0" value={form.minStock} onChange={update("minStock")} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal" /></label></div><footer className="flex justify-end gap-3 border-t border-[#eaecf0] px-6 py-4"><button type="button" onClick={()=>setShowForm(false)} className="rounded-xl border border-[#d0d5dd] px-4 py-2.5 text-sm font-semibold">Cancel</button><button disabled={saving} type="submit" className="rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-semibold text-white">{saving?"Saving…":editing?"Save changes":"Save item"}</button></footer></form></div>}
    {adjusting&&selected&&<div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#182230]/45 p-4"><form onSubmit={saveAdjustment} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-sm font-semibold text-[#4f46e5]">Stock control</p><h2 className="mt-1 text-xl font-bold text-[#182230]">Adjust quantity</h2><p className="mt-2 text-sm text-[#667085]">Current: {Number(selected.stock||0)} {selected.unit||"units"}</p></div><button type="button" onClick={()=>setAdjusting(false)} className="rounded-lg p-2 text-[#667085]" aria-label="Close adjustment">×</button></div><div className="mt-6 flex rounded-xl bg-[#f4f3f1] p-1"><button type="button" onClick={()=>setAdjustmentMode("add")} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${adjustmentMode==="add"?"bg-white text-[#4f46e5] shadow-sm":"text-[#667085]"}`}>Add stock</button><button type="button" onClick={()=>setAdjustmentMode("remove")} className={`flex-1 rounded-lg py-2 text-sm font-semibold ${adjustmentMode==="remove"?"bg-white text-[#c13c25] shadow-sm":"text-[#667085]"}`}>Remove stock</button></div><label className="mt-5 block text-sm font-semibold text-[#344054]">Quantity<input required min="1" type="number" value={adjustmentAmount} onChange={(e)=>setAdjustmentAmount(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal" /></label><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={()=>setAdjusting(false)} className="px-4 text-sm font-semibold text-[#667085]">Cancel</button><button type="submit" className="rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-semibold text-white">Save adjustment</button></div></form></div>}
  </AuthGate>;
}
