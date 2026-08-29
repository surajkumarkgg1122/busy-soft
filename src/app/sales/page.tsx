"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { firestoreDb } from "../../lib/firebase";
import { useBusiness } from "../../context/BusinessContext";

type Customer = { id: string; name?: string; phone?: string; address?: string; balance?: number; status?: string };
type Item = { id: string; name?: string; unit?: string; salePrice?: number; stock?: number; taxRate?: number };
type Line = { itemId: string; name: string; unit: string; quantity: number; price: number; discount: number; discountPercent: number; taxRate: number; stock?: number };
type Sale = { id: string; invoiceNumber?: string; customerId?: string | null; customerName?: string | null; invoiceDate?: string; total?: number; paid?: number; balance?: number; paymentMethod?: string; status?: string; items?: Line[]; note?: string; stateOfSupply?: string };

const emptyLine: Line = { itemId: "", name: "", unit: "NONE", quantity: 1, price: 0, discount: 0, discountPercent: 0, taxRate: 0 };
const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);
const today = () => new Date().toISOString().slice(0, 10);
const nextNo = (sales: Sale[]) => { const nums = sales.map(s => Number(s.invoiceNumber)).filter(n => Number.isInteger(n) && n > 0); return String((nums.length ? Math.max(...nums) : 0) + 1); };
const partyName = (sale: Sale) => sale.customerId ? (sale.customerName || "Customer") : "Cash Sale";

