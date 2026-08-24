"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import Sidebar from "../../Components/Sidebar/page";
import TopNav from "../../Components/TopNav/page";
import AuthGate from "../../Components/Auth/AuthGate";
import { firestoreDb } from "../../../lib/firebase";
import { useBusiness } from "../../../context/BusinessContext";

type SectionKey =
  | "general"
  | "transactions"
  | "print"
  | "taxes"
  | "users"
  | "messages"
  | "party"
  | "items";

type Settings = {
  general: {
    businessName: string;
    legalName: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    financialYearStart: string;
    currency: string;
  };
  transactions: {
    invoicePrefix: string;
    nextInvoiceNumber: number;
    quotationPrefix: string;
    orderPrefix: string;
    returnPrefix: string;
    allowNegativeStock: boolean;
    showItemStockOnSale: boolean;
    autoCalculateBalance: boolean;
  };
  print: {
    paperSize: string;
    printFormat: string;
    showLogo: boolean;
    showBusinessAddress: boolean;
    showSignature: boolean;
    footerMessage: string;
  };
  taxes: {
    gstEnabled: boolean;
    gstin: string;
    taxType: string;
    defaultTaxRate: number;
    placeOfSupply: string;
    reverseCharge: boolean;
  };
  users: {
    allowInvitingUsers: boolean;
    defaultRole: string;
    requireApprovalForDelete: boolean;
  };
  messages: {
    invoiceMessage: string;
    quotationMessage: string;
    paymentMessage: string;
    reminderMessage: string;
  };
  party: {
    defaultCustomerCreditLimit: number;
    requirePhone: boolean;
    requireAddress: boolean;
    allowDuplicatePhone: boolean;
    showOpeningBalance: boolean;
  };
  items: {
    defaultUnit: string;
    allowDuplicateSku: boolean;
    requireSku: boolean;
    lowStockThreshold: number;
    showPurchasePrice: boolean;
  };
};

const DEFAULTS: Settings = {
  general: {
    businessName: "",
    legalName: "",
    phone: "",
    email: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    financialYearStart: "04-01",
    currency: "INR",
  },
  transactions: {
    invoicePrefix: "",
    nextInvoiceNumber: 1001,
    quotationPrefix: "",
    orderPrefix: "",
    returnPrefix: "",
    allowNegativeStock: false,
    showItemStockOnSale: true,
    autoCalculateBalance: true,
  },
  print: {
    paperSize: "A4",
    printFormat: "Detailed",
    showLogo: true,
    showBusinessAddress: true,
    showSignature: false,
    footerMessage: "Thank you for your business.",
  },
  taxes: {
    gstEnabled: false,
    gstin: "",
    taxType: "Regular",
    defaultTaxRate: 0,
    placeOfSupply: "",
    reverseCharge: false,
  },
  users: {
    allowInvitingUsers: true,
    defaultRole: "Staff",
    requireApprovalForDelete: true,
  },
  messages: {
    invoiceMessage: "Thank you for your business.",
    quotationMessage: "We look forward to serving you.",
    paymentMessage: "Payment received. Thank you.",
    reminderMessage: "This is a friendly reminder for your outstanding balance.",
  },
  party: {
    defaultCustomerCreditLimit: 0,
    requirePhone: false,
    requireAddress: false,
    allowDuplicatePhone: false,
    showOpeningBalance: true,
  },
  items: {
    defaultUnit: "Piece",
    allowDuplicateSku: false,
    requireSku: false,
    lowStockThreshold: 0,
    showPurchasePrice: true,
  },
};

const SECTIONS: { key: SectionKey; label: string; description: string; icon: string }[] = [
  { key: "general", label: "General", description: "Business identity, address and defaults", icon: "G" },
  { key: "transactions", label: "Transactions", description: "Numbering, stock and transaction behavior", icon: "T" },
  { key: "print", label: "Print & Invoice", description: "Paper, layout and invoice appearance", icon: "P" },
  { key: "taxes", label: "Taxes & GST", description: "GST, tax type and place of supply", icon: "GST" },
  { key: "users", label: "User Management", description: "Roles, invitations and approvals", icon: "U" },
  { key: "messages", label: "Transaction Messages", description: "Default messages for documents", icon: "M" },
  { key: "party", label: "Party", description: "Customer and supplier defaults", icon: "C" },
  { key: "items", label: "Item", description: "SKU, units and inventory defaults", icon: "I" },
];

