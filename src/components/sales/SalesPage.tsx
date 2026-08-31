"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs } from "firebase/firestore";
import Sidebar from "@/app/Components/Sidebar/page";
import TopNav from "@/app/Components/TopNav/page";
import AuthGate from "@/app/Components/Auth/AuthGate";
import { firebaseAuth, firestoreDb } from "@/lib/firebase";
import { useBusiness } from "@/context/BusinessContext";
import { createSale } from "@/application/sales/service";

type Customer = { id: string; name?: string; state?: string; address?: { state?: string }; status?: string };
type Item = { id: string; name?: string; unit?: string; salePrice?: number; purchasePrice?: number; taxRate?: number; stock?: number };
type Line = { itemId: string; quantity: number; price: number; taxRate: number; discountPercent: number };
type Sale = { id: string; invoiceNumber?: string | number; customerId?: string | null; customerName?: string | null; invoiceDate?: string; total?: number; paidAmount?: number; outstandingAmount?: number; paymentMethod?: string; status?: string; accountingVoucherNumber?: string; accountingVoucherId?: string };

const emptyLine: Line = { itemId: "", quantity: 1, price: 0, taxRate: 0, discountPercent: 0 };
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
const today = () => new Date().toISOString().slice(0, 10);

export default function SalesPage() {
  const { activeBusinessId, activeBusiness, loading: businessLoading, can } = useBusiness();
  const canView = can("sales", "view");
  const canCreate = can("sales", "create");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(today());
  const [customerId, setCustomerId] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("1");
  const [paymentMode, setPaymentMode] = useState<"cash" | "bank" | "credit">("cash");
  const [received, setReceived] = useState(0);
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }, { ...emptyLine }]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!firestoreDb || !activeBusinessId) {
      setCustomers([]);
      setItems([]);
      setSales([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const businessRef = doc(firestoreDb, "businesses", activeBusinessId);
      const [customerSnap, itemSnap, salesSnap] = await Promise.all([
        getDocs(collection(businessRef, "customers")),
        getDocs(collection(businessRef, "items")),
        getDocs(collection(businessRef, "sales")),
      ]);
      setCustomers(customerSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Customer[]);
      setItems(itemSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Item[]);
      setSales(salesSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as Sale[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load sales.");
    } finally {
      setLoading(false);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    if (!businessLoading) void load();
  }, [businessLoading, load]);

  const validLines = useMemo(() => lines.filter((line) => line.itemId && line.quantity > 0), [lines]);
  const subtotal = useMemo(() => validLines.reduce((sum, line) => sum + line.quantity * line.price, 0), [validLines]);
  const discount = useMemo(() => validLines.reduce((sum, line) => sum + line.quantity * line.price * line.discountPercent / 100, 0), [validLines]);
  const taxable = Math.max(0, subtotal - discount);
  const taxRate = validLines.length ? Number(validLines[0].taxRate || 0) : 0;
  const tax = Math.round(taxable * taxRate / 100 * 100) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;
  const paid = paymentMode === "cash" || paymentMode === "bank" ? total : Math.max(0, Math.min(total, received));
  const outstanding = Math.max(0, total - paid);

  const filtered = sales.filter((sale) => `${sale.invoiceNumber ?? ""} ${sale.customerName ?? "Cash Sale"} ${sale.status ?? ""}`.toLowerCase().includes(search.toLowerCase()));

  const reset = () => {
    setDate(today());
    setCustomerId("");
    setInvoiceNo(String(Math.max(0, ...sales.map((sale) => Number(sale.invoiceNumber) || 0)) + 1));
    setPaymentMode("cash");
    setReceived(0);
    setLines([{ ...emptyLine }, { ...emptyLine }]);
    setNote("");
    setError("");
    setShowForm(true);
  };

  const updateLine = (index: number, field: keyof Line, value: string) => {
    setLines((current) => current.map((line, i) => {
      if (i !== index) return line;
      if (field === "itemId") {
        const item = items.find((candidate) => candidate.id === value);
        return { ...line, itemId: value, quantity: 1, price: Number(item?.salePrice || 0), taxRate: Number(item?.taxRate || 0), discountPercent: 0 };
      }
      return { ...line, [field]: Math.max(0, Number(value) || 0) };
    }));
  };

  async function save() {
    if (!firestoreDb || !activeBusinessId || !firebaseAuth?.currentUser) return setError("You must be signed in.");
    if (!canCreate) return setError("You do not have permission to create sales.");
    if (!validLines.length) return setError("Add at least one item.");
    if (validLines.some((line) => line.taxRate !== taxRate)) return setError("Mixed GST rates are not supported in one invoice yet.");
    if (total <= 0) return setError("Sale total must be greater than zero.");
    if (paymentMode === "credit" && !customerId) return setError("Select a customer for a credit sale.");
    const customer = customers.find((candidate) => candidate.id === customerId);
    const businessState = String(activeBusiness?.business?.address?.state || "").trim().toLowerCase();
    const customerState = String(customer?.state || customer?.address?.state || "").trim().toLowerCase();
    if (!businessState) return setError("Business state is required for GST classification.");
    if (customerId && !customerState) return setError("Customer state is required for GST classification.");
    setSaving(true);
    setError("");
    try {
      const documentId = crypto.randomUUID();
      const idempotencyKey = `sale-${documentId}`;
      await createSale(
        { repo: null as never, ids: { next: (prefix) => `${prefix}-${crypto.randomUUID()}` }, clock: { now: () => new Date().toISOString() } },
        { businessId: activeBusinessId, userId: firebaseAuth.currentUser.uid, financialYearId: "", idempotencyKey, permissions: ["SALE_CREATE"] },
        {
          date,
          customerId: customerId || undefined,
          paymentMode,
          grossValue: Math.round(subtotal * 100),
          discountAmount: Math.round(discount * 100),
          paidAmount: Math.round(paid * 100),
          taxRate,
          intraState: customerId ? businessState === customerState : true,
          accountMap: { party: "acct-debtors", sales: "acct-sales", cash: "acct-cash", bank: "acct-bank", outputCgst: "acct-output-cgst", outputSgst: "acct-output-sgst", outputIgst: "acct-output-igst", outputCess: "acct-output-cess", inventory: "acct-inventory", cogs: "acct-cogs" },
          itemMovements: validLines.map((line) => ({ itemId: line.itemId, quantity: line.quantity })),
          narration: note,
          documentId,
          documentPayload: { invoiceNumber: invoiceNo, customerName: customer?.name || null, subtotal, discount, taxable, tax, total, paidAmount: paid, outstandingAmount: outstanding, paymentMethod: paymentMode, status: outstanding > 0 ? "Partially Paid" : "Paid", note, items: validLines },
        },
      );
      await load();
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not post sale.");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <AuthGate><div className="p-10 text-red-600">You do not have permission to view sales.</div></AuthGate>;
  const field = "h-10 rounded-md border border-[#c9cdd2] bg-white px-3 text-sm outline-none focus:border-[#1787f2]";

  return <AuthGate><div className="flex min-h-screen bg-[#f5f7fb]"><Sidebar /><main className="min-w-0 flex-1 px-5 pb-10 sm:px-8 lg:px-10"><TopNav />{error && <div className="my-3 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}{!showForm ? <section className="px-4 pb-6 sm:px-6 lg:px-8"><div className="mb-4 flex items-center justify-between"><div><h1 className="text-2xl font-bold text-[#243244]">Sales</h1><p className="text-sm text-[#737d88]">Sales invoices through the Application Layer + Accounting Core</p></div>{canCreate && <button onClick={reset} className="rounded-lg bg-[#1787f2] px-5 py-2.5 text-sm font-semibold text-white">+ Add Sale</button>}</div><div className="overflow-hidden rounded-lg border bg-white"><div className="border-b bg-[#f7f8f9] p-3"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice / party" className={`${field} w-full max-w-md`} /></div><div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-sm"><thead className="bg-[#eef0f2] text-left text-xs uppercase text-[#596572]"><tr>{["Date", "Invoice", "Party", "Payment", "Paid", "Outstanding", "Total", "Voucher"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={8} className="p-12 text-center">Loading…</td></tr> : filtered.length === 0 ? <tr><td colSpan={8} className="p-12 text-center">No sales found.</td></tr> : filtered.map((sale) => <tr key={sale.id} className="border-t"><td className="px-3 py-3">{sale.invoiceDate || "—"}</td><td className="px-3 py-3 font-semibold">{sale.invoiceNumber || "—"}</td><td className="px-3 py-3">{sale.customerName || "Cash Sale"}</td><td className="px-3 py-3">{sale.paymentMethod || "—"}</td><td className="px-3 py-3 text-right">{money(Number(sale.paidAmount || 0))}</td><td className="px-3 py-3 text-right">{money(Number(sale.outstandingAmount || 0))}</td><td className="px-3 py-3 text-right">{money(Number(sale.total || 0))}</td><td className="px-3 py-3 font-mono text-xs">{sale.accountingVoucherNumber || sale.accountingVoucherId || "—"}</td></tr>)}</tbody></table></div></div></section> : <section><div className="flex h-10 items-center border-b bg-[#eef0f2]"><button onClick={() => setShowForm(false)} className="border-r bg-white px-4 text-sm">Sales List</button><span className="px-4 text-sm font-semibold">New Sales Invoice</span></div><div className="bg-white px-4 pb-28 pt-7 sm:px-6"><div className="grid gap-5 lg:grid-cols-3"><label className="text-xs text-[#697586]">Customer<select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={`${field} mt-1 w-full`}><option value="">Cash Sale / Walk-in</option>{customers.filter((customer) => customer.status !== "inactive").map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="text-xs text-[#697586]">Invoice Number<input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value.replace(/\D/g, ""))} className={`${field} mt-1 w-full`} /></label><label className="text-xs text-[#697586]">Invoice Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${field} mt-1 w-full`} /></label></div><div className="mt-8 overflow-x-auto border"><table className="min-w-[900px] w-full text-sm"><thead className="bg-[#f5f6f7]"><tr>{["#", "ITEM", "QTY", "UNIT", "PRICE", "DISC %", "TAX %", "AMOUNT"].map((heading) => <th key={heading} className="p-2">{heading}</th>)}</tr></thead><tbody>{lines.map((line, index) => <tr key={index} className="border-t"><td className="p-2 text-center">{index + 1}</td><td className="p-1"><select value={line.itemId} onChange={(e) => updateLine(index, "itemId", e.target.value)} className="h-9 w-full"><option value="">Select item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></td><td className="p-1"><input type="number" min="1" value={line.quantity} onChange={(e) => updateLine(index, "quantity", e.target.value)} className="h-9 w-full text-right" /></td><td className="p-2">{items.find((item) => item.id === line.itemId)?.unit || "NONE"}</td><td className="p-1"><input type="number" min="0" value={line.price} onChange={(e) => updateLine(index, "price", e.target.value)} className="h-9 w-full text-right" /></td><td className="p-1"><input type="number" min="0" max="100" value={line.discountPercent} onChange={(e) => updateLine(index, "discountPercent", e.target.value)} className="h-9 w-full text-right" /></td><td className="p-1"><input type="number" min="0" value={line.taxRate} onChange={(e) => updateLine(index, "taxRate", e.target.value)} className="h-9 w-full text-right" /></td><td className="p-2 text-right font-medium">{money(Math.max(0, line.quantity * line.price - line.quantity * line.price * line.discountPercent / 100) * (1 + line.taxRate / 100))}</td></tr>)}</tbody></table></div><button onClick={() => setLines((current) => [...current, { ...emptyLine }])} className="mt-3 rounded border border-blue-300 px-3 py-1.5 text-xs text-blue-600">ADD ROW</button><div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]"><div className="rounded-lg border bg-[#fafbfc] p-4"><h3 className="font-semibold">Payment Details</h3><label className="mt-4 block text-xs">Payment Mode<select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as typeof paymentMode)} className={`${field} mt-1 w-full`}><option value="cash">Cash</option><option value="bank">Online / Bank</option><option value="credit">Credit</option></select></label><label className="mt-4 block text-xs">Amount Received<input type="number" min="0" max={total} value={received} onChange={(e) => setReceived(Math.max(0, Number(e.target.value) || 0))} className={`${field} mt-1 w-full`} /></label><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add description" className="mt-4 h-20 w-full rounded border p-3 text-sm" /></div><div className="rounded-lg border bg-white p-5"><div className="flex justify-between py-1"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="flex justify-between py-1"><span>Discount</span><b>{money(discount)}</b></div><div className="flex justify-between py-1"><span>Tax</span><b>{money(tax)}</b></div><div className="mt-3 flex justify-between border-t pt-3 text-lg"><span>Total</span><b>{money(total)}</b></div><button disabled={saving} onClick={save} className="mt-5 w-full rounded-lg bg-[#1787f2] py-3 font-semibold text-white disabled:opacity-50">{saving ? "Posting…" : "POST SALE"}</button></div></div></div></section>}</main></div></AuthGate>;
}
