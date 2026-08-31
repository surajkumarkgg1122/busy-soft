"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { auth } from "../../lib/firebase";
import { useBusiness } from "../../context/BusinessContext";

type Party = {
  id: string; partyCode: string; name: string; kind: "customer" | "supplier"; phone: string; email: string;
  address: { line1: string; city: string; district?: string; state: string; pincode: string; country: string };
  gst: { type: "regular" | "composition" | "unregistered" | "other"; gstin?: string };
  openingBalance: number; openingBalanceType: "debit" | "credit"; creditLimit: number;
  status: "active" | "inactive"; ledgerAccountId: string; createdAt: string; updatedAt: string;
};

type Form = {
  name: string; phone: string; email: string; line1: string; city: string; district: string; state: string; pincode: string;
  gstType: Party["gst"]["type"]; gstin: string; creditLimit: string; openingBalance: string; openingBalanceType: "debit" | "credit";
};

const EMPTY_FORM: Form = { name:"", phone:"", email:"", line1:"", city:"", district:"", state:"", pincode:"", gstType:"unregistered", gstin:"", creditLimit:"", openingBalance:"", openingBalanceType:"debit" };
const STATES = ["Andaman and Nicobar Islands","Andhra Pradesh","Arunachal Pradesh","Assam","Bihar","Chandigarh","Chhattisgarh","Dadra and Nagar Haveli and Daman and Diu","Delhi","Goa","Gujarat","Haryana","Himachal Pradesh","Jammu and Kashmir","Jharkhand","Karnataka","Kerala","Ladakh","Lakshadweep","Madhya Pradesh","Maharashtra","Manipur","Meghalaya","Mizoram","Nagaland","Odisha","Puducherry","Punjab","Rajasthan","Sikkim","Tamil Nadu","Telangana","Tripura","Uttar Pradesh","Uttarakhand","West Bengal"];
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:2 }).format(Number(paise || 0) / 100);