export default function BusinessSettingsPage() {
  const { activeBusinessId, loading: businessLoading } = useBusiness();
  const [active, setActive] = useState<SectionKey>("general");
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      if (businessLoading) return;
      if (!firestoreDb || !activeBusinessId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const ref = doc(firestoreDb, "businesses", activeBusinessId, "settings", "business");
        const snapshot = await getDoc(ref);
        if (snapshot.exists()) {
          setSettings({ ...DEFAULTS, ...(snapshot.data() as Partial<Settings>),
            general: { ...DEFAULTS.general, ...snapshot.data().general },
            transactions: { ...DEFAULTS.transactions, ...snapshot.data().transactions },
            print: { ...DEFAULTS.print, ...snapshot.data().print },
            taxes: { ...DEFAULTS.taxes, ...snapshot.data().taxes },
            users: { ...DEFAULTS.users, ...snapshot.data().users },
            messages: { ...DEFAULTS.messages, ...snapshot.data().messages },
            party: { ...DEFAULTS.party, ...snapshot.data().party },
            items: { ...DEFAULTS.items, ...snapshot.data().items },
          });
        }
      } catch (reason) {
        console.error(reason);
        setError("Could not load business settings.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [activeBusinessId, businessLoading]);

  const update = <K extends SectionKey>(section: K, field: keyof Settings[K], value: Settings[K][keyof Settings[K]]) => {
    setSettings((current) => ({ ...current, [section]: { ...current[section], [field]: value } }));
  };

  async function save() {
    if (!firestoreDb || !activeBusinessId) {
      setError("Select a business before saving settings.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await setDoc(doc(firestoreDb, "businesses", activeBusinessId, "settings", "business"), {
        ...settings,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setMessage("Settings saved successfully.");
      window.setTimeout(() => setMessage(""), 2500);
    } catch (reason) {
      console.error(reason);
      setError("Could not save settings. Check Firestore rules and your role.");
    } finally {
      setSaving(false);
    }
  }

  const title = useMemo(() => SECTIONS.find((item) => item.key === active)!, [active]);

  return (
    <AuthGate>
      <div className="flex min-h-screen bg-[#f8f7f4]">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8">
          <TopNav />
          <div className="mx-auto max-w-[1450px] py-4">
            <header className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
              <div>
                <p className="text-sm font-semibold text-[#4f46e5]">Administration</p>
                <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#182230]">Business Settings</h1>
                <p className="mt-2 max-w-2xl text-sm text-[#667085]">Configure how this business works across sales, purchases, parties, inventory, taxes and printed documents.</p>
              </div>
              <div className="flex items-center gap-3">
                {message && <span className="text-sm font-medium text-[#168361]">{message}</span>}
                <button onClick={save} disabled={saving || loading || !activeBusinessId} className="rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,.22)] hover:bg-[#4338ca] disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button>
              </div>
            </header>

            {error && <div className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}

            <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
              <aside className="h-fit rounded-2xl border border-[#e7e5e4] bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
                <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#98a2b3]">Settings</p>
                <nav className="space-y-1">
                  {SECTIONS.map((section) => (
                    <button key={section.key} onClick={() => { setActive(section.key); setError(""); }} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${active === section.key ? "bg-[#eeedff] text-[#4f46e5]" : "text-[#475467] hover:bg-[#fafafa]"}`}>
                      <span className={`flex h-9 min-w-9 items-center justify-center rounded-lg text-[10px] font-bold ${active === section.key ? "bg-[#4f46e5] text-white" : "bg-[#f2f4f7] text-[#667085]"}`}>{section.icon}</span>
                      <span className="min-w-0"><span className="block text-sm font-semibold">{section.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-[#98a2b3]">{section.description}</span></span>
                    </button>
                  ))}
                </nav>
              </aside>

              <section className="rounded-2xl border border-[#e7e5e4] bg-white shadow-[0_3px_10px_rgba(16,24,40,.04)]">
                <div className="border-b border-[#eaecf0] px-6 py-5"><p className="text-sm font-semibold text-[#4f46e5]">{title.label}</p><h2 className="mt-1 text-xl font-bold text-[#182230]">{title.description}</h2></div>
                <div className="p-6">
                  {loading ? <p className="py-16 text-center text-sm text-[#667085]">Loading settings…</p> : (
                    <>
                      {active === "general" && <div className="grid gap-5 md:grid-cols-2">{([ ["Business name", "businessName", "text"], ["Legal / registered name", "legalName", "text"], ["Phone", "phone", "text"], ["Email", "email", "email"], ["City", "city", "text"], ["State", "state", "text"], ["Pincode", "pincode", "text"] ] as const).map(([label, key, type]) => <label key={key} className="text-sm font-semibold text-[#344054]">{label}<input type={type} value={settings.general[key]} onChange={e => update("general", key, e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal outline-none focus:border-[#4f46e5]" /></label>)}<label className="md:col-span-2 text-sm font-semibold text-[#344054]">Business address<textarea value={settings.general.address} onChange={e => update("general", "address", e.target.value)} className="mt-2 min-h-24 w-full rounded-xl border border-[#d0d5dd] p-3 font-normal outline-none focus:border-[#4f46e5]" /></label><label className="text-sm font-semibold text-[#344054]">Financial year starts<select value={settings.general.financialYearStart} onChange={e => update("general", "financialYearStart", e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal"><option value="04-01">1 April</option><option value="01-01">1 January</option></select></label><label className="text-sm font-semibold text-[#344054]">Currency<select value={settings.general.currency} onChange={e => update("general", "currency", e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal"><option>INR</option><option>USD</option><option>EUR</option></select></label></div>}

                      {active === "transactions" && <div className="space-y-6"><div className="grid gap-5 md:grid-cols-2"><Field label="Invoice prefix" value={settings.transactions.invoicePrefix} onChange={v => update("transactions", "invoicePrefix", v)} /><NumberField label="Next invoice number" value={settings.transactions.nextInvoiceNumber} onChange={v => update("transactions", "nextInvoiceNumber", v)} /><Field label="Quotation prefix" value={settings.transactions.quotationPrefix} onChange={v => update("transactions", "quotationPrefix", v)} /><Field label="Sales order prefix" value={settings.transactions.orderPrefix} onChange={v => update("transactions", "orderPrefix", v)} /><Field label="Sales return prefix" value={settings.transactions.returnPrefix} onChange={v => update("transactions", "returnPrefix", v)} /></div><Toggle label="Allow negative stock" checked={settings.transactions.allowNegativeStock} onChange={v => update("transactions", "allowNegativeStock", v)} /><Toggle label="Show available item stock while creating sales" checked={settings.transactions.showItemStockOnSale} onChange={v => update("transactions", "showItemStockOnSale", v)} /><Toggle label="Automatically calculate customer balance" checked={settings.transactions.autoCalculateBalance} onChange={v => update("transactions", "autoCalculateBalance", v)} /></div>}

                      {active === "print" && <div className="grid gap-5 md:grid-cols-2"><SelectField label="Paper size" value={settings.print.paperSize} options={["A4", "A5", "Thermal 80mm", "Thermal 58mm"]} onChange={v => update("print", "paperSize", v)} /><SelectField label="Print format" value={settings.print.printFormat} options={["Detailed", "Compact", "Simple"]} onChange={v => update("print", "printFormat", v)} /><Toggle label="Show business logo" checked={settings.print.showLogo} onChange={v => update("print", "showLogo", v)} /><Toggle label="Show business address" checked={settings.print.showBusinessAddress} onChange={v => update("print", "showBusinessAddress", v)} /><Toggle label="Show authorized signature area" checked={settings.print.showSignature} onChange={v => update("print", "showSignature", v)} /><label className="md:col-span-2 text-sm font-semibold text-[#344054]">Footer message<textarea value={settings.print.footerMessage} onChange={e => update("print", "footerMessage", e.target.value)} className="mt-2 min-h-20 w-full rounded-xl border border-[#d0d5dd] p-3 font-normal" /></label></div>}

                      {active === "taxes" && <div className="space-y-6"><Toggle label="Enable GST for this business" checked={settings.taxes.gstEnabled} onChange={v => update("taxes", "gstEnabled", v)} /><div className="grid gap-5 md:grid-cols-2"><Field label="GSTIN" value={settings.taxes.gstin} onChange={v => update("taxes", "gstin", v)} /><SelectField label="Tax registration type" value={settings.taxes.taxType} options={["Regular", "Composition", "Unregistered"]} onChange={v => update("taxes", "taxType", v)} /><NumberField label="Default tax rate (%)" value={settings.taxes.defaultTaxRate} onChange={v => update("taxes", "defaultTaxRate", v)} /><Field label="Place of supply / State" value={settings.taxes.placeOfSupply} onChange={v => update("taxes", "placeOfSupply", v)} /></div><Toggle label="Enable reverse charge by default" checked={settings.taxes.reverseCharge} onChange={v => update("taxes", "reverseCharge", v)} /></div>}

                      {active === "users" && <div className="space-y-6"><Toggle label="Allow business owner/admin to invite users" checked={settings.users.allowInvitingUsers} onChange={v => update("users", "allowInvitingUsers", v)} /><SelectField label="Default role for new users" value={settings.users.defaultRole} options={["Staff", "Sales", "Accountant", "Viewer"]} onChange={v => update("users", "defaultRole", v)} /><Toggle label="Require admin approval before deleting data" checked={settings.users.requireApprovalForDelete} onChange={v => update("users", "requireApprovalForDelete", v)} /><div className="rounded-xl bg-[#f8f7ff] p-4 text-sm text-[#667085]">User invitations, role assignment and permissions will use this business configuration once the full Users & Roles module is enabled.</div></div>}

                      {active === "messages" && <div className="grid gap-5 md:grid-cols-2"><TextAreaField label="Invoice message" value={settings.messages.invoiceMessage} onChange={v => update("messages", "invoiceMessage", v)} /><TextAreaField label="Quotation message" value={settings.messages.quotationMessage} onChange={v => update("messages", "quotationMessage", v)} /><TextAreaField label="Payment message" value={settings.messages.paymentMessage} onChange={v => update("messages", "paymentMessage", v)} /><TextAreaField label="Outstanding reminder message" value={settings.messages.reminderMessage} onChange={v => update("messages", "reminderMessage", v)} /></div>}

                      {active === "party" && <div className="space-y-6"><div className="grid gap-5 md:grid-cols-2"><NumberField label="Default customer credit limit" value={settings.party.defaultCustomerCreditLimit} onChange={v => update("party", "defaultCustomerCreditLimit", v)} /><Toggle label="Show opening balance while creating a party" checked={settings.party.showOpeningBalance} onChange={v => update("party", "showOpeningBalance", v)} /></div><Toggle label="Require phone number" checked={settings.party.requirePhone} onChange={v => update("party", "requirePhone", v)} /><Toggle label="Require address" checked={settings.party.requireAddress} onChange={v => update("party", "requireAddress", v)} /><Toggle label="Allow duplicate phone numbers" checked={settings.party.allowDuplicatePhone} onChange={v => update("party", "allowDuplicatePhone", v)} /></div>}

                      {active === "items" && <div className="space-y-6"><div className="grid gap-5 md:grid-cols-2"><SelectField label="Default unit" value={settings.items.defaultUnit} options={["Piece", "Box", "Kg", "Litre", "Meter"]} onChange={v => update("items", "defaultUnit", v)} /><NumberField label="Low stock warning threshold" value={settings.items.lowStockThreshold} onChange={v => update("items", "lowStockThreshold", v)} /></div><Toggle label="Allow duplicate SKU / item code" checked={settings.items.allowDuplicateSku} onChange={v => update("items", "allowDuplicateSku", v)} /><Toggle label="Require SKU / item code" checked={settings.items.requireSku} onChange={v => update("items", "requireSku", v)} /><Toggle label="Show purchase price in item management" checked={settings.items.showPurchasePrice} onChange={v => update("items", "showPurchasePrice", v)} /></div>}
                    </>
                  )}
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </AuthGate>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-semibold text-[#344054]">{label}<input value={value} onChange={e => onChange(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal outline-none focus:border-[#4f46e5]" /></label>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="block text-sm font-semibold text-[#344054]">{label}<input type="number" min="0" value={value} onChange={e => onChange(Number(e.target.value) || 0)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] px-3 font-normal outline-none focus:border-[#4f46e5]" /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="block text-sm font-semibold text-[#344054]">{label}<select value={value} onChange={e => onChange(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal outline-none focus:border-[#4f46e5]">{options.map(option => <option key={option}>{option}</option>)}</select></label>;
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-sm font-semibold text-[#344054]">{label}<textarea value={value} onChange={e => onChange(e.target.value)} className="mt-2 min-h-28 w-full rounded-xl border border-[#d0d5dd] p-3 font-normal outline-none focus:border-[#4f46e5]" /></label>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[#eaecf0] p-4"><span><span className="block text-sm font-semibold text-[#344054]">{label}</span><span className="mt-1 block text-xs text-[#98a2b3]">Applied to this business only.</span></span><button type="button" aria-pressed={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-[#4f46e5]" : "bg-[#d0d5dd]"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`} /></button></label>;
}
