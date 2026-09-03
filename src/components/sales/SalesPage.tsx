"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "@/app/Components/Sidebar/page";
import TopNav from "@/app/Components/TopNav/page";
import AuthGate from "@/app/Components/Auth/AuthGate";
import { firebaseAuth } from "@/lib/firebase";
import { useBusiness } from "@/context/BusinessContext";
import {
  createSale,
  currentFinancialYearId,
  getSalesWorkspaceData,
} from "@/application/sales/service";

type Customer = { id: string; name?: string; state?: string; address?: { state?: string }; status?: string };
type Item = { id: string; name?: string; unit?: string; salePrice?: number; taxRate?: number; stock?: number };
type BankAccount = { id: string; name?: string; code?: string; type?: string; active?: boolean };
type Line = { itemId: string; quantity: number; price: number; taxRate: number; discountPercent: number };
type Sale = { id: string; invoiceNumber?: string | number; customerName?: string | null; invoiceDate?: string; total?: number; paidAmount?: number; outstandingAmount?: number; paymentMethod?: string; paymentMode?: string; bankAccountName?: string; status?: string; accountingVoucherNumber?: string; accountingVoucherId?: string };

const emptyLine: Line = { itemId: "", quantity: 1, price: 0, taxRate: 0, discountPercent: 0 };
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
const today = () => new Date().toISOString().slice(0, 10);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export default function SalesPage() {
  const { activeBusinessId, activeBusiness, loading: businessLoading, can } = useBusiness();
  const canView = can("sales", "view"), canCreate = can("sales", "create");
  const [customers, setCustomers] = useState<Customer[]>([]), [items, setItems] = useState<Item[]>([]), [sales, setSales] = useState<Sale[]>([]), [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [search, setSearch] = useState(""), [date, setDate] = useState(today()), [customerId, setCustomerId] = useState(""), [invoiceNo, setInvoiceNo] = useState("1");
  const [paymentMode, setPaymentMode] = useState<"cash" | "bank" | "credit">("cash"), [bankAccountId, setBankAccountId] = useState(""), [received, setReceived] = useState(0), [receivedManuallyChanged, setReceivedManuallyChanged] = useState(false);
  const [discountMode, setDiscountMode] = useState<"percent" | "amount">("percent"), [discountValue, setDiscountValue] = useState(0);
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }, { ...emptyLine }]), [note, setNote] = useState("");
  const [error, setError] = useState(""), [saving, setSaving] = useState(false), [loading, setLoading] = useState(true), [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!activeBusinessId) { setCustomers([]); setItems([]); setSales([]); setBankAccounts([]); setLoading(false); return; }
    setLoading(true);
    try { const data = await getSalesWorkspaceData(activeBusinessId); setCustomers(data.customers as Customer[]); setItems(data.items as Item[]); setSales(data.sales as Sale[]); setBankAccounts((data.bankAccounts || []) as BankAccount[]); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load sales."); }
    finally { setLoading(false); }
  }, [activeBusinessId]);
  useEffect(() => { if (!businessLoading) void load(); }, [businessLoading, load]);

  const validLines = useMemo(() => lines.filter((l) => l.itemId && l.quantity > 0), [lines]);
  const subtotal = useMemo(() => validLines.reduce((s, l) => s + l.quantity * l.price, 0), [validLines]);
  const lineDiscount = useMemo(() => validLines.reduce((s, l) => s + (l.quantity * l.price * l.discountPercent) / 100, 0), [validLines]);
  const billDiscount = useMemo(() => discountMode === "percent" ? (subtotal * discountValue) / 100 : discountValue, [discountMode, discountValue, subtotal]);
  const totalDiscount = useMemo(() => Math.min(subtotal, round2(lineDiscount + billDiscount)), [subtotal, lineDiscount, billDiscount]);
  const taxable = Math.max(0, round2(subtotal - totalDiscount));
  const rates = useMemo(() => [...new Set(validLines.map((l) => Number(l.taxRate || 0)))], [validLines]);
  const taxRate = rates.length ? rates[0] : 0;
  const tax = round2((taxable * taxRate) / 100);
  const total = round2(taxable + tax);
  const paid = Math.max(0, Math.min(total, received));
  const outstanding = round2(total - paid);

  const filtered = sales.filter((s) => `${s.invoiceNumber ?? ""} ${s.customerName ?? "Cash Sale"} ${s.status ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const reset = () => {
    setDate(today()); setCustomerId(""); setInvoiceNo(String(Math.max(0, ...sales.map((s) => Number(s.invoiceNumber) || 0)) + 1)); setPaymentMode("cash"); setBankAccountId(""); setReceived(0); setReceivedManuallyChanged(false); setDiscountMode("percent"); setDiscountValue(0); setLines([{ ...emptyLine }, { ...emptyLine }]); setNote(""); setError(""); setShowForm(true);
  };
  const changePaymentMode = (mode: "cash" | "bank" | "credit") => { setPaymentMode(mode); setBankAccountId(""); setReceivedManuallyChanged(false); setReceived(mode === "credit" ? 0 : total); };
  const updateLine = (index: number, field: keyof Line, value: string) => setLines((current) => current.map((line, i) => { if (i !== index) return line; if (field === "itemId") { const item = items.find((x) => x.id === value); return { ...line, itemId: value, quantity: 1, price: Number(item?.salePrice || 0), taxRate: Number(item?.taxRate || 0), discountPercent: 0 }; } return { ...line, [field]: Math.max(0, Number(value) || 0) } as Line; }));
  useEffect(() => {
    if (!receivedManuallyChanged) setReceived(paymentMode === "credit" ? 0 : total);
    else setReceived((current) => Math.min(current, total));
  }, [total, paymentMode, receivedManuallyChanged]);

  async function save() {
    if (!activeBusinessId || !firebaseAuth?.currentUser) return setError("You must be signed in.");
    if (!canCreate) return setError("You do not have permission to create sales.");
    if (!validLines.length) return setError("Add at least one item.");
    if (rates.length > 1) return setError("Mixed GST rates are not supported in one invoice yet.");
    if (total <= 0) return setError("Sale total must be greater than zero.");
    if (paymentMode === "credit" && !customerId) return setError("Select a customer for a credit sale.");
    if (outstanding > 0 && !customerId) return setError("Select a customer when the invoice is partially paid; the balance will be receivable.");
    if (paymentMode === "bank" && paid > 0 && !bankAccountId) return setError("Select the bank account receiving the payment.");
    if (discountMode === "percent" && (discountValue < 0 || discountValue > 100)) return setError("Discount percentage must be between 0 and 100.");
    if (discountMode === "amount" && discountValue < 0) return setError("Discount amount cannot be negative.");
    if (discountMode === "amount" && billDiscount > subtotal - lineDiscount) return setError("Discount amount cannot exceed the remaining invoice value.");
    if (!/^\d+$/.test(invoiceNo)) return setError("Invoice number must contain numbers only.");
    const customer = customers.find((c) => c.id === customerId); const bank = bankAccounts.find((b) => b.id === bankAccountId);
    const businessState = String(activeBusiness?.business?.address?.state || "").trim().toLowerCase(); const customerState = String(customer?.state || customer?.address?.state || "").trim().toLowerCase();
    if (!businessState) return setError("Business state is required for GST classification.");
    if (customerId && !customerState) return setError("Customer state is required for GST classification.");
    setSaving(true); setError("");
    try {
      const documentId = crypto.randomUUID(); const lineDiscountMinor = Math.round(lineDiscount * 100); const fixedDiscountMinor = Math.round((discountMode === "amount" ? discountValue : 0) * 100);
      await createSale({ repo: null as never, ids: { next: (prefix) => `${prefix}-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } }, { businessId: activeBusinessId, userId: firebaseAuth.currentUser.uid, financialYearId: currentFinancialYearId(date), idempotencyKey: `sale-${documentId}`, permissions: ["SALE_CREATE"] }, { date, customerId: customerId || undefined, paymentMode, grossValue: Math.round(subtotal * 100), discountPercent: discountMode === "percent" ? discountValue : 0, discountAmount: lineDiscountMinor + fixedDiscountMinor, paidAmount: Math.round(paid * 100), bankAccountId: paymentMode === "bank" ? bankAccountId : undefined, taxRate, intraState: customerId ? businessState === customerState : true, accountMap: { party: "acct-debtors", sales: "acct-sales", cash: "acct-cash", bank: bankAccountId || "acct-bank", outputCgst: "acct-output-cgst", outputSgst: "acct-output-sgst", outputIgst: "acct-output-igst", outputCess: "acct-output-cess", inventory: "acct-inventory", cogs: "acct-cogs" }, itemMovements: validLines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })), narration: note, documentId, documentPayload: { invoiceNumber: invoiceNo, customerName: customer?.name || null, subtotal, lineDiscount, discountMode, discountValue, billDiscount, totalDiscount, taxableValue: taxable, taxTotal: tax, total, paidAmount: paid, outstandingAmount: outstanding, paymentMethod: paymentMode, bankAccountId: bankAccountId || null, bankAccountName: bank?.name || null, status: outstanding === 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Unpaid", note, items: validLines } });
      await load(); setShowForm(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not post sale."); }
    finally { setSaving(false); }
  }

  if (!canView) return <AuthGate><div className="p-10 text-red-600">You do not have permission to view sales.</div></AuthGate>;
  const field = "h-10 rounded-md border border-[#c9cdd2] bg-white px-3 text-sm outline-none focus:border-[#1787f2]";
  return <AuthGate><div className="flex min-h-screen bg-[#f5f7fb]"><Sidebar /><main className="min-w-0 flex-1 px-5 pb-10 sm:px-8 lg:px-10"><TopNav />{error && <div className="my-3 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}{!showForm ? <section className="px-4 pb-6 sm:px-6 lg:px-8"><div className="mb-4 flex items-center justify-between"><div><h1 className="text-2xl font-bold text-[#243244]">Sales</h1><p className="text-sm text-[#737d88]">Sales invoices through the Application Layer + Accounting Core</p></div>{canCreate && <button onClick={reset} className="rounded-lg bg-[#1787f2] px-5 py-2.5 text-sm font-semibold text-white">+ Add Sale</button>}</div><div className="overflow-hidden rounded-lg border bg-white"><div className="border-b bg-[#f7f8f9] p-3"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice / party" className={`${field} w-full max-w-md`} /></div><div className="overflow-x-auto"><table className="min-w-[1100px] w-full text-sm"><thead className="bg-[#eef0f2] text-left text-xs uppercase text-[#596572]"><tr>{["Date","Invoice","Party","Payment","Paid","Outstanding","Total","Voucher"].map((h) => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={8} className="p-12 text-center">Loading…</td></tr> : filtered.length === 0 ? <tr><td colSpan={8} className="p-12 text-center">No sales found.</td></tr> : filtered.map((s) => <tr key={s.id} className="border-t"><td className="px-3 py-3">{s.invoiceDate || "—"}</td><td className="px-3 py-3 font-semibold">{s.invoiceNumber || "—"}</td><td className="px-3 py-3">{s.customerName || "Cash Sale"}</td><td className="px-3 py-3">{s.paymentMethod || s.paymentMode || "—"}{s.bankAccountName && <div className="text-xs text-slate-500">{s.bankAccountName}</div>}</td><td className="px-3 py-3 text-right">{money(Number(s.paidAmount || 0) / 100)}</td><td className="px-3 py-3 text-right">{money(Number(s.outstandingAmount || 0) / 100)}</td><td className="px-3 py-3 text-right">{money(Number(s.total || 0) / 100)}</td><td className="px-3 py-3 font-mono text-xs">{s.accountingVoucherNumber || s.accountingVoucherId || "—"}</td></tr>)}</tbody></table></div></div></section> : <section><div className="flex h-10 items-center border-b bg-[#eef0f2]"><button onClick={() => setShowForm(false)} className="border-r bg-white px-4 text-sm">Sales List</button><span className="px-4 text-sm font-semibold">New Sales Invoice</span></div><div className="bg-white px-4 pb-28 pt-7 sm:px-6"><div className="grid gap-5 lg:grid-cols-3"><label className="text-xs text-[#697586]">Customer<select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`${field} mt-1 w-full`}><option value="">Cash Sale / Walk-in</option>{customers.filter((c) => c.status !== "inactive").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="text-xs text-[#697586]">Invoice Number<input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value.replace(/\D/g, ""))} className={`${field} mt-1 w-full`} /></label><label className="text-xs text-[#697586]">Invoice Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1 w-full`} /></label></div><div className="mt-8 overflow-x-auto border"><table className="w-full min-w-[950px] text-sm"><thead className="bg-[#f5f6f7]"><tr>{["#","ITEM","QTY","UNIT","PRICE","DISC %","TAX %","AMOUNT"].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{lines.map((l, i) => <tr key={i} className="border-t"><td className="p-2 text-center">{i + 1}</td><td className="p-1"><select value={l.itemId} onChange={(e) => updateLine(i, "itemId", e.target.value)} className="h-9 w-full"><option value="">Select item</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td><td className="p-1"><input type="text" min="1" value={l.quantity} onChange={(e) => updateLine(i, "quantity", e.target.value)} className="h-9 w-full text-right" /></td><td className="p-2">{items.find((x) => x.id === l.itemId)?.unit || "NONE"}</td><td className="p-1"><input type="text" min="0" value={l.price} onChange={(e) => updateLine(i, "price", e.target.value)} className="h-9 w-full text-right" /></td><td className="p-1"><input type="number" min="0" max="100" step="0.01" value={l.discountPercent} onChange={(e) => updateLine(i, "discountPercent", e.target.value)} className="h-9 w-full text-right" /></td><td className="p-1"><input type="number" min="0" max="100" step="0.01" value={l.taxRate} onChange={(e) => updateLine(i, "taxRate", e.target.value)} className="h-9 w-full text-right" /></td><td className="p-2 text-right font-medium">{money(Math.max(0, l.quantity * l.price - (l.quantity * l.price * l.discountPercent) / 100) * (1 + l.taxRate / 100))}</td></tr>)}</tbody></table></div><button onClick={() => setLines((x) => [...x, { ...emptyLine }])} className="mt-3 rounded border border-blue-300 px-3 py-1.5 text-xs text-blue-600">ADD ROW</button><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]"><div className="rounded-lg border bg-[#fafbfc] p-4"><h3 className="font-semibold">Payment & Discount Details</h3><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-xs">Payment Mode<select value={paymentMode} onChange={(e) => changePaymentMode(e.target.value as typeof paymentMode)} className={`${field} mt-1 w-full`}><option value="cash">Cash</option><option value="bank">Bank</option><option value="credit">Credit</option></select></label>{paymentMode === "bank" ? <label className="text-xs">Receiving Bank Account<select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} className={`${field} mt-1 w-full`}><option value="">Select bank account</option>{bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name || b.id}{b.code ? ` — ${b.code}` : ""}</option>)}</select></label> : <div />}</div><div className="mt-4 grid gap-4 sm:grid-cols-[140px_1fr]"><label className="text-xs">Discount Type<select value={discountMode} onChange={(e) => setDiscountMode(e.target.value as typeof discountMode)} className={`${field} mt-1 w-full`}><option value="percent">Percentage (%)</option><option value="amount">Amount (₹)</option></select></label><label className="text-xs">Discount {discountMode === "percent" ? "%" : "Amount"}<input type="number" min="0" max={discountMode === "percent" ? 100 : undefined} step="0.01" value={discountValue} onChange={(e) => setDiscountValue(Math.max(0, Number(e.target.value) || 0))} className={`${field} mt-1 w-full`} /></label></div><div className="mt-4 rounded border bg-white p-3"><label className="text-xs">Amount Received<input type="number" min="0" max={total} step="0.01" value={received} onChange={(e) => { setReceivedManuallyChanged(true); setReceived(Math.max(0, Math.min(total, Number(e.target.value) || 0))); }} className={`${field} mt-1 w-full`} /></label><p className="mt-2 text-xs text-slate-500">Defaults to the full invoice total. Change it to any lower amount for a partial payment; the remaining balance becomes customer receivable.</p></div><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add description" className="mt-4 h-20 w-full rounded border p-3 text-sm" /></div><div className="rounded-lg border bg-white p-5"><div className="flex justify-between py-1"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="flex justify-between py-1"><span>Item Discount</span><b>{money(lineDiscount)}</b></div><div className="flex justify-between py-1"><span>Bill Discount</span><b>{money(billDiscount)}</b></div><div className="flex justify-between py-1"><span>Total Discount</span><b>{money(totalDiscount)}</b></div><div className="flex justify-between py-1"><span>Taxable</span><b>{money(taxable)}</b></div><div className="flex justify-between py-1"><span>Tax</span><b>{money(tax)}</b></div><div className="mt-3 flex justify-between border-t pt-3 text-lg"><span>Total</span><b>{money(total)}</b></div><div className="mt-1 flex justify-between text-sm"><span>Received</span><b>{money(paid)}</b></div><div className="flex justify-between text-sm"><span>Outstanding</span><b>{money(outstanding)}</b></div>{paymentMode === "bank" && bankAccountId && <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-600">Credited to: <b>{bankAccounts.find((b) => b.id === bankAccountId)?.name || bankAccountId}</b></div>}<button disabled={saving} onClick={save} className="mt-5 w-full rounded-lg bg-[#1787f2] py-3 font-semibold text-white disabled:opacity-50">{saving ? "Posting…" : "POST SALE"}</button></div></div></div></section>}</main></div></AuthGate>;
}