async function getToken() {
  if (!auth?.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser.getIdToken();
}

export default function CustomersPage() {
  const { activeBusinessId, loading: businessLoading } = useBusiness();
  const [customers, setCustomers] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Party | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const requestKey = useRef<string | null>(null);

  async function loadCustomers() {
    if (!activeBusinessId) { setCustomers([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const token = await getToken();
      const response = await fetch(`/api/parties?businessId=${encodeURIComponent(activeBusinessId)}&kind=customer`, { headers:{ Authorization:`Bearer ${token}` }, cache:"no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not load customers.");
      setCustomers(body.parties || []);
    } catch (err) { console.error(err); setError(err instanceof Error ? err.message : "Could not load customers."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadCustomers(); }, [activeBusinessId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? customers.filter(p => [p.name,p.partyCode,p.phone,p.email].join(" ").toLowerCase().includes(needle)) : customers;
  }, [customers, query]);
  const selected = selectedId ? customers.find(p => p.id === selectedId) || null : null;
  const totals = useMemo(() => ({ total:customers.length, active:customers.filter(p=>p.status==="active").length, opening:customers.reduce((sum,p)=>sum + (p.openingBalanceType==="debit" ? p.openingBalance : -p.openingBalance),0) }), [customers]);

  function openAdd() { setEditing(null); setForm(EMPTY_FORM); setError(""); setShowForm(true); requestKey.current = `party-create-${crypto.randomUUID()}`; }
  function openEdit(p: Party) {
    setEditing(p); setError(""); setShowForm(true); requestKey.current = `party-edit-${p.id}-${crypto.randomUUID()}`;
    setForm({ name:p.name||"", phone:p.phone||"", email:p.email||"", line1:p.address?.line1||"", city:p.address?.city||"", district:p.address?.district||"", state:p.address?.state||"", pincode:p.address?.pincode||"", gstType:p.gst?.type||"unregistered", gstin:p.gst?.gstin||"", creditLimit:String((p.creditLimit||0)/100), openingBalance:String((p.openingBalance||0)/100), openingBalanceType:p.openingBalanceType||"debit" });
  }
  function update(field:keyof Form,value:string){ setForm(current=>({...current,[field]:value})); }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!activeBusinessId) return setError("Select a business first.");
    if (!form.name.trim()) return setError("Customer name is required.");
    if (!form.city.trim() || !form.state) return setError("City and state are required.");
    if (!/^[1-9]\d{5}$/.test(form.pincode.trim())) return setError("Enter a valid 6-digit pincode.");
    if ((form.gstType==="regular" || form.gstType==="composition") && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(form.gstin.trim().toUpperCase())) return setError("Enter a valid GSTIN.");
    const opening=Number(form.openingBalance||0), creditLimit=Number(form.creditLimit||0);
    if (!Number.isSafeInteger(Math.round(opening*100)) || opening<0) return setError("Opening balance must be a valid amount.");
    if (!Number.isSafeInteger(Math.round(creditLimit*100)) || creditLimit<0) return setError("Credit limit must be a valid amount.");
    setSaving(true); setError("");
    try {
      const token=await getToken();
      const input=editing ? { id:editing.id, partyCode:editing.partyCode, name:form.name.trim(), phone:form.phone.trim(), email:form.email.trim(), address:{line1:form.line1.trim(),city:form.city.trim(),district:form.district.trim(),state:form.state,pincode:form.pincode.trim(),country:"India"}, gst:{type:form.gstType,...(form.gstin.trim()?{gstin:form.gstin.trim().toUpperCase()}: {})}, creditLimit:Math.round(creditLimit*100), openingBalance:editing.openingBalance, openingBalanceType:editing.openingBalanceType, ledgerAccountId:editing.ledgerAccountId, status:editing.status } : { name:form.name.trim(), phone:form.phone.trim(), email:form.email.trim(), address:{line1:form.line1.trim(),city:form.city.trim(),district:form.district.trim(),state:form.state,pincode:form.pincode.trim(),country:"India"}, gst:{type:form.gstType,...(form.gstin.trim()?{gstin:form.gstin.trim().toUpperCase()}: {})}, creditLimit:Math.round(creditLimit*100), openingBalance:Math.round(opening*100), openingBalanceType:form.openingBalanceType };
      const response=await fetch("/api/parties",{method:editing?"PATCH":"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({businessId:activeBusinessId,kind:"customer",idempotencyKey:requestKey.current||`party-${crypto.randomUUID()}`,input})});
      const body=await response.json(); if(!response.ok) throw new Error(body.error||"Could not save customer.");
      setShowForm(false); setEditing(null); requestKey.current=null; await loadCustomers(); setSelectedId(body.party?.id || selectedId);
    } catch(err){console.error(err);setError(err instanceof Error?err.message:"Could not save customer.");} finally{setSaving(false);}
  }

  async function toggleStatus() {
    if(!selected||!activeBusinessId||busy)return; setBusy(true); setError("");
    try{const token=await getToken();const response=await fetch("/api/parties",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({businessId:activeBusinessId,kind:"customer",idempotencyKey:`party-status-${selected.id}-${crypto.randomUUID()}`,input:{...selected,status:selected.status==="active"?"inactive":"active"}})});const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not update status.");await loadCustomers();}
    catch(err){console.error(err);setError(err instanceof Error?err.message:"Could not update status.");}finally{setBusy(false);}
  }

  return <AuthGate><div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar/><main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8"><TopNav/><div className="mx-auto max-w-[1450px]">
    <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="text-sm font-semibold text-[#4f46e5]">Party management</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#182230]">Customers</h1><p className="mt-2 max-w-xl text-sm text-[#667085]">Customer masters are managed through the accounting service and isolated to the active business.</p></div><button type="button" onClick={openAdd} disabled={!activeBusinessId} className="h-10 rounded-xl bg-[#4f46e5] px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-50">Add customer</button></section>
    {error&&<div role="alert" className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
    <section className="mb-6 grid gap-4 sm:grid-cols-3"><article className="rounded-2xl border border-[#e7e5e4] bg-white p-5"><p className="text-sm text-[#667085]">Total customers</p><p className="mt-2 text-2xl font-bold text-[#182230]">{totals.total}</p></article><article className="rounded-2xl border border-[#e7e5e4] bg-white p-5"><p className="text-sm text-[#667085]">Active customers</p><p className="mt-2 text-2xl font-bold text-[#168361]">{totals.active}</p></article><article className="rounded-2xl border border-[#e7e5e4] bg-white p-5"><p className="text-sm text-[#667085]">Opening net balance</p><p className="mt-2 text-2xl font-bold text-[#b7791f]">{money(Math.abs(totals.opening))}</p></article></section>
    <section className="overflow-hidden rounded-2xl border border-[#e7e5e4] bg-white shadow-sm"><div className="flex flex-col justify-between gap-4 border-b border-[#eaecf0] p-5 lg:flex-row lg:items-center"><div><h2 className="font-bold text-[#182230]">Customer list</h2><p className="mt-1 text-sm text-[#667085]">{filtered.length} customer{filtered.length===1?"":"s"} shown</p></div><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search name, code, phone or email" className="h-10 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm outline-none sm:w-80"/></div>{businessLoading||loading?<div className="p-16 text-center text-sm text-[#667085]">Loading customers…</div>:!activeBusinessId?<div className="p-16 text-center text-sm text-[#667085]">Select a business first.</div>:customers.length===0?<div className="p-16 text-center"><p className="font-semibold text-[#182230]">No customers yet</p><p className="mt-2 text-sm text-[#667085]">Create your first customer to start party-wise accounting.</p></div>:filtered.length===0?<div className="p-16 text-center text-sm text-[#667085]">No customer matches your search.</div>:<div className="overflow-x-auto"><table className="min-w-[900px] w-full text-left"><thead className="bg-[#fbfaf9] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Phone</th><th className="px-5 py-3">GST</th><th className="px-5 py-3">Opening</th><th className="px-5 py-3">Credit limit</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#eaecf0]">{filtered.map(p=><tr key={p.id} onClick={()=>setSelectedId(p.id)} className={`cursor-pointer hover:bg-[#fafafa] ${selectedId===p.id?"bg-[#f8f7ff]":""}`}><td className="px-5 py-4"><p className="font-semibold text-[#182230]">{p.name}</p><p className="mt-1 text-xs text-[#98a2b3]">{p.partyCode}</p></td><td className="px-5 py-4 text-sm text-[#475467]">{p.phone||"—"}</td><td className="px-5 py-4 text-sm text-[#475467]">{p.gst?.type}{p.gst?.gstin?<span className="ml-2 text-xs">{p.gst.gstin}</span>:null}</td><td className="px-5 py-4 text-sm font-medium text-[#344054]">{money(p.openingBalance)} {p.openingBalanceType}</td><td className="px-5 py-4 text-sm text-[#344054]">{money(p.creditLimit)}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.status==="active"?"bg-[#ecfdf3] text-[#027a48]":"bg-[#f2f4f7] text-[#667085]"}`}>{p.status}</span></td></tr>)}</tbody></table></div>}</section>
    {selected&&<section className="mt-5 rounded-2xl border border-[#e7e5e4] bg-white p-5"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-xs font-semibold uppercase tracking-wide text-[#98a2b3]">Selected customer</p><h3 className="mt-1 text-xl font-bold text-[#182230]">{selected.name}</h3><p className="mt-1 text-sm text-[#667085]">{selected.partyCode} · Ledger {selected.ledgerAccountId}</p></div><div className="flex gap-2"><button type="button" onClick={()=>openEdit(selected)} className="rounded-xl border border-[#d0d5dd] px-4 py-2 text-sm font-semibold text-[#344054]">Edit</button><button type="button" disabled={busy} onClick={toggleStatus} className="rounded-xl border border-[#d0d5dd] px-4 py-2 text-sm font-semibold text-[#344054]">{selected.status==="active"?"Deactivate":"Activate"}</button></div></div></section>}
    {showForm&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-[#182230]">{editing?"Edit customer":"Add customer"}</h2><p className="mt-1 text-sm text-[#667085]">Validated by the accounting service.</p></div><button type="button" onClick={()=>setShowForm(false)} className="text-sm text-[#667085]">Close</button></div><form onSubmit={save} className="mt-6 space-y-5">
      <div><label className="text-sm font-semibold text-[#344054]">Customer name</label><input required value={form.name} onChange={e=>update("name",e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><label className="text-sm font-semibold text-[#344054]">Phone</label><input value={form.phone} onChange={e=>update("phone",e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div><div><label className="text-sm font-semibold text-[#344054]">Email</label><input type="email" value={form.email} onChange={e=>update("email",e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div></div>
      <div><label className="text-sm font-semibold text-[#344054]">Address</label><input value={form.line1} onChange={e=>update("line1",e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><label className="text-sm font-semibold text-[#344054]">City</label><input required value={form.city} onChange={e=>update("city",e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div><div><label className="text-sm font-semibold text-[#344054]">District</label><input value={form.district} onChange={e=>update("district",e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div><label className="text-sm font-semibold text-[#344054]">State</label><select required value={form.state} onChange={e=>update("state",e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm"><option value="">Select state / UT</option>{STATES.map(s=><option key={s}>{s}</option>)}</select></div><div><label className="text-sm font-semibold text-[#344054]">Pincode</label><input required inputMode="numeric" maxLength={6} value={form.pincode} onChange={e=>update("pincode",e.target.value.replace(/\D/g,"").slice(0,6))} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div></div>
      <div className="rounded-xl border border-[#e4e7ec] bg-[#f9fafb] p-4"><label className="text-sm font-semibold text-[#344054]">GST registration type</label><select value={form.gstType} onChange={e=>{const v=e.target.value as Form["gstType"];update("gstType",v);if(v==="unregistered"||v==="other")update("gstin","")}} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm"><option value="unregistered">Not registered</option><option value="regular">Regular taxpayer</option><option value="composition">Composition taxpayer</option><option value="other">Other</option></select>{(form.gstType==="regular"||form.gstType==="composition")&&<input value={form.gstin} maxLength={15} onChange={e=>update("gstin",e.target.value.toUpperCase().slice(0,15))} placeholder="GSTIN" className="mt-3 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm uppercase"/>}</div>
      {!editing&&<div className="grid gap-4 sm:grid-cols-2"><div><label className="text-sm font-semibold text-[#344054]">Opening balance (₹)</label><input inputMode="decimal" value={form.openingBalance} onChange={e=>update("openingBalance",e.target.value)} placeholder="0" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div><div><label className="text-sm font-semibold text-[#344054]">Opening side</label><select value={form.openingBalanceType} onChange={e=>update("openingBalanceType",e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 text-sm"><option value="debit">Debit</option><option value="credit">Credit</option></select></div></div>}
      <div><label className="text-sm font-semibold text-[#344054]">Credit limit (₹)</label><input inputMode="decimal" value={form.creditLimit} onChange={e=>update("creditLimit",e.target.value)} placeholder="0" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 text-sm"/></div>
      {error&&<div role="alert" className="rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
      <div className="flex justify-end gap-3"><button type="button" onClick={()=>setShowForm(false)} className="rounded-xl border border-[#d0d5dd] px-4 py-2 text-sm font-semibold text-[#344054]">Cancel</button><button type="submit" disabled={saving} className="rounded-xl bg-[#4f46e5] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">{saving?"Saving…":editing?"Save changes":"Create customer"}</button></div>
    </form></div></div>}
  </div></main></div></AuthGate>;
}
