"use client";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "../../../Components/Sidebar/page";
import TopNav from "../../../Components/TopNav/page";
import AuthGate from "../../../Components/Auth/AuthGate";
import { auth } from "../../../../lib/firebase";
import { useBusiness } from "../../../../context/BusinessContext";
type Bill = {
  voucherNumber: string;
  date: string;
  dueDate: string;
  originalAmount: number;
  allocatedAmount: number;
  outstanding: number;
  ageDays: number;
  overdueDays: number;
  bucket: string;
};
type Summary = {
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days91to180: number;
  days181to365: number;
  days365Plus: number;
  total: number;
};
const money = (p: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(p / 100);
async function token() {
  if (!auth?.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser.getIdToken();
}
export default function PartyAgeingPage() {
  const { activeBusinessId } = useBusiness();
  const [kind, setKind] = useState<"customer" | "supplier">("customer");
  const [partyId, setPartyId] = useState("");
  const [parties, setParties] = useState<
    Array<{ id: string; name: string; partyCode: string }>
  >([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      if (!activeBusinessId) return;
      try {
        const t = await token();
        const r = await fetch(
          `/api/parties?businessId=${encodeURIComponent(activeBusinessId)}&kind=${kind}`,
          { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" },
        );
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || "Could not load parties.");
        const x = b.parties || [];
        setParties(x);
        setPartyId(x[0]?.id || "");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load parties.");
      }
    }
    void load();
  }, [activeBusinessId, kind]);
  useEffect(() => {
    async function load() {
      if (!activeBusinessId || !partyId) return;
      try {
        setLoading(true);
        const t = await token();
        const r = await fetch(
          `/api/parties/ageing?businessId=${encodeURIComponent(activeBusinessId)}&partyId=${encodeURIComponent(partyId)}&kind=${kind}&asOf=${asOf}`,
          { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" },
        );
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || "Could not load ageing.");
        setBills(b.bills || []);
        setSummary(b.summary || null);
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load ageing.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [activeBusinessId, partyId, kind, asOf]);
  const buckets = useMemo(
    () =>
      summary
        ? [
            ["Current", summary.current],
            ["1–30", summary.days1to30],
            ["31–60", summary.days31to60],
            ["61–90", summary.days61to90],
            ["91–180", summary.days91to180],
            ["181–365", summary.days181to365],
            ["365+", summary.days365Plus],
          ]
        : [],
    [summary],
  );
  return (
    <AuthGate>
      <div className="flex min-h-screen bg-[#f8f7f4]">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 pb-10 sm:px-6 lg:px-8">
          <TopNav />
          <div className="mx-auto max-w-[1450px]">
            <header className="mb-6">
              <p className="text-sm font-semibold text-[#4f46e5]">
                Party reports
              </p>
              <h1 className="mt-1 text-3xl font-bold text-[#182230]">
                Bill-wise Ageing
              </h1>
              <p className="mt-2 text-sm text-[#667085]">
                Outstanding invoices grouped by due-date age, calculated from
                posted party ledger entries and allocations.
              </p>
            </header>
            {error && (
              <div className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] p-3 text-sm text-[#b42318]">
                {error}
              </div>
            )}
            <section className="mb-5 grid gap-4 rounded-2xl border bg-white p-5 lg:grid-cols-[220px_1fr_180px]">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="h-11 rounded-xl border px-3"
              >
                <option value="customer">Customer</option>
                <option value="supplier">Supplier</option>
              </select>
              <select
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
                className="h-11 rounded-xl border px-3"
              >
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {p.partyCode}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="h-11 rounded-xl border px-3"
              />
            </section>
            {summary && (
              <>
                <section className="mb-5 grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
                  {buckets.map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-2xl border bg-white p-4"
                    >
                      <p className="text-xs text-[#667085]">{label}</p>
                      <p className="mt-2 font-bold">{money(Number(value))}</p>
                    </div>
                  ))}
                </section>
                <section className="mb-5 rounded-2xl border bg-white p-5">
                  <p className="text-xs uppercase font-semibold text-[#667085]">
                    Total outstanding
                  </p>
                  <p className="mt-1 text-3xl font-bold">
                    {money(summary.total)}
                  </p>
                </section>
              </>
            )}
            {loading ? (
              <div className="rounded-2xl border bg-white p-12 text-center text-sm text-[#667085]">
                Loading ageing…
              </div>
            ) : (
              <section className="overflow-hidden rounded-2xl border bg-white">
                <div className="overflow-x-auto">
                  <table className="min-w-[950px] w-full text-left">
                    <thead className="bg-[#fbfaf9] text-xs font-semibold uppercase text-[#667085]">
                      <tr>
                        <th className="px-5 py-3">Voucher</th>
                        <th className="px-5 py-3">Date</th>
                        <th className="px-5 py-3">Due date</th>
                        <th className="px-5 py-3 text-right">Original</th>
                        <th className="px-5 py-3 text-right">Allocated</th>
                        <th className="px-5 py-3 text-right">Outstanding</th>
                        <th className="px-5 py-3 text-right">Overdue days</th>
                        <th className="px-5 py-3">Bucket</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {bills.map((b) => (
                        <tr key={b.voucherNumber}>
                          <td className="px-5 py-4 font-medium">
                            {b.voucherNumber}
                          </td>
                          <td className="px-5 py-4 text-sm">{b.date}</td>
                          <td className="px-5 py-4 text-sm">{b.dueDate}</td>
                          <td className="px-5 py-4 text-right">
                            {money(b.originalAmount)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            {money(b.allocatedAmount)}
                          </td>
                          <td className="px-5 py-4 text-right font-bold">
                            {money(b.outstanding)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            {b.overdueDays}
                          </td>
                          <td className="px-5 py-4 text-sm">{b.bucket}</td>
                        </tr>
                      ))}
                      {!bills.length && (
                        <tr>
                          <td
                            colSpan={8}
                            className="p-12 text-center text-sm text-[#667085]"
                          >
                            No open bills as of this date.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
    </AuthGate>
  );
}
