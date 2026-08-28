"use client";

import { useState } from "react";
import { useBusiness } from "../../../context/BusinessContext";

export default function BusinessSelector() {
  const { activeBusiness, memberships, loading, selectBusiness, createBusiness } = useBusiness();
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (loading) return <div className="h-9 w-44 animate-pulse rounded-lg bg-[#f2f4f7]" aria-hidden="true" />;

  const owned = memberships.filter((m) => ["owner", "admin"].includes(String(m.role).toLowerCase()));
  const joined = memberships.filter((m) => !["owner", "admin"].includes(String(m.role).toLowerCase()));

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    setSaving(true); setError("");
    try { await createBusiness({ name: name.trim() }); setName(""); setShowCreate(false); setOpen(false); }
    catch (e) { console.error(e); setError("Could not create the business. Please try again."); }
    finally { setSaving(false); }
  }

  const renderGroup = (title: string, list: typeof memberships) => list.length > 0 && (
    <div className="mb-2">
      <p className="px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#98a2b3]">{title}</p>
      {list.map((membership) => {
        const id = membership.business.businessId;
        const active = id === activeBusiness?.business.businessId;
        return <button key={id} type="button" onClick={() => { selectBusiness(id); setOpen(false); }} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${active ? "bg-[#f2f4ff]" : "hover:bg-[#f9fafb]"}`}>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#edf2ff] text-xs font-bold text-[#465fff]">{membership.business.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#344054]">{membership.business.name}</span><span className="block text-[11px] capitalize text-[#98a2b3]">{membership.role}</span></span>
          {active && <span className="text-xs font-bold text-[#465fff]">✓</span>}
        </button>;
      })}
    </div>
  );

  return <div className="relative">
    <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-9 min-w-40 max-w-56 items-center gap-2 rounded-lg border border-[#e4e7ec] bg-white px-3 text-left hover:bg-[#f9fafb]" aria-expanded={open} aria-haspopup="menu">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#fff4d6] text-[11px] font-bold text-[#9a6700]">{(activeBusiness?.business.name || "B").slice(0, 1).toUpperCase()}</span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-[#344054]">{activeBusiness?.business.name || "Select business"}</span><span className="block text-[10px] capitalize text-[#98a2b3]">{activeBusiness?.role || ""}</span></span>
      <svg className={`h-4 w-4 text-[#98a2b3] transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div className="absolute right-0 top-11 z-40 w-80 rounded-xl border border-[#e4e7ec] bg-white p-2 shadow-xl">
      <div className="px-2 pb-2 pt-1"><p className="text-xs font-bold text-[#344054]">Switch business</p><p className="mt-0.5 text-[11px] text-[#98a2b3]">Choose which business workspace you are using.</p></div>
      <div className="max-h-72 overflow-y-auto">{renderGroup("My businesses", owned)}{renderGroup("Joined businesses", joined)}{memberships.length === 0 && <p className="p-3 text-sm text-[#667085]">No businesses available.</p>}</div>
      <div className="my-2 border-t border-[#f0f2f5]" />
      <button type="button" onClick={() => setShowCreate((v) => !v)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-[#465fff] hover:bg-[#f7f8ff]"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-[#edf2ff]">+</span>Create new business</button>
      {showCreate && <form onSubmit={handleCreate} className="mt-2 rounded-lg border border-[#e4e7ec] bg-[#f9fafb] p-3"><label className="block text-xs font-semibold text-[#344054]">Business name<input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ABC Traders" className="mt-1.5 h-9 w-full rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm outline-none focus:border-[#465fff]" /></label>{error && <p className="mt-2 text-xs text-[#b42318]">{error}</p>}<button type="submit" disabled={!name.trim() || saving} className="mt-3 h-9 w-full rounded-lg bg-[#465fff] px-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Creating..." : "Create business"}</button></form>}
    </div>}
  </div>;
}
