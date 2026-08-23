"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import type { ChangeEvent } from "react";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { firestoreDb } from "../../lib/firebase";
import { useBusiness } from "../../context/BusinessContext";

type Customer = { id: string; name?: string; phone?: string; address?: string; balance?: number; status?: string };
type Item = { id: string; name?: string; unit?: string; salePrice?: number; stock?: number; code?: string };
type SaleLine = { itemId: string; name: string; unit: string; quantity: number; price: number; discount: number; stock: number };
type Sale = { id: string; invoiceNumber?: string; customerId?: string | null; customerName?: string; invoiceDate?: string; total?: number; paid?: number; balance?: number; paymentMethod?: string; status?: string; items?: SaleLine[]; note?: string; createdAt?: unknown };
type FormLine = Omit<SaleLine, "stock">;

const emptyLine: FormLine = { itemId: "", name: "", unit: "Piece", quantity: 1, price: 0, discount: 0 };
const money = (value: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value);
const today = () => new Date().toISOString().slice(0, 10);
const nextInvoiceNumber = (sales: Sale[]) => {
  const numeric = sales.map((sale) => Number(String(sale.invoiceNumber || "").trim())).filter((value) => Number.isInteger(value) && value > 0);
  return String((numeric.length ? Math.max(...numeric) : 1000) + 1);
};

