"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { auth } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";

type Item = { id: string; name: string; code: string; itemType?: string; unit?: string; manufacturing?: ManufacturingConfig | null };
type BomRow = { itemId: string; quantity: string; scrapPercent: string; unitCost: string };
type CostRow = { type: string; name: string; amount: string; accountId: string };
type ManufacturingConfig = { enabled: boolean; bom: Array<{ itemId: string; quantity: number; scrapPercent?: number; unitCost?: number }>; batchQuantity: number; wastagePercent?: number; costComponents?: Array<{ type: string; name: string; amount: number; accountId?: string }>; costingMethod?: "standard" | "actual"; finishedGoodsAccountId?: string; wipAccountId?: string; manufacturingOverheadAccountId?: string };

const token = async () => { if (!auth.currentUser) throw new Error("Please sign in again."); return auth.currentUser.getIdToken(); };
const emptyConfig = (): ManufacturingConfig => ({ enabled: true, bom: [], batchQuantity: 1, wastagePercent: 0, costComponents: [], costingMethod: "actual" });

export default function ManufacturingSetupPage() {
  const { activeBusinessId, businessName, loading } = useBusiness();
  const [items, setItems] = useState<Item[]>([]);
  const [selected, setSelected] = useState("");
  const [config, setConfig] = useState<ManufacturingConfig>(emptyConfig());
  const [bom, setBom] = useState<BomRow[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadItems = async () => {
    if (!activeBusinessId) return;
    const t = await token();
    const response = await fetch(`/api/items?businessId=${activeBusinessId}`, { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load items.");
    setItems(data.items || []);
  };

  const loadConfig = async (itemId: string) => {
    if (!activeBusinessId || !itemId) { setConfig(emptyConfig()); setBom([]); setCosts([]); return; }
    const t = await token();
    const response = await fetch(`/api/items/manufacturing?businessId=${activeBusinessId}&itemId=${itemId}`, { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load manufacturing setup.");
    const next = data.manufacturing ? { ...emptyConfig(), ...data.manufacturing } : emptyConfig();
    setConfig(next);
    setBom((next.bom || []).map((row: any) => ({ itemId: row.itemId, quantity: String(row.quantity), scrapPercent: String(row.scrapPercent || 0), unitCost: row.unitCost === undefined ? "" : String(row.unitCost / 100) })));
    setCosts((next.costComponents || []).map((row: any) => ({ type: row.type, name: row.name, amount: String(Number(row.amount || 0) / 100), accountId: row.accountId || "" })));
  };

  useEffect(() => { if (!loading) void loadItems().catch(e => setError(e instanceof Error ? e.message : "Unable to load items.")); }, [activeBusinessId, loading]);
  useEffect(() => { void loadConfig(selected).catch(e => setError(e instanceof Error ? e.message : "Unable to load manufacturing setup.")); }, [selected]);

  const manufacturedCandidates = useMemo(() => items.filter(i => i.id !== selected && i.itemType !== "service"), [items, selected]);
  const batchCost = useMemo(() => {
    const material = bom.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (1 + (Number(row.scrapPercent) || 0) / 100) * (Number(row.unitCost) || 0) * (Number(config.batchQuantity) || 0), 0);
    const extras = costs.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
    return material + extras;
  }, [bom, costs, config.batchQuantity]);
  const output = (Number(config.batchQuantity) || 0) * (1 - (Number(config.wastagePercent) || 0) / 100);

  const save = async () => {
    if (!activeBusinessId || !selected) return;
    setSaving(true); setError(""); setMessage("");
    try {
      if (bom.length === 0) throw new Error("Add at least one raw-material BOM component.");
      if (bom.some(row => row.itemId === selected)) throw new Error("A manufactured item cannot be its own BOM component.");
      const next: ManufacturingConfig = {
        ...config,
        enabled: true,
        batchQuantity: Number(config.batchQuantity),
        wastagePercent: Number(config.wastagePercent || 0),
        bom: bom.map(row => ({ itemId: row.itemId, quantity: Number(row.quantity), scrapPercent: Number(row.scrapPercent || 0), ...(row.unitCost.trim() ? { unitCost: Math.round(Number(row.unitCost) * 100) } : {}) })),
        costComponents: costs.map(row => ({ type: row.type, name: row.name, amount: Math.round(Number(row.amount || 0) * 100), ...(row.accountId.trim() ? { accountId: row.accountId.trim() } : {}) })),
      };
      const t = await token();
      const response = await fetch("/api/items/manufacturing", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ businessId: activeBusinessId, itemId: selected, manufacturing: next }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save manufacturing setup.");
      setMessage("Manufacturing configuration saved successfully.");
      await loadItems();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save manufacturing setup."); }
    finally { setSaving(false); }
  };

  return <AuthGate><div className="flex min-h-screen bg-slate-50"><Sidebar /><main className="min-w-0 flex-1 px-4 pb-10 sm:px-8"><TopNav /><div className="mx-auto max-w-[1450px] py-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-indigo-600">{businessName || "Business"} · Inventory</p><h1 className="text-3xl font-bold text-slate-900">Manufacturing / BOM Setup</h1><p className="mt-1 text-sm text-slate-500">Define raw materials, scrap, batch yield and manufacturing costs for finished goods.</p></div><a href="/production" className="rounded-xl border bg-white px-4 py-2.5 text-sm font-semibold">Production Entry →</a></div>
    {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}{message && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}
    <div className="mt-6 rounded-2xl border bg-white p-6"><label className="block max-w-xl text-sm font-semibold">Finished / Manufactured Item<select value={selected} onChange={e => setSelected(e.target.value)} className="mt-2 h-11 w-full rounded-xl border px-3"><option value="">Select item</option>{items.filter(i => i.itemType !== "service").map(i => <option key={i.id} value={i.id}>{i.name} · {i.code}</option>)}</select></label></div>
    {selected && <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_.7fr]">
      <section className="rounded-2xl border bg-white p-6"><div className="flex items-center justify-between"><div><h2 className="font-bold">Bill of Materials</h2><p className="text-xs text-slate-500">Quantities are consumed per manufacturing batch; scrap is added to consumption.</p></div><button type="button" onClick={() => setBom([...bom, { itemId: manufacturedCandidates[0]?.id || "", quantity: "1", scrapPercent: "0", unitCost: "" }])} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">+ Component</button></div>
      <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Raw Material</th><th className="px-3 py-3">Qty</th><th className="px-3 py-3">Scrap %</th><th className="px-3 py-3">Standard Cost ₹</th><th></th></tr></thead><tbody className="divide-y">{bom.map((row, index) => <tr key={index}><td className="px-3 py-3"><select value={row.itemId} onChange={e => setBom(bom.map((x, i) => i === index ? { ...x, itemId: e.target.value } : x))} className="h-10 w-full rounded-lg border px-2"><option value="">Select material</option>{manufacturedCandidates.map(i => <option key={i.id} value={i.id}>{i.name} · {i.code}</option>)}</select></td><td className="px-3 py-3"><input value={row.quantity} onChange={e => setBom(bom.map((x, i) => i === index ? { ...x, quantity: e.target.value } : x))} type="number" min="0.000001" step="0.000001" className="h-10 w-28 rounded-lg border px-2" /></td><td className="px-3 py-3"><input value={row.scrapPercent} onChange={e => setBom(bom.map((x, i) => i === index ? { ...x, scrapPercent: e.target.value } : x))} type="number" min="0" max="100" step="0.01" className="h-10 w-24 rounded-lg border px-2" /></td><td className="px-3 py-3"><input value={row.unitCost} onChange={e => setBom(bom.map((x, i) => i === index ? { ...x, unitCost: e.target.value } : x))} type="number" min="0" step="0.01" placeholder="Auto" className="h-10 w-32 rounded-lg border px-2" /></td><td className="px-3 py-3"><button type="button" onClick={() => setBom(bom.filter((_, i) => i !== index))} className="text-red-600">Remove</button></td></tr>)}</tbody></table></div></section>
      <section className="rounded-2xl border bg-white p-6"><h2 className="font-bold">Yield & Costing</h2><div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-1"><label className="text-sm">Batch quantity<input value={config.batchQuantity} onChange={e => setConfig({ ...config, batchQuantity: Number(e.target.value) })} type="number" min="0.000001" step="0.000001" className="mt-1 h-11 w-full rounded-xl border px-3" /></label><label className="text-sm">Process wastage %<input value={config.wastagePercent || 0} onChange={e => setConfig({ ...config, wastagePercent: Number(e.target.value) })} type="number" min="0" max="99.99" step="0.01" className="mt-1 h-11 w-full rounded-xl border px-3" /></label><label className="text-sm">Costing method<select value={config.costingMethod || "actual"} onChange={e => setConfig({ ...config, costingMethod: e.target.value as "standard" | "actual" })} className="mt-1 h-11 w-full rounded-xl border px-3"><option value="actual">Actual</option><option value="standard">Standard</option></select></label></div><div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm"><div className="flex justify-between"><span>Expected output</span><b>{output.toFixed(4)}</b></div><div className="mt-2 flex justify-between"><span>Estimated batch cost</span><b>₹{(batchCost / 100).toFixed(2)}</b></div><div className="mt-2 flex justify-between"><span>Estimated unit cost</span><b>₹{output > 0 ? (batchCost / output / 100).toFixed(2) : "0.00"}</b></div></div></section>
      <section className="rounded-2xl border bg-white p-6 lg:col-span-2"><div className="flex items-center justify-between"><div><h2 className="font-bold">Labour / Electricity / Overhead / Other</h2><p className="text-xs text-slate-500">Amounts are per manufacturing batch and are capitalized into finished-goods cost.</p></div><button type="button" onClick={() => setCosts([...costs, { type: "labour", name: "", amount: "0", accountId: "" }])} className="rounded-xl border px-4 py-2 text-sm font-semibold">+ Cost Component</button></div><div className="mt-4 space-y-3">{costs.map((row, index) => <div key={index} className="grid gap-2 md:grid-cols-[180px_1fr_160px_1fr_auto]"><select value={row.type} onChange={e => setCosts(costs.map((x, i) => i === index ? { ...x, type: e.target.value } : x))} className="h-10 rounded-lg border px-2"><option value="labour">Labour</option><option value="electricity">Electricity</option><option value="machine">Machine</option><option value="overhead">Factory Overhead</option><option value="other">Other</option></select><input value={row.name} onChange={e => setCosts(costs.map((x, i) => i === index ? { ...x, name: e.target.value } : x))} placeholder="Component name" className="h-10 rounded-lg border px-3" /><input value={row.amount} onChange={e => setCosts(costs.map((x, i) => i === index ? { ...x, amount: e.target.value } : x))} type="number" min="0" step="0.01" placeholder="Amount ₹" className="h-10 rounded-lg border px-3" /><input value={row.accountId} onChange={e => setCosts(costs.map((x, i) => i === index ? { ...x, accountId: e.target.value } : x))} placeholder="WIP / source account ID" className="h-10 rounded-lg border px-3" /><button type="button" onClick={() => setCosts(costs.filter((_, i) => i !== index))} className="text-red-600">Remove</button></div>)}</div></section>
      <section className="rounded-2xl border bg-white p-6 lg:col-span-2"><h2 className="font-bold">Inventory Accounts</h2><div className="mt-4 grid gap-4 md:grid-cols-3"><label className="text-sm">Finished goods account ID<input value={config.finishedGoodsAccountId || ""} onChange={e => setConfig({ ...config, finishedGoodsAccountId: e.target.value })} className="mt-1 h-11 w-full rounded-xl border px-3" /></label><label className="text-sm">WIP account ID<input value={config.wipAccountId || ""} onChange={e => setConfig({ ...config, wipAccountId: e.target.value })} className="mt-1 h-11 w-full rounded-xl border px-3" /></label><label className="text-sm">Manufacturing overhead account ID<input value={config.manufacturingOverheadAccountId || ""} onChange={e => setConfig({ ...config, manufacturingOverheadAccountId: e.target.value })} className="mt-1 h-11 w-full rounded-xl border px-3" /></label></div><div className="mt-5 flex justify-end"><button type="button" onClick={save} disabled={saving} className="rounded-xl bg-indigo-600 px-6 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save Manufacturing Configuration"}</button></div></section>
    </div>}
  </div></main></div></AuthGate>;
}
