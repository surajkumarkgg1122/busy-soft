"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBusiness } from "../../../../context/BusinessContext";

const BUSINESS_TYPES = [
  "Retail",
  "Wholesale",
  "Trading",
  "Manufacturing",
  "Services",
  "Water Supply",
  "Other",
];

export default function BusinessOnboardingPage() {
  const router = useRouter();
  const { user, memberships, loading, createBusiness } = useBusiness();

  const [name, setName] = useState("");
  const [businessType, setBusinessType] = useState("Retail");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pincode, setPincode] = useState("");
  const [gstEnabled, setGstEnabled] = useState(false);
  const [gstin, setGstin] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!loading && memberships.length > 0) {
      router.replace("/");
    }
  }, [loading, memberships.length, router]);

  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
  }, [user, email]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Enter your business name.");
      return;
    }

    if (gstEnabled && gstin.trim().length !== 15) {
      setError("Enter a valid 15-character GSTIN or turn GST off.");
      return;
    }

    setSaving(true);

    try {
      await createBusiness({
        name: trimmedName,
        businessType,
        phone: phone.trim(),
        email: email.trim(),
        city: city.trim(),
        state: state.trim(),
        pincode: pincode.trim(),
        gstEnabled,
        gstin: gstEnabled ? gstin.trim().toUpperCase() : "",
      });
      router.replace("/");
    } catch (createError) {
      console.error("Business onboarding failed:", createError);
      setError("We couldn't create your business. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !user || memberships.length > 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f7fb] px-6">
        <div className="text-sm text-[#667085]">Preparing your workspace...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f7fb] px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center">
        <section className="grid w-full overflow-hidden rounded-3xl border border-[#e4e7ec] bg-white shadow-[0_20px_60px_rgba(16,24,40,0.08)] lg:grid-cols-[0.82fr_1.18fr]">
          <div className="relative hidden overflow-hidden bg-[#182230] p-10 text-white lg:block">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-[#465fff]/20 blur-3xl" />
            <div className="absolute -bottom-24 -left-20 h-72 w-72 rounded-full bg-[#f5b544]/10 blur-3xl" />

            <div className="relative flex h-full flex-col">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f5b544] text-[#182230] text-lg font-black">B</div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8392a8]">Business Soft</p>
                  <p className="text-sm font-semibold">ERP Platform</p>
                </div>
              </div>

              <div className="my-auto py-12">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f5b544]">Your workspace</p>
                <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.04em]">Let's set up your business.</h1>
                <p className="mt-5 max-w-sm text-sm leading-7 text-[#aebbc9]">A few details are enough to create your private ERP workspace. You can complete the rest of your business settings later.</p>

                <div className="mt-8 space-y-3 text-sm text-[#d8e0eb]">
                  {[
                    "Private data workspace",
                    "Multi-user ready",
                    "Inventory, sales and accounting",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#243247] text-[#f5b544]">✓</span>
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="text-xs text-[#718198]">Powered by Business Soft</div>
            </div>
          </div>

          <div className="p-6 sm:p-10 lg:p-12">
            <div className="mx-auto max-w-xl">
              <div className="lg:hidden">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#465fff]">Business Soft ERP</p>
              </div>

              <div className="mt-3 lg:mt-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#465fff]">Step 1 of 1</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[#101828]">Create your business</h2>
                <p className="mt-2 text-sm leading-6 text-[#667085]">This becomes the workspace that your team will use.</p>
              </div>

              <form onSubmit={handleSubmit} className="mt-8 space-y-5">
                <div>
                  <label htmlFor="business-name" className="text-sm font-semibold text-[#344054]">Business name</label>
                  <input id="business-name" required autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Ganpati Neer" className="mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm text-[#344054] outline-none transition focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="business-type" className="text-sm font-semibold text-[#344054]">Business type</label>
                    <select id="business-type" value={businessType} onChange={(event) => setBusinessType(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm text-[#344054] outline-none focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10">
                      {BUSINESS_TYPES.map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="phone" className="text-sm font-semibold text-[#344054]">Phone</label>
                    <input id="phone" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="+91 98765 43210" className="mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm text-[#344054] outline-none focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" />
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="email" className="text-sm font-semibold text-[#344054]">Business email</label>
                    <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="business@example.com" className="mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm text-[#344054] outline-none focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" />
                  </div>
                  <div>
                    <label htmlFor="state" className="text-sm font-semibold text-[#344054]">State</label>
                    <input id="state" value={state} onChange={(event) => setState(event.target.value)} placeholder="Bihar" className="mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm text-[#344054] outline-none focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" />
                  </div>
                </div>

                <div className="grid gap-5 sm:grid-cols-[1fr_160px]">
                  <div>
                    <label htmlFor="city" className="text-sm font-semibold text-[#344054]">City</label>
                    <input id="city" value={city} onChange={(event) => setCity(event.target.value)} placeholder="Khagaria" className="mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm text-[#344054] outline-none focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" />
                  </div>
                  <div>
                    <label htmlFor="pincode" className="text-sm font-semibold text-[#344054]">Pincode</label>
                    <input id="pincode" value={pincode} onChange={(event) => setPincode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="851204" className="mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm text-[#344054] outline-none focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" />
                  </div>
                </div>

                <div className="rounded-2xl border border-[#e4e7ec] bg-[#f9fafb] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-[#344054]">GST registration</p>
                      <p className="mt-1 text-xs leading-5 text-[#667085]">You can configure GST details later from Settings.</p>
                    </div>
                    <button type="button" onClick={() => setGstEnabled((value) => !value)} aria-pressed={gstEnabled} className={`relative h-7 w-12 rounded-full transition-colors ${gstEnabled ? "bg-[#465fff]" : "bg-[#d0d5dd]"}`}>
                      <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${gstEnabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                  {gstEnabled && (
                    <div className="mt-4">
                      <label htmlFor="gstin" className="text-sm font-semibold text-[#344054]">GSTIN</label>
                      <input id="gstin" value={gstin} onChange={(event) => setGstin(event.target.value.toUpperCase().slice(0, 15))} placeholder="22AAAAA0000A1Z5" maxLength={15} className="mt-2 h-12 w-full rounded-xl border border-[#d0d5dd] bg-white px-4 text-sm uppercase tracking-[0.08em] text-[#344054] outline-none focus:border-[#465fff] focus:ring-4 focus:ring-[#465fff]/10" />
                    </div>
                  )}
                </div>

                {error && <p role="alert" className="rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</p>}

                <button type="submit" disabled={saving} className="h-12 w-full rounded-xl bg-[#465fff] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#3648d8] disabled:cursor-not-allowed disabled:opacity-60">
                  {saving ? "Creating your workspace..." : "Create business & continue"}
                </button>

                <p className="text-center text-xs leading-5 text-[#98a2b3]">By continuing, you create a new private business workspace under your account.</p>
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