export default function SalesPage() {
  const { activeBusinessId, activeBusiness, loading: businessLoading } = useBusiness();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [showList, setShowList] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("1");
  const [invoiceDate, setInvoiceDate] = useState(today());
  const [stateOfSupply, setStateOfSupply] = useState("");
  const [paymentType, setPaymentType] = useState<"Credit" | "Cash">("Credit");
  const [received, setReceived] = useState("0");
  const [roundOff, setRoundOff] = useState(true);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }, { ...emptyLine }]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadData() {
    if (businessLoading) return;
    if (!firestoreDb) { setError("Firebase is not configured."); setLoading(false); return; }
    if (!activeBusinessId) { setCustomers([]); setItems([]); setSales([]); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const business = doc(firestoreDb, "businesses", activeBusinessId);
      const [c, i, s] = await Promise.all([
        getDocs(collection(business, "customers")),
        getDocs(collection(business, "items")),
        getDocs(collection(business, "sales")),
      ]);
      setCustomers(c.docs.map(d => ({ id: d.id, ...d.data() })) as Customer[]);
      setItems(i.docs.map(d => ({ id: d.id, ...d.data() })) as Item[]);
      const loaded = s.docs.map(d => ({ id: d.id, ...d.data() })) as Sale[];
      setSales(loaded);
      if (invoiceNumber === "1") setInvoiceNumber(nextNo(loaded));
    } catch (e) { console.error(e); setError("Could not load sales data. Check Firestore rules."); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadData(); }, [activeBusinessId, businessLoading]);

  const selectedCustomer = customers.find(c => c.id === customerId);
  const validLines = lines.filter(l => l.itemId && l.quantity > 0);
  const lineNet = (l: Line) => Math.max(0, l.quantity * l.price - l.discount);
  const subtotal = useMemo(() => validLines.reduce((s, l) => s + l.quantity * l.price, 0), [validLines]);
  const discount = useMemo(() => validLines.reduce((s, l) => s + l.discount, 0), [validLines]);
  const tax = useMemo(() => validLines.reduce((s, l) => s + lineNet(l) * l.taxRate / 100, 0), [validLines]);
  const gross = Math.max(0, subtotal - discount + tax);
  const total = roundOff ? Math.round(gross) : Number(gross.toFixed(2));
  const roundAmount = Number((total - gross).toFixed(2));
  const receivedAmount = paymentType === "Cash" ? total : Math.max(0, Math.min(total, Number(received) || 0));
  const balance = Math.max(0, Number((total - receivedAmount).toFixed(2)));
  const customerBalance = Number(selectedCustomer?.balance || 0);
  const filteredSales = sales.filter(s => `${s.invoiceNumber} ${partyName(s)} ${s.status}`.toLowerCase().includes(query.toLowerCase()));

  function updateLine(index: number, field: keyof Line, value: string) {
    setLines(current => current.map((line, i) => {
      if (i !== index) return line;
      if (field === "itemId") {
        const item = items.find(x => x.id === value);
        return { ...line, itemId: value, name: item?.name || "", unit: item?.unit || "NONE", price: Number(item?.salePrice || 0), taxRate: Number(item?.taxRate || 0), discount: 0, discountPercent: 0, quantity: 1 };
      }
      const n = Math.max(0, Number(value) || 0);
      if (field === "discountPercent") return { ...line, discountPercent: Math.min(100, n), discount: Number((line.quantity * line.price * Math.min(100, n) / 100).toFixed(2)) };
      if (["quantity", "price", "taxRate", "discount"].includes(field)) return { ...line, [field]: n };
      return { ...line, [field]: value };
    }));
  }

  function newInvoice() {
    setSelectedSale(null); setCustomerId(""); setInvoiceNumber(nextNo(sales)); setInvoiceDate(today()); setStateOfSupply(activeBusiness?.business.address?.state || ""); setPaymentType("Credit"); setReceived("0"); setRoundOff(true); setNote(""); setLines([{ ...emptyLine }, { ...emptyLine }]); setError(""); setShowList(false);
  }

  function viewSale(sale: Sale) {
    setSelectedSale(sale); setCustomerId(sale.customerId || ""); setInvoiceNumber(String(sale.invoiceNumber || "")); setInvoiceDate(sale.invoiceDate || today()); setStateOfSupply(sale.stateOfSupply || ""); setPaymentType(sale.paymentMethod === "Cash" ? "Cash" : "Credit"); setReceived(String(sale.paid || 0)); setLines((sale.items || []).map(l => ({ ...l, unit: l.unit || "NONE", discountPercent: l.discountPercent || 0 }))); setShowList(false); setError("");
  }

  async function saveInvoice() {
    if (!firestoreDb || !activeBusinessId) return setError("Select a business first.");
    if (selectedSale) return setError("Saved invoices are view-only here. Use New Sale to create another invoice.");
    const no = invoiceNumber.trim();
    if (!/^\d+$/.test(no)) return setError("Invoice number must contain numbers only.");
    if (sales.some(s => String(s.invoiceNumber || "").trim() === no)) return setError(`Invoice number ${no} already exists.`);
    if (!validLines.length) return setError("Add at least one item to the invoice.");
    for (const line of validLines) { const item = items.find(x => x.id === line.itemId); if (!item) return setError("Selected item is unavailable."); if (line.quantity > Number(item.stock || 0)) return setError(`${item.name || "Item"} has only ${Number(item.stock || 0)} available.`); }
    setSaving(true); setError("");
    try {
      const business = doc(firestoreDb, "businesses", activeBusinessId);
      const saleRef = doc(collection(business, "sales"));
      const saleLines = validLines.map(l => ({ ...l, stock: Number(items.find(x => x.id === l.itemId)?.stock || 0) }));
      await runTransaction(firestoreDb, async transaction => {
        const itemSnaps = new Map<string, any>();
        for (const line of saleLines) itemSnaps.set(line.itemId, await transaction.get(doc(business, "items", line.itemId)));
        let customerRef: ReturnType<typeof doc> | null = null; let customerSnap: any = null;
        if (customerId) { customerRef = doc(business, "customers", customerId); customerSnap = await transaction.get(customerRef); }
        for (const line of saleLines) { const snap = itemSnaps.get(line.itemId); if (!snap?.exists()) throw new Error(`${line.name || "Item"} no longer exists.`); const stock = Number(snap.data().stock || 0); if (line.quantity > stock) throw new Error(`${line.name || "Item"} has only ${stock} available.`); transaction.update(doc(business, "items", line.itemId), { stock: stock - line.quantity, updatedAt: serverTimestamp() }); }
        if (customerRef && customerSnap?.exists() && balance > 0) transaction.update(customerRef, { balance: Number(customerSnap.data().balance || 0) + balance, updatedAt: serverTimestamp() });
        transaction.set(saleRef, { saleId: saleRef.id, invoiceNumber: no, customerId: customerId || null, customerName: customerId ? (selectedCustomer?.name || null) : null, invoiceDate, stateOfSupply: stateOfSupply.trim(), items: saleLines, subtotal, discount, tax, roundOff: roundAmount, total, paid: receivedAmount, balance, paymentMethod: paymentType, status: balance === 0 ? "Paid" : receivedAmount > 0 ? "Partially Paid" : "Unpaid", note: note.trim(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      });
      await loadData(); setSelectedSale(null); setShowList(true);
    } catch (e) { console.error(e); setError(e instanceof Error ? e.message : "Could not save invoice."); }
    finally { setSaving(false); }
  }

  function printInvoice() {
    const label = selectedCustomer?.name || (customerId ? "Customer" : "Cash Sale");
    const rows = validLines.map(l => `<tr><td>${l.name}</td><td>${l.quantity}</td><td>${money(l.price)}</td><td>${l.discountPercent}%</td><td>${l.taxRate}%</td><td>${money(lineNet(l) + lineNet(l) * l.taxRate / 100)}</td></tr>`).join("");
    const html = `<html><head><title>Invoice ${invoiceNumber}</title><style>body{font-family:Arial;margin:30px;color:#17212b}h1{margin:0 0 6px}.top{display:flex;justify-content:space-between;margin-bottom:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f2f4f6}.tot{margin-left:auto;width:300px;margin-top:18px}.r{display:flex;justify-content:space-between;padding:5px}.g{font-weight:700;border-top:2px solid #222;padding-top:9px}</style></head><body><div class='top'><div><h1>Sales Invoice</h1><b>${label}</b></div><div><b>Invoice #${invoiceNumber}</b><br/>${invoiceDate}</div></div><p>State of Supply: ${stateOfSupply || "—"}</p><table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Disc.</th><th>Tax</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class='tot'><div class='r'><span>Subtotal</span><span>${money(subtotal)}</span></div><div class='r'><span>Discount</span><span>${money(discount)}</span></div><div class='r'><span>Tax</span><span>${money(tax)}</span></div><div class='r'><span>Round Off</span><span>${money(roundAmount)}</span></div><div class='r g'><span>Total</span><span>${money(total)}</span></div><div class='r'><span>Received</span><span>${money(receivedAmount)}</span></div><div class='r'><span>Balance</span><span>${money(balance)}</span></div></div><script>window.print()</script></body></html>`;
    const win = window.open("", "_blank", "width=1000,height=760"); if (win) { win.document.write(html); win.document.close(); }
  }

  async function shareInvoice() {
    const text = `Sales Invoice #${invoiceNumber}\n${selectedCustomer?.name || "Cash Sale"}\nTotal: ${money(total)}\nReceived: ${money(receivedAmount)}\nBalance: ${money(balance)}`;
    if (navigator.share) await navigator.share({ title: `Invoice #${invoiceNumber}`, text }); else await navigator.clipboard?.writeText(text);
  }

  return <AuthGate><div className="min-h-screen bg-[#f1f3f5]"><div className="flex min-h-screen"><Sidebar/><main className="min-w-0 flex-1"><TopNav/>
    {showList ? <div className="p-4 sm:p-6"><div className="mb-4 flex items-center justify-between"><div><h1 className="text-2xl font-bold text-[#243244]">Sales</h1><p className="text-sm text-[#737d88]">Sales invoices</p></div><button onClick={newInvoice} className="rounded bg-[#1787f2] px-5 py-2.5 text-sm font-semibold text-white">+ Add Sale</button></div><div className="overflow-hidden rounded border border-[#d5d9de] bg-white"><div className="flex items-center border-b bg-[#f7f8f9] p-3"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search transactions" className="h-9 w-full max-w-md rounded border border-[#cbd1d8] px-3 text-sm outline-none focus:border-[#1787f2]"/></div><div className="overflow-x-auto"><table className="min-w-[900px] w-full text-sm"><thead><tr className="bg-[#eef0f2] text-left text-xs font-semibold uppercase text-[#596572]"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Ref No.</th><th className="px-3 py-2">Party</th><th className="px-3 py-2">Type</th><th className="px-3 py-2 text-right">Total</th><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Status</th><th></th></tr></thead><tbody>{loading ? <tr><td colSpan={9} className="p-12 text-center text-[#7b8490]">Loading…</td></tr> : filteredSales.length === 0 ? <tr><td colSpan={9} className="p-12 text-center text-[#7b8490]">No sales found.</td></tr> : filteredSales.map(s => <tr key={s.id} className="border-t hover:bg-[#f8fbff]"><td className="px-3 py-2.5">{s.invoiceDate || "—"}</td><td className="px-3 py-2.5 font-semibold">{s.invoiceNumber || "—"}</td><td className="px-3 py-2.5">{partyName(s)}</td><td className="px-3 py-2.5">Sale</td><td className="px-3 py-2.5 text-right">{money(Number(s.total))}</td><td className="px-3 py-2.5 text-right">{money(Number(s.paid))}</td><td className="px-3 py-2.5 text-right">{money(Number(s.balance))}</td><td className="px-3 py-2.5">{s.status || "Unpaid"}</td><td className="px-3 py-2.5"><button onClick={() => viewSale(s)} className="text-[#1787f2] hover:underline">View</button></td></tr>)}</tbody></table></div></div></div> : <div className="min-w-0">
      <div className="flex h-10 items-center border-b border-[#d4d9df] bg-[#eef0f2]"><button className="h-full border-r border-[#d4d9df] bg-white px-4 text-sm font-medium">{selectedCustomer?.name || "Cash Sale"}<span className="ml-8 text-[#8c959f]">×</span></button><button onClick={newInvoice} className="px-4 text-2xl leading-none text-[#1787f2]">+</button><button onClick={() => setShowList(true)} className="ml-auto mr-3 rounded border border-[#c8ced5] bg-white px-3 py-1 text-xs text-[#53606c]">Sales List</button></div>
      <div className="flex items-center gap-4 border-b border-[#dfe3e7] bg-white px-5 py-3"><h1 className="text-xl font-bold text-[#243244]">Sale</h1><div className="flex rounded-full bg-[#d9eaff] p-0.5 text-sm"><button onClick={() => {setPaymentType("Credit");setReceived("0")}} className={`rounded-full px-3 py-1 ${paymentType === "Credit" ? "bg-[#3f7ff3] text-white" : "text-[#40536a]"}`}>Credit</button><button onClick={() => setPaymentType("Cash")} className={`rounded-full px-3 py-1 ${paymentType === "Cash" ? "bg-[#3f7ff3] text-white" : "text-[#40536a]"}`}>Cash</button></div></div>
      {error && <div className="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      <section className="bg-white px-4 pb-28 pt-7 sm:px-6"><div className="grid gap-5 lg:grid-cols-[1fr_430px]"><div><div className="grid gap-5 md:grid-cols-[240px_1fr]"><div><label className="relative block"><span className="absolute -top-2 left-3 bg-white px-1 text-xs text-[#697586]">Customer</span><select value={customerId} onChange={e => setCustomerId(e.target.value)} className="h-10 w-full rounded border border-[#bfc6ce] bg-white px-3 text-sm outline-none focus:border-[#1787f2]"><option value="">Cash Sale (No Party)</option>{customers.filter(c => c.status !== "inactive").map(c => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}</select></label><div className="mt-1 px-3 text-xs text-red-500">BAL: {money(customerBalance)}</div><textarea value={selectedCustomer?.address || ""} readOnly placeholder="Billing Address" className="mt-3 h-24 w-full resize-none rounded border border-[#c7ccd2] p-3 text-sm outline-none"/></div><div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-[#78828d]">Invoice Number<input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value.replace(/\D/g, ""))} className="mt-1 h-9 w-full border-b border-[#cfd4da] px-2 text-sm font-medium outline-none focus:border-[#1787f2]"/></label><label className="text-xs text-[#78828d]">Invoice Date<input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="mt-1 h-9 w-full border-b border-[#cfd4da] px-2 text-sm outline-none focus:border-[#1787f2]"/></label><label className="text-xs text-[#78828d]">State of Supply<select value={stateOfSupply} onChange={e => setStateOfSupply(e.target.value)} className="mt-1 h-9 w-full border-b border-[#cfd4da] bg-white px-2 text-sm outline-none"><option value="">Select</option>{["Bihar","Jharkhand","Uttar Pradesh","West Bengal","Delhi","Other"].map(s => <option key={s}>{s}</option>)}</select></label></div></div></div></div>
      <div className="mt-8 overflow-x-auto border border-[#d4d9df]"><table className="min-w-[1100px] w-full table-fixed border-collapse text-sm"><thead><tr className="bg-[#f5f6f7] text-[#53606d]"><th className="w-10 border-r px-2 py-2">#</th><th className="w-[34%] border-r px-3 py-2 text-left">ITEM</th><th className="w-20 border-r px-2 py-2">QTY</th><th className="w-24 border-r px-2 py-2 text-left">UNIT</th><th className="w-32 border-r px-2 py-2 text-left">PRICE/UNIT<br/><small>Without Tax</small></th><th className="w-32 border-r px-2 py-2 text-left">DISCOUNT<br/><small>% &nbsp; AMOUNT</small></th><th className="w-44 border-r px-2 py-2 text-left">TAX<br/><small>RATE &nbsp; AMOUNT</small></th><th className="w-28 px-2 py-2 text-right">AMOUNT</th><th className="w-8"></th></tr></thead><tbody>{lines.map((line,i) => { const t = lineNet(line) * line.taxRate / 100; return <tr key={i} className="border-t"><td className="border-r bg-[#fafbfc] px-2 py-2 text-center text-[#7b8490]">{i+1}</td><td className="border-r px-2"><select value={line.itemId} onChange={e => updateLine(i,"itemId",e.target.value)} className="h-9 w-full bg-transparent outline-none"><option value="">Select item</option>{items.map(item => <option key={item.id} value={item.id}>{item.name || item.id}</option>)}</select></td><td className="border-r px-1"><input type="number" min="1" value={line.quantity} onChange={e => updateLine(i,"quantity",e.target.value)} className="h-9 w-full bg-transparent text-right outline-none"/></td><td className="border-r px-2 text-[#596572]">{line.unit}</td><td className="border-r px-1"><input type="number" min="0" value={line.price} onChange={e => updateLine(i,"price",e.target.value)} className="h-9 w-full bg-transparent text-right outline-none"/></td><td className="border-r px-1"><div className="flex items-center"><input type="number" min="0" max="100" value={line.discountPercent} onChange={e => updateLine(i,"discountPercent",e.target.value)} className="h-8 w-12 bg-transparent text-right outline-none"/><span>%</span><span className="ml-auto text-xs">{line.discount.toFixed(2)}</span></div></td><td className="border-r px-1"><div className="flex items-center"><select value={line.taxRate} onChange={e => updateLine(i,"taxRate",e.target.value)} className="h-8 flex-1 bg-transparent text-xs outline-none"><option value={0}>Select</option>{[5,12,18,28].map(r => <option key={r} value={r}>GST@{r}%</option>)}</select><span className="ml-1 text-xs">{t.toFixed(2)}</span></div></td><td className="px-2 text-right font-medium">{money(lineNet(line)+t)}</td><td className="text-center"><button onClick={() => setLines(x => x.length === 1 ? [{...emptyLine}] : x.filter((_,j)=>j!==i))} className="text-lg text-[#929aa3] hover:text-red-500">×</button></td></tr>})}</tbody><tfoot><tr className="border-t bg-[#fafbfc]"><td colSpan={2} className="px-2 py-2"><button onClick={() => setLines(x => [...x,{...emptyLine}])} className="rounded border border-[#78b8ff] px-3 py-1.5 text-xs font-medium text-[#1787f2]">ADD ROW</button></td><td className="px-2 text-center font-semibold">{validLines.reduce((s,l)=>s+l.quantity,0)}</td><td></td><td></td><td className="px-2 text-right font-semibold">{money(discount)}</td><td className="px-2 text-right font-semibold">{money(tax)}</td><td className="px-2 text-right font-bold">{money(total)}</td><td></td></tr></tfoot></table></div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_360px]"><div className="flex flex-wrap gap-4"><label className="relative block w-52"><span className="absolute -top-2 left-3 bg-white px-1 text-xs text-[#697586]">Payment Type</span><select value={paymentType} onChange={e => setPaymentType(e.target.value as "Cash"|"Credit")} className="h-11 w-full rounded border border-[#bfc6ce] bg-white px-3 text-sm outline-none"><option>Cash</option><option>Credit</option></select></label><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Add description" className="h-16 w-full max-w-md resize-none rounded border border-[#d0d5db] p-2 text-sm outline-none"/></div><div className="space-y-2 text-sm"><div className="flex items-center justify-between"><label className="flex items-center gap-2 text-[#697586]"><input type="checkbox" checked={roundOff} onChange={e => setRoundOff(e.target.checked)} className="accent-[#1787f2]"/> Round Off</label><span className="w-16 rounded border px-2 py-1 text-right">{roundAmount.toFixed(2)}</span></div><div className="flex items-center justify-between"><b>Total</b><span className="w-48 rounded border bg-[#fafafa] px-3 py-2 text-right">{money(total)}</span></div><div className="flex items-center justify-between"><span>Received</span><input type="number" min="0" value={paymentType === "Cash" ? total : received} disabled={paymentType === "Cash"} onChange={e => setReceived(e.target.value)} className="w-48 rounded border px-3 py-2 text-right outline-none focus:border-[#1787f2]"/></div><div className="flex items-center justify-between"><b>Balance</b><span className={`w-48 px-3 py-2 text-right font-bold ${balance ? "text-red-500" : "text-green-600"}`}>{money(balance)}</span></div></div></div>
      </section>
      <div className="sticky bottom-0 z-20 flex justify-end gap-2 border-t border-[#d5d9de] bg-white px-5 py-3 shadow-[0_-2px_8px_rgba(0,0,0,.06)]"><button onClick={shareInvoice} className="rounded border border-[#1787f2] px-5 py-2.5 text-sm text-[#1787f2]">Share</button><button onClick={printInvoice} className="rounded border border-[#cbd1d8] px-4 py-2.5 text-sm">Print</button><button onClick={saveInvoice} disabled={saving || !!selectedSale} className="min-w-32 rounded bg-[#1787f2] px-7 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? "Saving…" : selectedSale ? "Saved" : "Save"}</button></div>
    </div>}
    </main></div></div></AuthGate>;
}
