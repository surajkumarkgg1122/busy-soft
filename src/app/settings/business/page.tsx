"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { firestoreDb } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";

type SectionKey = "general" | "transactions" | "print" | "taxes" | "users" | "messages" | "party" | "items";
type Settings = {
  general: { businessName: string; legalName: string; phone: string; email: string; address: string; city: string; state: string; pincode: string; financialYearStart: string; currency: string };
  transactions: { invoicePrefix: string; nextInvoiceNumber: number; quotationPrefix: string; orderPrefix: string; returnPrefix: string; allowNegativeStock: boolean; showItemStockOnSale: boolean; autoCalculateBalance: boolean };
  print: { paperSize: string; printFormat: string; showLogo: boolean; showBusinessAddress: boolean; showSignature: boolean; footerMessage: string };
  taxes: { gstEnabled: boolean; gstin: string; taxType: string; defaultTaxRate: number; placeOfSupply: string; reverseCharge: boolean };
  users: { allowInvitingUsers: boolean; defaultRole: string; requireApprovalForDelete: boolean };
  messages: { invoiceMessage: string; quotationMessage: string; paymentMessage: string; reminderMessage: string };
  party: { defaultCustomerCreditLimit: number; requirePhone: boolean; requireAddress: boolean; allowDuplicatePhone: boolean; showOpeningBalance: boolean };
  items: { defaultUnit: string; allowDuplicateSku: boolean; requireSku: boolean; lowStockThreshold: number; showPurchasePrice: boolean };
};

const DEFAULTS: Settings = {
  general: { businessName: "", legalName: "", phone: "", email: "", address: "", city: "", state: "", pincode: "", financialYearStart: "04-01", currency: "INR" },
  transactions: { invoicePrefix: "", nextInvoiceNumber: 1001, quotationPrefix: "", orderPrefix: "", returnPrefix: "", allowNegativeStock: false, showItemStockOnSale: true, autoCalculateBalance: true },
  print: { paperSize: "A4", printFormat: "Detailed", showLogo: true, showBusinessAddress: true, showSignature: false, footerMessage: "Thank you for your business." },
  taxes: { gstEnabled: false, gstin: "", taxType: "Regular", defaultTaxRate: 0, placeOfSupply: "", reverseCharge: false },
  users: { allowInvitingUsers: true, defaultRole: "Staff", requireApprovalForDelete: true },
  messages: { invoiceMessage: "Thank you for your business.", quotationMessage: "We look forward to serving you.", paymentMessage: "Payment received. Thank you.", reminderMessage: "This is a friendly reminder for your outstanding balance." },
  party: { defaultCustomerCreditLimit: 0, requirePhone: false, requireAddress: false, allowDuplicatePhone: false, showOpeningBalance: true },
  items: { defaultUnit: "Piece", allowDuplicateSku: false, requireSku: false, lowStockThreshold: 0, showPurchasePrice: true },
};

const SECTIONS = [
  ["general", "General", "Business identity, address and defaults", "G"],
  ["transactions", "Transactions", "Numbering, stock and transaction behavior", "T"],
  ["print", "Print & Invoice", "Paper, layout and invoice appearance", "P"],
  ["taxes", "Taxes & GST", "GST, tax type and place of supply", "GST"],
  ["users", "User Management", "Roles, invitations and approvals", "U"],
  ["messages", "Transaction Messages", "Default messages for documents", "M"],
  ["party", "Party", "Customer and supplier defaults", "C"],
  ["items", "Item", "SKU, units and inventory defaults", "I"],
] as const;