export default function SalesPage() {
  const { activeBusinessId, loading: businessLoading } = useBusiness();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [mode, setMode] = useState<"list" | "invoice">("list");
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("1001");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [paymentMethod, setPaymentMethod] = useState("Credit");
  const [received, setReceived] = useState("0");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<FormLine[]>([{ ...emptyLine }]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    if (businessLoading) return;
    if (!firestoreDb) { setError("Firebase is not configured. Check your .env.local file."); setLoading(false); return; }
    if (!activeBusinessId) { setCustomers([]); setItems([]); setSales([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const businessRef = doc(firestoreDb, "businesses", activeBusinessId);
      const [customerSnapshot, itemSnapshot, salesSnapshot] = await Promise.all([
        getDocs(collection(businessRef, "customers")),
        getDocs(collection(businessRef, "items")),
        getDocs(collection(businessRef, "sales")),
      ]);
      setCustomers(customerSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) as Customer[]);
      setItems(itemSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) as Item[]);
      const loadedSales = salesSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })) as Sale[];
      loadedSales.sort((a, b) => String(b.invoiceDate || "").localeCompare(String(a.invoiceDate || "")));
      setSales(loadedSales);
    } catch (reason) { console.error(reason); setError("Could not load sales. Check Firestore rules and your business membership."); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, [activeBusinessId, businessLoading]);

  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const validLines = lines.filter((line) => line.itemId && line.quantity > 0);
  const subtotal = useMemo(() => validLines.reduce((sum, line) => sum + line.quantity * line.price, 0), [validLines]);
  const discount = useMemo(() => validLines.reduce((sum, line) => sum + line.discount, 0), [validLines]);
  const total = Math.max(0, subtotal - discount);
  const receivedAmount = Math.max(0, Math.min(total, Number(received) || 0));
  const balance = Math.max(0, total - receivedAmount);
  const filteredSales = useMemo(() => sales.filter((sale) => `${sale.invoiceNumber} ${sale.customerName} ${sale.status}`.toLowerCase().includes(query.toLowerCase())), [sales, query]);
  const totals = useMemo(() => ({ count: sales.length, revenue: sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0), outstanding: sales.reduce((sum, sale) => sum + Number(sale.balance || 0), 0) }), [sales]);

  const updateLine = (index: number, field: keyof FormLine, value: string) => {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      if (field === "itemId") {
        const item = items.find((entry) => entry.id === value);
        return { ...line, itemId: value, name: item?.name || "", unit: item?.unit || "Piece", price: Number(item?.salePrice || 0), quantity: 1 };
      }
      if (field === "quantity" || field === "price" || field === "discount") return { ...line, [field]: Math.max(0, Number(value) || 0) };
      return { ...line, [field]: value };
    }));
  };

  const openNew = () => {
    setCustomerId("");
    setInvoiceNumber(nextInvoiceNumber(sales));
    setInvoiceDate(today());
    setPaymentMethod("Credit");
    setReceived("0");
    setNote("");
    setLines([{ ...emptyLine }]);
    setSelectedSale(null);
    setError("");
    setMode("invoice");
  };

  const saveInvoice = async () => {
    if (!firestoreDb || !activeBusinessId) { setError("Select a business before creating a sale."); return; }
    const normalizedInvoiceNumber = invoiceNumber.trim();
    if (!/^\d+$/.test(normalizedInvoiceNumber)) { setError("Invoice number must contain numbers only."); return; }
    if (sales.some((sale) => String(sale.invoiceNumber || "").trim() === normalizedInvoiceNumber)) { setError(`Invoice number ${normalizedInvoiceNumber} already exists in this business.`); return; }
    if (!validLines.length) { setError("Add at least one item to the invoice."); return; }
    for (const line of validLines) {
      const item = items.find((entry) => entry.id === line.itemId);
      if (!item) { setError("One of the selected items is no longer available."); return; }
      if (line.quantity > Number(item.stock || 0)) { setError(`${item.name || "Item"} has only ${Number(item.stock || 0)} ${item.unit || "units"} available.`); return; }
    }

    setSaving(true); setError("");
    try {
      const businessRef = doc(firestoreDb, "businesses", activeBusinessId);
      const saleRef = doc(collection(businessRef, "sales"));
      const saleLines: SaleLine[] = validLines.map((line) => ({ ...line, stock: Number(items.find((item) => item.id === line.itemId)?.stock || 0) }));

      await runTransaction(firestoreDb, async (transaction) => {
        const itemDocs = new Map<string, ReturnType<typeof doc>>();
        const itemSnapshots = new Map<string, any>();
        for (const line of saleLines) {
          const itemRef = doc(businessRef, "items", line.itemId);
          itemDocs.set(line.itemId, itemRef);
          itemSnapshots.set(line.itemId, await transaction.get(itemRef));
        }
        let customerSnapshot: any = null;
        let customerRef: ReturnType<typeof doc> | null = null;
        if (customerId) { customerRef = doc(businessRef, "customers", customerId); customerSnapshot = await transaction.get(customerRef); }

        for (const line of saleLines) {
          const snapshot = itemSnapshots.get(line.itemId);
          if (!snapshot?.exists()) throw new Error(`Item ${line.name || line.itemId} no longer exists.`);
          const currentStock = Number(snapshot.data().stock || 0);
          if (line.quantity > currentStock) throw new Error(`${line.name || "Item"} has only ${currentStock} available.`);
          transaction.update(itemDocs.get(line.itemId)!, { stock: currentStock - line.quantity, updatedAt: serverTimestamp() });
        }
        const currentCustomerBalance = Number(customerSnapshot?.data()?.balance || 0);
        if (customerRef && customerSnapshot?.exists() && balance > 0) transaction.update(customerRef, { balance: currentCustomerBalance + balance, updatedAt: serverTimestamp() });
        if (customerRef && customerSnapshot?.exists() && balance === 0 && receivedAmount > 0) transaction.update(customerRef, { updatedAt: serverTimestamp() });

        transaction.set(saleRef, {
          saleId: saleRef.id,
          invoiceNumber: normalizedInvoiceNumber,
          customerId: customerId || null,
          customerName: selectedCustomer?.name || "Walk-in customer",
          invoiceDate,
          items: saleLines,
          subtotal,
          discount,
          total,
          paid: receivedAmount,
          balance,
          paymentMethod,
          status: balance === 0 ? "Paid" : receivedAmount > 0 ? "Partially Paid" : "Unpaid",
          note: note.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });

      await loadData();
      setMode("list");
    } catch (reason) { console.error(reason); setError(reason instanceof Error ? reason.message : "Could not save invoice."); }
    finally { setSaving(false); }
  };

  const printInvoice = (sale: Sale) => {
    const rows = (sale.items || []).map((line) => `<tr><td>${line.name || "Item"}</td><td>${line.quantity}</td><td>${money(Number(line.price || 0))}</td><td>${money(Math.max(0, line.quantity * line.price - line.discount))}</td></tr>`).join("");
    const html = `<!doctype html><html><head><title>Invoice ${sale.invoiceNumber || ""}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#182230}h1{margin:0 0 6px}p{margin:4px 0;color:#667085}.top{display:flex;justify-content:space-between;margin-bottom:28px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:24px}table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #ddd;text-align:left}th{background:#f5f5f5}.totals{margin-left:auto;width:280px;margin-top:22px}.row{display:flex;justify-content:space-between;padding:6px 0}.grand{font-size:18px;font-weight:700;border-top:2px solid #182230;padding-top:10px}</style></head><body><div class='top'><div><h1>Sales Invoice</h1><p>${sale.customerName || "Walk-in customer"}</p></div><div><p><strong>Invoice #${sale.invoiceNumber || ""}</strong></p><p>${sale.invoiceDate || ""}</p></div></div><div class='meta'><div><strong>Customer</strong><br/>${sale.customerName || "Walk-in customer"}</div><div><strong>Status</strong><br/>${sale.status || "Unpaid"}</div></div><table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class='totals'><div class='row'><span>Subtotal</span><span>${money(Number(sale.subtotal || 0))}</span></div><div class='row'><span>Discount</span><span>- ${money(Number(sale.discount || 0))}</span></div><div class='row grand'><span>Total</span><span>${money(Number(sale.total || 0))}</span></div><div class='row'><span>Paid</span><span>${money(Number(sale.paid || 0))}</span></div><div class='row'><span>Balance</span><span>${money(Number(sale.balance || 0))}</span></div></div><p style='margin-top:40px'>Thank you for your business.</p><script>window.print()</script></body></html>`;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(html); win.document.close();
  };

  return <AuthGate>
    <div className="flex min-h-screen bg-[#f8f7f4]"><Sidebar/><main className="min-w-0 flex-1 px-4 pb-10 pt-0 sm:px-6 lg:px-8"><TopNav/><div className="mx-auto max-w-[1450px]">
      {mode === "list" ? <>
        <section className="mb-7 flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><p className="text-sm font-semibold text-[#4f46e5]">Sales workspace</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-[#182230]">Sales</h1><p className="mt-2 max-w-xl text-sm text-[#667085]">Create invoices, track payments, and keep stock and customer balances connected.</p></div><button type="button" onClick={openNew} disabled={!activeBusinessId} className="inline-flex h-10 items-center justify-center rounded-xl bg-[#4f46e5] px-5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(79,70,229,.22)] hover:bg-[#4338ca] disabled:opacity-50">+ New invoice</button></section>
        {error && <div className="mb-5 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
        <section className="mb-7 grid gap-4 sm:grid-cols-3">{[[String(totals.count),"Invoices","Sales documents","text-[#4f46e5]"],[money(totals.revenue),"Sales value","Gross invoice total","text-[#168361]"],[money(totals.outstanding),"Outstanding","Customer balances created","text-[#b7791f]"]].map(([value,label,note,tone])=><article key={label} className="rounded-2xl border border-[#e7e5e4] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)]"><p className="text-sm font-medium text-[#667085]">{label}</p><p className={`mt-3 text-2xl font-bold tracking-tight ${tone}`}>{value}</p><p className="mt-1 text-xs text-[#98a2b3]">{note}</p></article>)}</section>
        <section className="overflow-hidden rounded-2xl border border-[#e7e5e4] bg-white shadow-[0_3px_10px_rgba(16,24,40,.04)]"><div className="flex flex-col justify-between gap-4 border-b border-[#eaecf0] p-5 lg:flex-row lg:items-center"><div><h2 className="font-bold text-[#182230]">Sales invoices</h2><p className="mt-1 text-sm text-[#667085]">{filteredSales.length} invoice{filteredSales.length===1?"":"s"} shown</p></div><label className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]">⌕</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search invoice or customer" className="h-10 w-full rounded-xl border border-[#d0d5dd] pl-9 pr-3 text-sm outline-none focus:border-[#4f46e5] sm:w-72"/></label></div>
          {businessLoading||loading?<p className="p-16 text-center text-sm text-[#667085]">Loading sales…</p>:!activeBusinessId?<div className="p-16 text-center text-sm text-[#667085]">Select a business to view sales.</div>:filteredSales.length===0?<div className="flex min-h-80 flex-col items-center justify-center p-10 text-center"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#eeedff] text-[#4f46e5]">₹</div><h3 className="mt-4 font-bold text-[#182230]">No sales invoices yet</h3><p className="mt-2 max-w-sm text-sm text-[#667085]">Create your first invoice using the customers and items already configured.</p><button onClick={openNew} className="mt-5 text-sm font-bold text-[#4f46e5]">Create invoice</button></div>:<div className="overflow-x-auto"><table className="min-w-[850px] w-full text-left"><thead className="bg-[#fbfaf9] text-xs font-semibold uppercase tracking-wide text-[#667085]"><tr>{["Invoice","Customer","Date","Total","Paid","Balance","Status"].map((heading)=><th key={heading} className="px-5 py-3">{heading}</th>)}</tr></thead><tbody className="divide-y divide-[#eaecf0]">{filteredSales.map(sale=><tr key={sale.id} className="cursor-pointer hover:bg-[#fafafa]" onClick={()=>setSelectedSale(sale)}><td className="px-5 py-4 font-semibold text-[#182230]">{sale.invoiceNumber||sale.id.slice(0,8)}</td><td className="px-5 py-4 text-sm text-[#667085]">{sale.customerName||"Walk-in customer"}</td><td className="px-5 py-4 text-sm text-[#667085]">{sale.invoiceDate||"—"}</td><td className="px-5 py-4 text-sm font-semibold text-[#182230]">{money(Number(sale.total||0))}</td><td className="px-5 py-4 text-sm text-[#168361]">{money(Number(sale.paid||0))}</td><td className="px-5 py-4 text-sm text-[#b7791f]">{money(Number(sale.balance||0))}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sale.status==="Paid"?"bg-[#e8f8f1] text-[#168361]":sale.status==="Partially Paid"?"bg-[#fff7e8] text-[#b7791f]":"bg-[#fef3f2] text-[#b42318]"}`}>{sale.status||"Unpaid"}</span></td></tr>)}</tbody></table></div>}
        </section>
      </>:<section className="rounded-2xl border border-[#e7e5e4] bg-white shadow-sm"><header className="flex flex-col justify-between gap-4 border-b border-[#eaecf0] p-6 sm:flex-row sm:items-center"><div><p className="text-sm font-semibold text-[#4f46e5]">Sales invoice</p><h1 className="mt-1 text-2xl font-bold text-[#182230]">New invoice</h1></div><button type="button" onClick={()=>setMode("list")} className="rounded-xl border border-[#d0d5dd] px-4 py-2 text-sm font-semibold text-[#344054]">Back to sales</button></header>
        {error&&<div className="m-6 rounded-xl border border-[#fecdca] bg-[#fef3f2] px-4 py-3 text-sm text-[#b42318]">{error}</div>}
        <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1fr)_340px]"><div>
          <div className="grid gap-4 rounded-2xl border border-[#eaecf0] bg-[#fbfaf9] p-5 md:grid-cols-4"><label className="text-sm font-semibold text-[#344054]">Customer<select value={customerId} onChange={(event)=>setCustomerId(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal outline-none focus:border-[#4f46e5]"><option value="">Walk-in customer</option>{customers.filter(customer=>(customer.status||"Active").toLowerCase()==="active").map(customer=><option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label><label className="text-sm font-semibold text-[#344054]">Invoice number<input inputMode="numeric" pattern="[0-9]*" value={invoiceNumber} onChange={(event)=>setInvoiceNumber(event.target.value.replace(/\D/g,""))} placeholder="1001" className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal outline-none focus:border-[#4f46e5]"/><span className="mt-1 block text-xs font-normal text-[#98a2b3]">Enter your own number or keep the suggested number.</span></label><label className="text-sm font-semibold text-[#344054]">Invoice date<input type="date" value={invoiceDate} onChange={(event)=>setInvoiceDate(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal outline-none focus:border-[#4f46e5]"/></label><div className="rounded-xl bg-white p-3 text-sm"><p className="text-xs font-medium uppercase text-[#98a2b3]">Customer balance</p><p className="mt-2 font-bold text-[#182230]">{money(Number(selectedCustomer?.balance||0))}</p></div></div>
          <div className="mt-6 rounded-2xl border border-[#eaecf0] p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold text-[#182230]">Invoice items</h2><p className="mt-1 text-sm text-[#667085]">Stock is checked again at save time.</p></div><button type="button" onClick={()=>setLines(current=>[...current,{...emptyLine}])} className="rounded-xl border border-[#c7c3ff] px-3 py-2 text-sm font-semibold text-[#4f46e5]">+ Add line</button></div><div className="space-y-3">{lines.map((line,index)=><div key={index} className="grid gap-3 rounded-xl border border-[#eaecf0] p-4 lg:grid-cols-[minmax(220px,2fr)_90px_110px_110px_110px_36px]"><select value={line.itemId} onChange={(event)=>updateLine(index,"itemId",event.target.value)} className="h-10 rounded-lg border border-[#d0d5dd] bg-white px-3 text-sm"><option value="">Select item</option>{items.map(item=><option key={item.id} value={item.id}>{item.name} · {Number(item.stock||0)} left</option>)}</select><input type="number" min="1" value={line.quantity} onChange={(event)=>updateLine(index,"quantity",event.target.value)} className="h-10 rounded-lg border border-[#d0d5dd] px-3 text-sm" aria-label="Quantity"/><input type="number" min="0" value={line.price} onChange={(event)=>updateLine(index,"price",event.target.value)} className="h-10 rounded-lg border border-[#d0d5dd] px-3 text-sm" aria-label="Rate"/><input type="number" min="0" value={line.discount} onChange={(event)=>updateLine(index,"discount",event.target.value)} className="h-10 rounded-lg border border-[#d0d5dd] px-3 text-sm" aria-label="Discount"/><div className="flex items-center justify-end text-sm font-semibold text-[#182230]">{money(Math.max(0,line.quantity*line.price-line.discount))}</div><button type="button" onClick={()=>setLines(current=>current.length>1?current.filter((_,i)=>i!==index):current)} className="text-xl text-[#c13c25]">×</button><div className="lg:col-span-6 flex justify-between text-xs text-[#667085]"><span>{line.name||"Choose an item"} · {line.unit}</span><span>{Number(line.stock||0)} available before save</span></div></div>)}</div><label className="mt-5 block text-sm font-semibold text-[#344054]">Internal note<textarea value={note} onChange={(event)=>setNote(event.target.value)} placeholder="Optional note for this sale" className="mt-2 min-h-20 w-full rounded-xl border border-[#d0d5dd] p-3 font-normal outline-none focus:border-[#4f46e5]"/></label></div>
        </div><aside className="h-fit rounded-2xl border border-[#e7e5e4] bg-white p-6 shadow-sm"><p className="text-sm font-semibold text-[#4f46e5]">Invoice summary</p><h2 className="mt-1 text-lg font-bold text-[#182230]">Payment overview</h2><dl className="mt-6 space-y-4 text-sm"><div className="flex justify-between text-[#667085]"><dt>Subtotal</dt><dd>{money(subtotal)}</dd></div><div className="flex justify-between text-[#667085]"><dt>Discount</dt><dd>-{money(discount)}</dd></div><div className="border-t border-[#eaecf0] pt-4 flex justify-between text-lg font-bold text-[#182230]"><dt>Total</dt><dd>{money(total)}</dd></div><label className="flex items-center justify-between gap-3"><span className="text-[#667085]">Received</span><input type="number" min="0" max={total} value={received} onChange={(event)=>setReceived(event.target.value)} className="h-9 w-32 rounded-lg border border-[#d0d5dd] px-2 text-right text-sm"/></label><div className="flex justify-between"><dt className="text-[#667085]">Balance</dt><dd className="font-semibold text-[#b7791f]">{money(balance)}</dd></div><label className="block text-sm font-semibold text-[#344054]">Payment method<select value={paymentMethod} onChange={(event)=>setPaymentMethod(event.target.value)} className="mt-2 h-10 w-full rounded-xl border border-[#d0d5dd] bg-white px-3 font-normal"><option>Credit</option><option>Cash</option><option>UPI</option><option>Bank</option></select></label></dl><button disabled={saving||loading} onClick={saveInvoice} className="mt-8 w-full rounded-xl bg-[#4f46e5] py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-200 disabled:opacity-50">{saving?"Saving…":"Save invoice"}</button></aside></div></section>}

      {selectedSale&&<div className="fixed inset-0 z-50 bg-[#182230]/45 p-4" onClick={()=>setSelectedSale(null)}><div className="mx-auto flex max-h-[90vh] max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event)=>event.stopPropagation()}><header className="flex items-center justify-between border-b border-[#eaecf0] p-6"><div><p className="text-sm font-semibold text-[#4f46e5]">Invoice details</p><h2 className="mt-1 text-xl font-bold text-[#182230]">#{selectedSale.invoiceNumber||"—"}</h2><p className="mt-1 text-sm text-[#667085]">{selectedSale.customerName||"Walk-in customer"} · {selectedSale.invoiceDate||"—"}</p></div><button type="button" onClick={()=>setSelectedSale(null)} className="text-2xl text-[#667085]">×</button></header><div className="overflow-y-auto p-6"><div className="overflow-x-auto"><table className="min-w-full text-left text-sm"><thead className="bg-[#fbfaf9] text-xs uppercase text-[#667085]"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Rate</th><th className="px-3 py-2">Amount</th></tr></thead><tbody className="divide-y divide-[#eaecf0]">{(selectedSale.items||[]).map((line,index)=><tr key={index}><td className="px-3 py-3">{line.name}</td><td className="px-3 py-3">{line.quantity}</td><td className="px-3 py-3">{money(Number(line.price||0))}</td><td className="px-3 py-3 font-semibold">{money(Math.max(0,line.quantity*line.price-line.discount))}</td></tr>)}</tbody></table></div><div className="mt-6 ml-auto max-w-xs space-y-2 text-sm"><div className="flex justify-between"><span>Subtotal</span><span>{money(Number(selectedSale.subtotal||0))}</span></div><div className="flex justify-between"><span>Discount</span><span>-{money(Number(selectedSale.discount||0))}</span></div><div className="flex justify-between border-t pt-2 font-bold"><span>Total</span><span>{money(Number(selectedSale.total||0))}</span></div><div className="flex justify-between"><span>Paid</span><span>{money(Number(selectedSale.paid||0))}</span></div><div className="flex justify-between"><span>Balance</span><span>{money(Number(selectedSale.balance||0))}</span></div></div></div><footer className="flex justify-end border-t border-[#eaecf0] p-5"><button type="button" onClick={()=>printInvoice(selectedSale)} className="rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-semibold text-white">Print invoice</button></footer></div></div>}
    </div></main></div>
  </AuthGate>;
}
