"use client";
import { useEffect, useMemo, useState } from "react";
import Sidebar from "../../../Components/Sidebar/page";
import TopNav from "../../../Components/TopNav/page";
import AuthGate from "../../../Components/Auth/AuthGate";
import { auth } from "../../../../lib/firebase";
import { useBusiness } from "../../../../context/BusinessContext";
type Row = {
  id: string;
  partyCode: string;
  name: string;
  phone: string;
  debit: number;
  credit: number;
  net: number;
  outstanding: number;
  side: string;
  creditLimit: number;
  status: string;
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
export default function OutstandingPage() {
  const { activeBusinessId } = useBusiness();
  const [kind, setKind] = useState<"customer" | "supplier">("customer");
  const [rows, setRows] = useState<Row[]>([]);
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    async function load() {
      if (!activeBusinessId) return;
      try {
        setLoading(true);
        const t = await token();
        const r = await fetch(
          `/api/parties/outstanding?businessId=${encodeURIComponent(activeBusinessId)}&kind=${kind}&asOf=${asOf}`,
          { headers: { Authorization: `Bearer ${t}` }, cache: "no-store" },
        );
        const b = await r.json();
        if (!r.ok) throw new Error(b.error || "Could not load outstanding.");
        setRows(b.rows || []);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not load outstanding.",
        );
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [activeBusinessId, kind, asOf]);
  const visible = useMemo(() => {
    const x = q.trim().toLowerCase();
    return x
      ? rows.filter((r) =>
          [r.name, r.partyCode, r.phone].join(" ").toLowerCase().includes(x),
        )
      : rows;
  }, [rows, q]);
  const total = useMemo(
    () => rows.reduce((s, r) => s + r.outstanding, 0),
    [rows],
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
                Outstanding
              </h1>
              <p className="mt-2 text-sm text-[#667085]">
                Receivables and payables from the authoritative accounting
                ledger.
              </p>
            </header>
            {error && (
              <div className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] p-3 text-sm text-[#b42318]">
                {error}
              </div>
            )}
            <section className="mb-5 grid gap-4 rounded-2xl border bg-white p-5 lg:grid-cols-[220px_180px_1fr]">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
                className="h-11 rounded-xl border px-3"
              >
                <option value="customer">Customer Receivables</option>
                <option value="supplier">Supplier Payables</option>
              </select>
              <input
                type="date"
                value={asOf}
                onChange={(e) => setAsOf(e.target.value)}
                className="h-11 rounded-xl border px-3"
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search party"
                className="h-11 rounded-xl border px-3"
              />
            </section>
            <section className="mb-5 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border bg-white p-5">
                <p className="text-xs text-[#667085]">Total outstanding</p>
                <p className="mt-2 text-2xl font-bold">{money(total)}</p>
              </div>
              <div className="rounded-2xl border bg-white p-5">
                <p className="text-xs text-[#667085]">Open parties</p>
                <p className="mt-2 text-2xl font-bold">{rows.length}</p>
              </div>
              <div className="rounded-2xl border bg-white p-5">
                <p className="text-xs text-[#667085]">As of</p>
                <p className="mt-2 text-2xl font-bold">{asOf}</p>
              </div>
            </section>
            <section className="overflow-hidden rounded-2xl border bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-[900px] w-full text-left">
                  <thead className="bg-[#fbfaf9] text-xs font-semibold uppercase text-[#667085]">
                    <tr>
                      <th className="px-5 py-3">Party</th>
                      <th className="px-5 py-3">Phone</th>
                      <th className="px-5 py-3 text-right">Debit</th>
                      <th className="px-5 py-3 text-right">Credit</th>
                      <th className="px-5 py-3 text-right">Outstanding</th>
                      <th className="px-5 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {loading ? (
                      <tr>
                        <td colSpan={6} className="p-12 text-center">
                          Loading…
                        </td>
                      </tr>
                    ) : (
                      visible.map((r) => (
                        <tr key={r.id}>
                          <td className="px-5 py-4">
                            <b>{r.name}</b>
                            <span className="ml-2 text-xs text-[#98a2b3]">
                              {r.partyCode}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-sm">
                            {r.phone || "—"}
                          </td>
                          <td className="px-5 py-4 text-right">
                            {money(r.debit)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            {money(r.credit)}
                          </td>
                          <td className="px-5 py-4 text-right font-bold">
                            {money(r.outstanding)}
                          </td>
                          <td className="px-5 py-4 text-sm">{r.status}</td>
                        </tr>
                      ))
                    )}
                    {!loading && !visible.length && (
                      <tr>
                        <td
                          colSpan={6}
                          className="p-12 text-center text-sm text-[#667085]"
                        >
                          No outstanding balance.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </main>
      </div>
    </AuthGate>
  );
}