function Field({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return <label className="text-sm font-semibold text-[#344054]">{label}<input type={type} value={value} onChange={e => onChange(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal outline-none focus:border-[#4f46e5]" /></label>;
}
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) { return <Field label={label} value={String(value)} type="number" onChange={v => onChange(Number(v) || 0)} />; }
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) { return <label className="text-sm font-semibold text-[#344054]">{label}<select value={value} onChange={e => onChange(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal">{options.map(o => <option key={o}>{o}</option>)}</select></label>; }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) { return <label className="flex items-center justify-between gap-4 rounded-xl border border-[#eaecf0] p-4"><span className="text-sm font-semibold text-[#344054]">{label}</span><button type="button" onClick={() => onChange(!checked)} aria-pressed={checked} className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-[#4f46e5]" : "bg-[#d0d5dd]"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? "left-6" : "left-1"}`} /></button></label>; }

export default function BusinessSettingsPage() {
  const { activeBusiness, activeBusinessId, loading: businessLoading, refreshBusinesses } = useBusiness();
  const [active, setActive] = useState<SectionKey>("general");
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (businessLoading) return;
      if (!firestoreDb || !activeBusinessId) { setLoading(false); return; }
      setLoading(true); setError("");
      try {
        const businessSnap = await getDoc(doc(firestoreDb, "businesses", activeBusinessId));
        const settingsSnap = await getDoc(doc(firestoreDb, "businesses", activeBusinessId, "settings", "business"));
        const business = businessSnap.exists() ? businessSnap.data() : {};
        const saved = settingsSnap.exists() ? settingsSnap.data() : {};
        setSettings({
          ...DEFAULTS,
          ...saved,
          general: {
            ...DEFAULTS.general,
            ...(saved.general || {}),
            businessName: business.name ?? saved.general?.businessName ?? "",
            legalName: business.legalName ?? saved.general?.legalName ?? "",
            phone: business.phone ?? saved.general?.phone ?? "",
            email: business.email ?? saved.general?.email ?? "",
            address: business.address?.line1 ?? saved.general?.address ?? "",
            city: business.address?.city ?? saved.general?.city ?? "",
            state: business.address?.state ?? saved.general?.state ?? "",
            pincode: business.address?.pincode ?? saved.general?.pincode ?? "",
            financialYearStart: business.financialYear ? `${String(business.financialYear.startMonth).padStart(2, "0")}-${String(business.financialYear.startDay).padStart(2, "0")}` : saved.general?.financialYearStart ?? "04-01",
            currency: business.currency ?? saved.general?.currency ?? "INR",
          },
          transactions: { ...DEFAULTS.transactions, ...(saved.transactions || {}) },
          print: { ...DEFAULTS.print, ...(saved.print || {}) },
          taxes: { ...DEFAULTS.taxes, ...(saved.taxes || {}), gstEnabled: business.gst?.enabled ?? saved.taxes?.gstEnabled ?? false, gstin: business.gst?.gstin ?? saved.taxes?.gstin ?? "", taxType: business.gst?.registrationType ?? saved.taxes?.taxType ?? "Regular" },
          users: { ...DEFAULTS.users, ...(saved.users || {}) },
          messages: { ...DEFAULTS.messages, ...(saved.messages || {}) },
          party: { ...DEFAULTS.party, ...(saved.party || {}) },
          items: { ...DEFAULTS.items, ...(saved.items || {}) },
        });
      } catch (e) { console.error(e); setError("Could not load business settings."); } finally { setLoading(false); }
    }
    load();
  }, [activeBusinessId, businessLoading]);

  const update = <K extends SectionKey>(section: K, field: keyof Settings[K], value: Settings[K][keyof Settings[K]]) => setSettings(current => ({ ...current, [section]: { ...current[section], [field]: value } }));

  async function save() {
    if (!firestoreDb || !activeBusinessId) { setError("Select a business before saving settings."); return; }
    if (!settings.general.businessName.trim()) { setError("Business name is required."); setActive("general"); return; }
    setSaving(true); setError(""); setMessage("");
    try {
      const businessRef = doc(firestoreDb, "businesses", activeBusinessId);
      const settingsRef = doc(firestoreDb, "businesses", activeBusinessId, "settings", "business");
      const [month, day] = settings.general.financialYearStart.split("-").map(Number);
      await setDoc(businessRef, {
        name: settings.general.businessName.trim(),
        legalName: settings.general.legalName.trim() || settings.general.businessName.trim(),
        phone: settings.general.phone.trim(),
        email: settings.general.email.trim(),
        address: { line1: settings.general.address.trim(), city: settings.general.city.trim(), state: settings.general.state.trim(), pincode: settings.general.pincode.trim(), country: activeBusiness?.business.address?.country || "India", district: activeBusiness?.business.address?.district || "", line2: activeBusiness?.business.address?.line2 || "" },
        currency: settings.general.currency,
        financialYear: { startMonth: month || 4, startDay: day || 1 },
        gst: { enabled: settings.taxes.gstEnabled, gstin: settings.taxes.gstin.trim(), registrationType: settings.taxes.gstEnabled ? (settings.taxes.taxType.toLowerCase() as "regular" | "composition" | "unregistered" | "other") : "unregistered" },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await setDoc(settingsRef, { ...settings, updatedAt: serverTimestamp() }, { merge: true });
      await refreshBusinesses();
      setMessage("Settings saved successfully.");
      window.setTimeout(() => setMessage(""), 2500);
    } catch (e) { console.error(e); setError("Could not save settings. Check Firestore rules and your role."); } finally { setSaving(false); }
  }

  const section = SECTIONS.find(s => s[0] === active)!;
  return <AuthGate><div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar/><main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8"><TopNav/><div className="mx-auto max-w-[1450px] py-4"><header className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="text-sm font-semibold text-[#4f46e5]">Administration</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#182230]">Business Settings</h1><p className="mt-2 max-w-2xl text-sm text-[#667085]">Configure how this business works across sales, purchases, parties, inventory, taxes and printed documents.</p></div><div className="flex items-center gap-3">{message && <span className="text-sm font-medium text-[#168361]">{message}</span>}<button onClick={save} disabled={saving || loading || !activeBusinessId} className="rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,.22)] disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button></div></header>{error&&<div className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] p-3 text-sm text-[#b42318]">{error}</div>}<div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]"><aside className="h-fit rounded-2xl border border-[#e7e5e4] bg-white p-3"><p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#98a2b3]">Settings</p><nav className="space-y-1">{SECTIONS.map(s=><button key={s[0]} onClick={()=>{setActive(s[0]);setError("")}} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left ${active===s[0]?"bg-[#eeedff] text-[#4f46e5]":"text-[#475467] hover:bg-[#fafafa]"}`}><span className={`flex h-9 min-w-9 items-center justify-center rounded-lg text-[10px] font-bold ${active===s[0]?"bg-[#4f46e5] text-white":"bg-[#f2f4f7] text-[#667085]"}`}>{s[3]}</span><span><span className="block text-sm font-semibold">{s[1]}</span><span className="block text-[11px] text-[#98a2b3]">{s[2]}</span></span></button>)}</nav></aside><section className="rounded-2xl border border-[#e7e5e4] bg-white shadow-sm"><div className="border-b border-[#eaecf0] px-6 py-5"><p className="text-sm font-semibold text-[#4f46e5]">{section[1]}</p><h2 className="mt-1 text-xl font-bold text-[#182230]">{section[2]}</h2></div><div className="p-6">{loading?<p className="py-16 text-center text-sm text-[#667085]">Loading settings…</p>:<>
{active==="general"&&<div className="grid gap-5 md:grid-cols-2"><Field label="Business name" value={settings.general.businessName} onChange={v=>update("general","businessName",v)}/><Field label="Legal / registered name" value={settings.general.legalName} onChange={v=>update("general","legalName",v)}/><Field label="Phone" value={settings.general.phone} onChange={v=>update("general","phone",v)}/><Field label="Email" value={settings.general.email} type="email" onChange={v=>update("general","email",v)}/><Field label="City" value={settings.general.city} onChange={v=>update("general","city",v)}/><Field label="State" value={settings.general.state} onChange={v=>update("general","state",v)}/><Field label="Pincode" value={settings.general.pincode} onChange={v=>update("general","pincode",v)}/><SelectField label="Currency" value={settings.general.currency} options={["INR","USD","EUR"]} onChange={v=>update("general","currency",v)}/><label className="md:col-span-2 text-sm font-semibold text-[#344054]">Business address<textarea value={settings.general.address} onChange={e=>update("general","address",e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-[#d0d5dd] p-3 font-normal outline-none focus:border-[#4f46e5]"/></label><SelectField label="Financial year starts" value={settings.general.financialYearStart} options={["04-01","01-01"]} onChange={v=>update("general","financialYearStart",v)}/><div className="rounded-xl border border-[#eaecf0] bg-[#fbfaf9] p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#98a2b3]">Active business</p><p className="mt-2 text-sm font-bold text-[#182230]">{activeBusiness?.business.name || "—"}</p><p className="mt-1 text-xs text-[#667085]">Business ID: {activeBusinessId || "—"}</p></div></div>}
{active==="transactions"&&<div className="space-y-5"><div className="grid gap-5 md:grid-cols-2"><Field label="Invoice prefix" value={settings.transactions.invoicePrefix} onChange={v=>update("transactions","invoicePrefix",v)}/><NumberField label="Next invoice number" value={settings.transactions.nextInvoiceNumber} onChange={v=>update("transactions","nextInvoiceNumber",v)}/><Field label="Quotation prefix" value={settings.transactions.quotationPrefix} onChange={v=>update("transactions","quotationPrefix",v)}/><Field label="Sales order prefix" value={settings.transactions.orderPrefix} onChange={v=>update("transactions","orderPrefix",v)}/><Field label="Sales return prefix" value={settings.transactions.returnPrefix} onChange={v=>update("transactions","returnPrefix",v)}/></div><Toggle label="Allow negative stock" checked={settings.transactions.allowNegativeStock} onChange={v=>update("transactions","allowNegativeStock",v)}/><Toggle label="Show available item stock while creating sales" checked={settings.transactions.showItemStockOnSale} onChange={v=>update("transactions","showItemStockOnSale",v)}/><Toggle label="Automatically calculate customer balance" checked={settings.transactions.autoCalculateBalance} onChange={v=>update("transactions","autoCalculateBalance",v)}/></div>}
{active==="print"&&<div className="grid gap-5 md:grid-cols-2"><SelectField label="Paper size" value={settings.print.paperSize} options={["A4","A5","Thermal 80mm","Thermal 58mm"]} onChange={v=>update("print","paperSize",v)}/><SelectField label="Print format" value={settings.print.printFormat} options={["Detailed","Compact","Simple"]} onChange={v=>update("print","printFormat",v)}/><Toggle label="Show business logo" checked={settings.print.showLogo} onChange={v=>update("print","showLogo",v)}/><Toggle label="Show business address" checked={settings.print.showBusinessAddress} onChange={v=>update("print","showBusinessAddress",v)}/><Toggle label="Show signature" checked={settings.print.showSignature} onChange={v=>update("print","showSignature",v)}/><Field label="Footer message" value={settings.print.footerMessage} onChange={v=>update("print","footerMessage",v)}/></div>}
{active==="taxes"&&<div className="space-y-5"><Toggle label="Enable GST" checked={settings.taxes.gstEnabled} onChange={v=>update("taxes","gstEnabled",v)}/><div className="grid gap-5 md:grid-cols-2"><Field label="GSTIN" value={settings.taxes.gstin} onChange={v=>update("taxes","gstin",v)}/><SelectField label="Registration type" value={settings.taxes.taxType} options={["Regular","Composition","Other","Unregistered"]} onChange={v=>update("taxes","taxType",v)}/><NumberField label="Default tax rate %" value={settings.taxes.defaultTaxRate} onChange={v=>update("taxes","defaultTaxRate",v)}/><Field label="Place of supply" value={settings.taxes.placeOfSupply} onChange={v=>update("taxes","placeOfSupply",v)}/></div><Toggle label="Reverse charge applicable" checked={settings.taxes.reverseCharge} onChange={v=>update("taxes","reverseCharge",v)}/></div>}
{active==="users"&&<div className="space-y-5"><Toggle label="Allow inviting users" checked={settings.users.allowInvitingUsers} onChange={v=>update("users","allowInvitingUsers",v)}/><SelectField label="Default role for invited users" value={settings.users.defaultRole} options={["Staff","Manager","Accountant","Sales","Inventory","Viewer"]} onChange={v=>update("users","defaultRole",v)}/><Toggle label="Require approval before deleting transactions" checked={settings.users.requireApprovalForDelete} onChange={v=>update("users","requireApprovalForDelete",v)}/></div>}
{active==="messages"&&<div className="space-y-5"><Field label="Invoice message" value={settings.messages.invoiceMessage} onChange={v=>update("messages","invoiceMessage",v)}/><Field label="Quotation message" value={settings.messages.quotationMessage} onChange={v=>update("messages","quotationMessage",v)}/><Field label="Payment message" value={settings.messages.paymentMessage} onChange={v=>update("messages","paymentMessage",v)}/><Field label="Outstanding reminder message" value={settings.messages.reminderMessage} onChange={v=>update("messages","reminderMessage",v)}/></div>}
{active==="party"&&<div className="space-y-5"><NumberField label="Default customer credit limit" value={settings.party.defaultCustomerCreditLimit} onChange={v=>update("party","defaultCustomerCreditLimit",v)}/><Toggle label="Require phone number" checked={settings.party.requirePhone} onChange={v=>update("party","requirePhone",v)}/><Toggle label="Require address" checked={settings.party.requireAddress} onChange={v=>update("party","requireAddress",v)}/><Toggle label="Allow duplicate phone numbers" checked={settings.party.allowDuplicatePhone} onChange={v=>update("party","allowDuplicatePhone",v)}/><Toggle label="Show opening balance" checked={settings.party.showOpeningBalance} onChange={v=>update("party","showOpeningBalance",v)}/></div>}
{active==="items"&&<div className="space-y-5"><div className="grid gap-5 md:grid-cols-2"><Field label="Default unit" value={settings.items.defaultUnit} onChange={v=>update("items","defaultUnit",v)}/><NumberField label="Low stock threshold" value={settings.items.lowStockThreshold} onChange={v=>update("items","lowStockThreshold",v)}/></div><Toggle label="Allow duplicate SKU" checked={settings.items.allowDuplicateSku} onChange={v=>update("items","allowDuplicateSku",v)}/><Toggle label="Require SKU for new items" checked={settings.items.requireSku} onChange={v=>update("items","requireSku",v)}/><Toggle label="Show purchase price" checked={settings.items.showPurchasePrice} onChange={v=>update("items","showPurchasePrice",v)}/></div>}
</>}</div></section></div></div></main></div></AuthGate>;
}
