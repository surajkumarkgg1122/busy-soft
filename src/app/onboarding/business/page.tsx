"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBusiness } from "../../../context/BusinessContext";
import { INDIAN_STATES } from "../../../constants/indianStates";

const BUSINESS_TYPES = ["Retail", "Wholesale", "Trading", "Manufacturing", "Services", "Water Supply", "Other"] as const;
const GST_TYPES = [
  { value: "unregistered", label: "Not registered for GST" },
  { value: "regular", label: "Regular taxpayer" },
  { value: "composition", label: "Composition taxpayer" },
  { value: "other", label: "Other" },
] as const;
const FY_MONTHS = [[1, "January"], [2, "February"], [3, "March"], [4, "April"], [5, "May"], [6, "June"], [7, "July"], [8, "August"], [9, "September"], [10, "October"], [11, "November"], [12, "December"]] as const;

export default function BusinessOnboardingPage() {
  const router = useRouter();
  const { user, memberships, loading, createBusiness } = useBusiness();
  const onboardingRequestKey = useRef(`business-create-${crypto.randomUUID()}`);
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState<(typeof BUSINESS_TYPES)[number]>("Retail");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [districtName, setDistrictName] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [gstType, setGstType] = useState<(typeof GST_TYPES)[number]["value"]>("unregistered");
  const [gstin, setGstin] = useState("");
  const [fyMonth, setFyMonth] = useState(4);
  const [valuationMethod, setValuationMethod] = useState<"fifo" | "weighted_average">("fifo");
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [quantityDecimals, setQuantityDecimals] = useState(3);
  const [defaultWarehouse, setDefaultWarehouse] = useState("Main Warehouse");
  const [invoicePrefix, setInvoicePrefix] = useState("");
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState(1001);
  const [defaultTaxRate, setDefaultTaxRate] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
  }, [user, email]);

  function validate(targetStep: number) {
    if (!name.trim()) return "Enter your business name.";
    if (!state) return "Select your state or union territory.";
    if (!city.trim()) return "City is required.";
    if (!/^\d{6}$/.test(pincode.trim())) return "Enter a valid 6-digit Indian pincode.";
    if ((gstType === "regular" || gstType === "composition") && !/^[0-9A-Z]{15}$/.test(gstin.trim().toUpperCase())) return "Enter a valid 15-character GSTIN.";
    if (targetStep >= 2) {
      if (!defaultWarehouse.trim()) return "Enter a default warehouse name.";
      if (!Number.isInteger(quantityDecimals) || quantityDecimals < 0 || quantityDecimals > 6) return "Quantity decimals must be between 0 and 6.";
    }
    if (targetStep >= 3) {
      if (!Number.isInteger(nextInvoiceNumber) || nextInvoiceNumber < 1) return "Enter a valid next invoice number.";
      if (!Number.isFinite(defaultTaxRate) || defaultTaxRate < 0 || defaultTaxRate > 100) return "Default tax rate must be between 0 and 100.";
    }
    return "";
  }

  function goNext() {
    const message = validate(step + 1);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setStep((current) => Math.min(3, current + 1));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = validate(3);
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await createBusiness({
        name: name.trim(),
        businessType,
        phone: phone.trim(),
        email: email.trim(),
        address: address.trim(),
        city: city.trim(),
        district: districtName.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        gstEnabled: gstType !== "unregistered",
        registrationType: gstType,
        gstin: gstType === "regular" || gstType === "composition" ? gstin.trim().toUpperCase() : "",
        financialYearStartMonth: fyMonth,
        financialYearStartDay: 1,
        inventoryValuationMethod: valuationMethod,
        allowNegativeStock,
        quantityDecimals,
        defaultWarehouseName: defaultWarehouse.trim(),
        invoicePrefix: invoicePrefix.trim(),
        nextInvoiceNumber,
        defaultTaxRate,
        idempotencyKey: onboardingRequestKey.current,
      });
      router.replace("/");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "We couldn't create your business. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user) {
    return <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb]"><div className="text-sm text-[#667085]">Preparing your workspace...</div></main>;
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-3xl border border-[#e4e7ec] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.08)] lg:grid-cols-[0.72fr_1.28fr]">
          <aside className="relative hidden overflow-hidden bg-[#182230] p-10 text-white lg:block">
            <div className="relative flex h-full flex-col">
              <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f5b544] font-black text-[#182230]">B</div><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8392a8]">Business Soft</p><p className="text-sm font-semibold">ERP Platform</p></div></div>
              <div className="my-auto py-12"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f5b544]">Workspace setup</p><h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em]">Create a complete accounting workspace.</h1><p className="mt-5 max-w-sm text-sm leading-7 text-[#aebbc9]">Business identity, financial year, inventory policy, GST and numbering are configured before your books go live.</p><div className="mt-8 space-y-3 text-sm text-[#d8e0eb]"><div>✓ Separate books & financial year</div><div>✓ Default chart of accounts</div><div>✓ Default warehouse</div><div>✓ Accounting & tax defaults</div></div></div>
              <div className="text-xs text-[#718198]">{memberships.length ? `${memberships.length} business${memberships.length === 1 ? "" : "es"} already connected` : "Create your first business"}</div>
            </div>
          </aside>
          <div className="p-6 sm:p-10 lg:p-12">
            <div className="mx-auto max-w-3xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#465fff]">Business setup</p><h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#101828]">Create your business</h2></div><Link href="/join/pending" className="text-sm font-semibold text-[#465fff] hover:text-[#3648d8]">Join an existing company →</Link></div>
              <div className="mt-8 grid grid-cols-3 gap-2"><Step n={1} label="Business" active={step === 1} done={step > 1} /><Step n={2} label="Accounting" active={step === 2} done={step > 2} /><Step n={3} label="Finish" active={step === 3} done={false} /></div>

              <form onSubmit={submit} className="mt-8">
                {step === 1 && <div className="space-y-5"><div><Label htmlFor="name">Business name</Label><input id="name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Sunrise Traders" /></div><div className="grid gap-5 sm:grid-cols-2"><div><Label htmlFor="type">Business type</Label><select id="type" value={businessType} onChange={(e) => setBusinessType(e.target.value as (typeof BUSINESS_TYPES)[number])} className={selectClass}>{BUSINESS_TYPES.map((type) => <option key={type}>{type}</option>)}</select></div><div><Label htmlFor="phone">Phone</Label><input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="e.g. +91 98765 43210" /></div></div><div className="grid gap-5 sm:grid-cols-2"><div><Label htmlFor="email">Business email</Label><input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="business@yourcompany.com" /></div><div><Label htmlFor="state">State / Union Territory</Label><select id="state" required value={state} onChange={(e) => setState(e.target.value)} className={selectClass}><option value="">Select state / UT</option>{INDIAN_STATES.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></div></div><div><Label htmlFor="address">Address</Label><input id="address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} placeholder="Street, locality, building" /></div><div className="grid gap-5 sm:grid-cols-3"><div><Label htmlFor="city">City</Label><input id="city" required value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} placeholder="e.g. Khagaria" /></div><div><Label htmlFor="district">District</Label><input id="district" value={districtName} onChange={(e) => setDistrictName(e.target.value)} className={inputClass} placeholder="e.g. Khagaria" /></div><div><Label htmlFor="pincode">Pincode</Label><input id="pincode" required inputMode="numeric" value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))} className={inputClass} placeholder="e.g. 851204" /></div></div></div>}

                {step === 2 && <div className="space-y-6"><section className="rounded-2xl border border-[#e4e7ec] bg-[#f9fafb] p-5"><h3 className="text-sm font-semibold text-[#101828]">Financial year & valuation</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><Label htmlFor="fy">Financial year starts</Label><select id="fy" value={fyMonth} onChange={(e) => setFyMonth(Number(e.target.value))} className={selectClass}>{FY_MONTHS.map(([value, label]) => <option key={value} value={value}>{label} 1</option>)}</select></div><div><Label htmlFor="valuation">Inventory valuation</Label><select id="valuation" value={valuationMethod} onChange={(e) => setValuationMethod(e.target.value as "fifo" | "weighted_average")} className={selectClass}><option value="fifo">FIFO</option><option value="weighted_average">Weighted Average</option></select></div></div></section><section className="rounded-2xl border border-[#e4e7ec] bg-white p-5"><h3 className="text-sm font-semibold text-[#101828]">Inventory policy</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><Label htmlFor="warehouse">Default warehouse</Label><input id="warehouse" value={defaultWarehouse} onChange={(e) => setDefaultWarehouse(e.target.value)} className={inputClass} placeholder="e.g. Main Warehouse" /></div><div><Label htmlFor="decimals">Quantity decimals</Label><input id="decimals" type="number" min="0" max="6" step="1" value={quantityDecimals} onChange={(e) => setQuantityDecimals(Number(e.target.value))} className={inputClass} placeholder="e.g. 3" /></div></div><label className="mt-4 flex items-start gap-3 rounded-xl border border-[#eaecf0] p-4"><input type="checkbox" checked={allowNegativeStock} onChange={(e) => setAllowNegativeStock(e.target.checked)} className="mt-1" /><span><strong className="block text-sm text-[#344054]">Allow negative stock</strong><span className="mt-1 block text-xs text-[#667085]">Keep disabled for stricter inventory integrity.</span></span></label></section></div>}

                {step === 3 && <div className="space-y-6"><section className="rounded-2xl border border-[#e4e7ec] bg-[#f9fafb] p-5"><h3 className="text-sm font-semibold text-[#101828]">GST & tax</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><Label htmlFor="gstType">GST registration type</Label><select id="gstType" value={gstType} onChange={(e) => { const value = e.target.value as (typeof GST_TYPES)[number]["value"]; setGstType(value); if (value === "unregistered" || value === "other") setGstin(""); }} className={selectClass}>{GST_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div><div><Label htmlFor="tax">Default tax rate %</Label><input id="tax" type="number" min="0" max="100" step="0.01" value={defaultTaxRate} onChange={(e) => setDefaultTaxRate(Number(e.target.value))} className={inputClass} placeholder="e.g. 18" /></div></div>{(gstType === "regular" || gstType === "composition") && <div className="mt-4"><Label htmlFor="gstin">GSTIN</Label><input id="gstin" maxLength={15} value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase().slice(0, 15))} className={inputClass} placeholder="15-character GSTIN" /></div>}</section><section className="rounded-2xl border border-[#e4e7ec] bg-white p-5"><h3 className="text-sm font-semibold text-[#101828]">Invoice numbering</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><div><Label htmlFor="prefix">Invoice prefix</Label><input id="prefix" value={invoicePrefix} onChange={(e) => setInvoicePrefix(e.target.value.toUpperCase().slice(0, 12))} className={inputClass} placeholder="e.g. INV-" /></div><div><Label htmlFor="nextNo">Next invoice number</Label><input id="nextNo" type="number" min="1" step="1" value={nextInvoiceNumber} onChange={(e) => setNextInvoiceNumber(Number(e.target.value))} className={inputClass} placeholder="e.g. 1001" /></div></div></section><div className="rounded-2xl border border-[#dbe4ff] bg-[#f4f6ff] p-4 text-sm text-[#344054]"><strong>Ready to provision:</strong> accounts, financial year, inventory policy, default warehouse, tax defaults, invoice numbering, owner membership and audit trail.</div></div>}

                {error && <p role="alert" className="mt-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</p>}
                <div className="mt-8 flex items-center justify-between"><button type="button" onClick={() => step === 1 ? router.replace("/") : setStep((current) => current - 1)} className="h-11 rounded-xl border border-[#d0d5dd] px-5 text-sm font-semibold">{step === 1 ? "Cancel" : "Back"}</button>{step < 3 ? <button type="button" onClick={goNext} className="h-11 rounded-xl bg-[#465fff] px-6 text-sm font-semibold text-white">Continue</button> : <button type="submit" disabled={saving} className="h-11 rounded-xl bg-[#465fff] px-6 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Provisioning workspace..." : "Create business & continue"}</button>}</div>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

const inputClass = "mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm outline-none focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10";
const selectClass = `${inputClass} pr-10`;

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return <label htmlFor={htmlFor} className="text-sm font-semibold text-[#344054]">{children}</label>;
}

function Step({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return <div className={`rounded-xl border p-3 ${active ? "border-[#465fff] bg-[#f4f6ff]" : "border-[#e4e7ec]"}`}><div className="flex items-center gap-2"><span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${active || done ? "bg-[#465fff] text-white" : "bg-[#f2f4f7] text-[#667085]"}`}>{done ? "✓" : n}</span><span className={`text-xs font-semibold ${active ? "text-[#344054]" : "text-[#667085]"}`}>{label}</span></div></div>;
}
