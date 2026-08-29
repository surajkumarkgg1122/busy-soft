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
  const { activeBusinessId, activeBusiness, loading: businessLoading, can } = useBusiness();
  const canView = can("sales", "view");
  const canCreate = can("sales", "create");
  const canEdit = can("sales", "edit");
  const canDelete = can("sales", "delete");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [showList, setShowList] = useState(true);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [editing, setEditing] = useState(false);
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
    if (!canView) { setLoading(false); return; }
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

  useEffect(() => { loadData(); }, [activeBusinessId, businessLoading, canView]);

  const selectedCustomer = customers.find(c => c.id === customerId);
  const validLines = useMemo(() => lines.filter(l => l.itemId && l.quantity > 0), [lines]);
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

  function addRow() { setLines(current => [...current, { ...emptyLine }]); }
  function removeRow(index: number) { setLines(current => current.length === 1 ? [{ ...emptyLine }] : current.filter((_, i) => i !== index)); }

  function newInvoice() {
    if (!canCreate) return setError("You do not have permission to create sales.");
    setSelectedSale(null); setEditing(true); setCustomerId(""); setInvoiceNumber(nextNo(sales)); setInvoiceDate(today()); setStateOfSupply(activeBusiness?.business.address?.state || ""); setPaymentType("Credit"); setReceived("0"); setRoundOff(true); setNote(""); setLines([{ ...emptyLine }, { ...emptyLine }]); setError(""); setShowList(false);
  }

  function openSale(sale: Sale, edit = false) {
    setSelectedSale(sale); setEditing(edit); setCustomerId(sale.customerId || ""); setInvoiceNumber(String(sale.invoiceNumber || "")); setInvoiceDate(sale.invoiceDate || today()); setStateOfSupply(sale.stateOfSupply || ""); setPaymentType(sale.paymentMethod === "Cash" ? "Cash" : "Credit"); setReceived(String(sale.paid || 0)); setRoundOff(true); setNote(sale.note || ""); setLines((sale.items || []).map(l => ({ ...l, unit: l.unit || "NONE", discountPercent: l.discountPercent || 0 }))); setShowList(false); setError("");
  }

  function validateForm() {
    if (!activeBusinessId) return "Select a business first.";
    if (!/^\d+$/.test(invoiceNumber.trim())) return "Invoice number must contain numbers only.";
    if (!customerId && paymentType === "Credit") return "Select a customer for a credit sale.";
    if (!validLines.length) return "Add at least one item to the invoice.";
    for (const line of validLines) { const item = items.find(x => x.id === line.itemId); if (!item) return "One of the selected items is unavailable."; }
    return "";
  }

  async function saveInvoice() {
    if (selectedSale ? !canEdit : !canCreate) return setError(selectedSale ? "You do not have permission to edit sales." : "You do not have permission to create sales.");
    const validation = validateForm(); if (validation) return setError(validation);
    if (!firestoreDb || !activeBusinessId) return;
    const no = invoiceNumber.trim();
    if (!selectedSale && sales.some(s => String(s.invoiceNumber || "").trim() === no)) return setError(`Invoice number ${no} already exists.`);
    if (selectedSale && sales.some(s => s.id !== selectedSale.id && String(s.invoiceNumber || "").trim() === no)) return setError(`Invoice number ${no} already exists.`);
    setSaving(true); setError("");
    try {
      const business = doc(firestoreDb, "businesses", activeBusinessId);
      const saleRef = selectedSale ? doc(business, "sales", selectedSale.id) : doc(collection(business, "sales"));
      const saleLines = validLines.map(l => ({ ...l, stock: Number(items.find(x => x.id === l.itemId)?.stock || 0) }));
      await runTransaction(firestoreDb, async transaction => {
        const oldLines = selectedSale?.items || [];
        const itemIds = Array.from(new Set([...oldLines.map(l => l.itemId), ...saleLines.map(l => l.itemId)].filter(Boolean)));
        const itemSnaps = new Map<string, any>();
        for (const itemId of itemIds) itemSnaps.set(itemId, await transaction.get(doc(business, "items", itemId)));
        const oldCustomerId = selectedSale?.customerId || ""; const newCustomerId = customerId || "";
        const customerIds = Array.from(new Set([oldCustomerId, newCustomerId].filter(Boolean)));
        const customerSnaps = new Map<string, any>();
        for (const id of customerIds) customerSnaps.set(id, await transaction.get(doc(business, "customers", id)));
        const oldQty = new Map<string, number>(); const newQty = new Map<string, number>();
        for (const l of oldLines) oldQty.set(l.itemId, (oldQty.get(l.itemId) || 0) + Number(l.quantity || 0));
        for (const l of saleLines) newQty.set(l.itemId, (newQty.get(l.itemId) || 0) + Number(l.quantity || 0));
        for (const itemId of itemIds) {
          const snap = itemSnaps.get(itemId); if (!snap?.exists()) throw new Error("An item in this sale no longer exists.");
          const currentStock = Number(snap.data().stock || 0); const delta = (newQty.get(itemId) || 0) - (oldQty.get(itemId) || 0); const nextStock = currentStock - delta;
          if (nextStock < 0) throw new Error(`${snap.data().name || "Item"} has insufficient stock.`);
          if (delta !== 0) transaction.update(doc(business, "items", itemId), { stock: nextStock, updatedAt: serverTimestamp() });
        }
        const oldBalance = Number(selectedSale?.balance || 0); const newBalance = balance;
        if (oldCustomerId === newCustomerId) {
          if (newCustomerId && newBalance !== oldBalance) { const snap = customerSnaps.get(newCustomerId); if (snap?.exists()) transaction.update(doc(business, "customers", newCustomerId), { balance: Number(snap.data().balance || 0) + newBalance - oldBalance, updatedAt: serverTimestamp() }); }
        } else {
          if (oldCustomerId) { const snap = customerSnaps.get(oldCustomerId); if (snap?.exists() && oldBalance !== 0) transaction.update(doc(business, "customers", oldCustomerId), { balance: Math.max(0, Number(snap.data().balance || 0) - oldBalance), updatedAt: serverTimestamp() }); }
          if (newCustomerId && newBalance !== 0) { const snap = customerSnaps.get(newCustomerId); if (snap?.exists()) transaction.update(doc(business, "customers", newCustomerId), { balance: Number(snap.data().balance || 0) + newBalance, updatedAt: serverTimestamp() }); }
        }
        const saleData = { saleId: saleRef.id, invoiceNumber: no, customerId: newCustomerId || null, customerName: newCustomerId ? (selectedCustomer?.name || null) : null, invoiceDate, stateOfSupply: stateOfSupply.trim(), items: saleLines, subtotal, discount, tax, roundOff: roundAmount, total, paid: receivedAmount, balance, paymentMethod: paymentType, status: balance === 0 ? "Paid" : receivedAmount > 0 ? "Partially Paid" : "Unpaid", note: note.trim(), updatedAt: serverTimestamp() };
        if (selectedSale) transaction.update(saleRef, saleData); else transaction.set(saleRef, { ...saleData, createdAt: serverTimestamp() });
      });
      await loadData(); setSelectedSale(null); setEditing(false); setShowList(true);
    } catch (e) { console.error(e); setError(e instanceof Error ? e.message : "Could not save invoice."); }
    finally { setSaving(false); }
  }

  async function deleteSale(sale: Sale) {
    if (!canDelete) return setError("You do not have permission to delete sales.");
    if (!firestoreDb || !activeBusinessId) return;
    if (!window.confirm(`Delete invoice #${sale.invoiceNumber || ""}? Stock and customer balance will be reversed.`)) return;
    setSaving(true); setError("");
    try {
      const business = doc(firestoreDb, "businesses", activeBusinessId); const saleRef = doc(business, "sales", sale.id);
      await runTransaction(firestoreDb, async transaction => {
        const itemIds = Array.from(new Set((sale.items || []).map(l => l.itemId).filter(Boolean))); const itemSnaps = new Map<string, any>();
        for (const id of itemIds) itemSnaps.set(id, await transaction.get(doc(business, "items", id)));
        const customerRef = sale.customerId ? doc(business, "customers", sale.customerId) : null; const customerSnap = customerRef ? await transaction.get(customerRef) : null;
        for (const [id, snap] of itemSnaps) { if (!snap.exists()) continue; const qty = (sale.items || []).filter(l => l.itemId === id).reduce((s, l) => s + Number(l.quantity || 0), 0); transaction.update(doc(business, "items", id), { stock: Number(snap.data().stock || 0) + qty, updatedAt: serverTimestamp() }); }
        if (customerRef && customerSnap?.exists() && Number(sale.balance || 0) !== 0) transaction.update(customerRef, { balance: Math.max(0, Number(customerSnap.data().balance || 0) - Number(sale.balance || 0)), updatedAt: serverTimestamp() });
        transaction.delete(saleRef);
      });
      await loadData(); setSelectedSale(null); setEditing(false); setShowList(true);
    } catch (e) { console.error(e); setError(e instanceof Error ? e.message : "Could not delete invoice."); }
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

  const field = "h-10 rounded-md border border-[#c9cdd2] bg-white px-3 text-sm text-[#263442] outline-none focus:border-[#1787f2] focus:ring-1 focus:ring-[#1787f2]/15";
  const disabledField = "disabled:cursor-not-allowed disabled:bg-[#f1f3f5] disabled:text-[#8a939d]";
  const readOnly = !!selectedSale && !editing;

  return <AuthGate>
    <div className="min-h-screen bg-[#eef1f4]">
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-x-hidden">
          <TopNav />

          {!canView ? (
            <div className="p-6"><div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center"><h1 className="text-lg font-semibold text-red-700">Access denied</h1><p className="mt-1 text-sm text-red-600">You do not have permission to view sales.</p></div></div>
          ) : showList ? (
            <div className="px-4 pb-6 sm:px-6 lg:px-8">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h1 className="text-2xl font-bold text-[#243244]">Sales</h1><p className="text-sm text-[#737d88]">Sales invoices</p></div>
                {canCreate && <button onClick={newInvoice} className="rounded-lg bg-[#1787f2] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0877df]">+ Add Sale</button>}
              </div>
              <div className="overflow-hidden rounded-lg border border-[#d5d9de] bg-white shadow-sm">
                <div className="flex items-center border-b bg-[#f7f8f9] p-3"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search transactions" className="h-10 w-full max-w-md rounded-md border border-[#cbd1d8] bg-white px-3 text-sm outline-none focus:border-[#1787f2]" /></div>
                <div className="overflow-x-auto"><table className="min-w-[1000px] w-full text-sm"><thead><tr className="bg-[#eef0f2] text-left text-xs font-semibold uppercase text-[#596572]"><th className="px-3 py-3">Date</th><th className="px-3 py-3">Ref No.</th><th className="px-3 py-3">Party</th><th className="px-3 py-3">Type</th><th className="px-3 py-3 text-right">Total</th><th className="px-3 py-3 text-right">Received</th><th className="px-3 py-3 text-right">Balance</th><th className="px-3 py-3">Status</th><th className="px-3 py-3 text-right">Actions</th></tr></thead><tbody>{loading ? <tr><td colSpan={9} className="p-12 text-center text-[#7b8490]">Loading…</td></tr> : filteredSales.length === 0 ? <tr><td colSpan={9} className="p-12 text-center text-[#7b8490]">No sales found.</td></tr> : filteredSales.map(s => <tr key={s.id} className="border-t hover:bg-[#f8fbff]"><td className="px-3 py-3">{s.invoiceDate || "—"}</td><td className="px-3 py-3 font-semibold">{s.invoiceNumber || "—"}</td><td className="px-3 py-3">{partyName(s)}</td><td className="px-3 py-3">Sale</td><td className="px-3 py-3 text-right">{money(Number(s.total || 0))}</td><td className="px-3 py-3 text-right">{money(Number(s.paid || 0))}</td><td className="px-3 py-3 text-right">{money(Number(s.balance || 0))}</td><td className="px-3 py-3">{s.status || "—"}</td><td className="px-3 py-3"><div className="flex justify-end gap-1"><button onClick={() => openSale(s, false)} className="rounded border px-2.5 py-1 text-xs text-[#465361] hover:bg-[#f1f3f5]">View</button>{canEdit && <button onClick={() => openSale(s, true)} className="rounded border border-[#1787f2] px-2.5 py-1 text-xs text-[#1787f2] hover:bg-[#eef7ff]">Edit</button>}{canDelete && <button onClick={() => deleteSale(s)} className="rounded border border-red-200 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50">Delete</button>}</div></td></tr>)}</tbody></table></div>
              </div>
            </div>
          ) : (
            <div className="min-h-[calc(100vh-64px)] bg-[#eef1f4]">
              <div className="border-b border-[#d7dbe0] bg-white px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => { setShowList(true); setSelectedSale(null); setEditing(false); }} className="text-sm font-medium text-[#1787f2] hover:underline">← Sales</button>
                  <div className="h-6 w-px bg-[#d6dbe0]" />
                  <h1 className="text-xl font-bold text-[#1f2937]">Sale</h1>
                  <div className="flex rounded-full bg-[#dcecff] p-1 text-sm shadow-inner">
                    <button onClick={() => !readOnly && setPaymentType("Credit")} className={`rounded-full px-5 py-1.5 font-medium transition ${paymentType === "Credit" ? "bg-[#4285f4] text-white shadow-sm" : "text-[#243244]"}`}>Credit</button>
                    <button onClick={() => !readOnly && setPaymentType("Cash")} className={`rounded-full px-5 py-1.5 font-medium transition ${paymentType === "Cash" ? "bg-[#4285f4] text-white shadow-sm" : "text-[#243244]"}`}>Cash</button>
                  </div>
                  <div className="ml-auto flex gap-2">{selectedSale && canEdit && !editing && <button onClick={() => setEditing(true)} className="rounded-md border border-[#1787f2] bg-white px-4 py-2 text-sm font-medium text-[#1787f2]">Edit</button>}{selectedSale && canDelete && !editing && <button onClick={() => deleteSale(selectedSale)} className="rounded-md border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600">Delete</button>}</div>
                </div>
              </div>

              <div className="p-4 sm:p-6">
                <div className="rounded-lg border border-[#d2d7dc] bg-white shadow-sm">
                  <div className="grid grid-cols-1 gap-0 xl:grid-cols-[1fr_380px]">
                    <div className="p-5 sm:p-6">
                      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#68737e]">Customer <span className="text-red-500">*</span></label>
                          <div className="flex gap-2"><select value={customerId} onChange={e => setCustomerId(e.target.value)} disabled={readOnly} className={`min-w-0 flex-1 ${field} ${disabledField}`}><option value="">{paymentType === "Cash" ? "Cash Sale" : "Select customer"}</option>{customers.filter(c => c.status !== "inactive").map(c => <option key={c.id} value={c.id}>{c.name || "Unnamed Customer"}</option>)}</select><button type="button" disabled={readOnly} onClick={() => setError("Customer creation can be opened from the Customers page.")} className="h-10 w-10 shrink-0 rounded-md border border-[#c9cdd2] bg-white text-lg text-[#1787f2] disabled:opacity-50">+</button></div>
                          <div className="mt-1.5 text-xs text-red-500">BAL: {money(customerBalance)}</div>
                          <textarea value={selectedCustomer?.address || ""} readOnly placeholder="Billing Address" className="mt-5 h-28 w-full resize-none rounded-md border border-[#c9cdd2] bg-white p-3 text-sm text-[#66717c] outline-none" />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                          <div><label className="mb-1.5 block text-xs font-semibold text-[#68737e]">Invoice Number</label><input inputMode="numeric" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value.replace(/\D/g, ""))} disabled={readOnly} className={`w-full ${field} ${disabledField}`} /></div>
                          <div><label className="mb-1.5 block text-xs font-semibold text-[#68737e]">Invoice Date</label><input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} disabled={readOnly} className={`w-full ${field} ${disabledField}`} /></div>
                          <div><label className="mb-1.5 block text-xs font-semibold text-[#68737e]">State of Supply</label><select value={stateOfSupply} onChange={e => setStateOfSupply(e.target.value)} disabled={readOnly} className={`w-full ${field} ${disabledField}`}><option value="">Select</option><option>Bihar</option><option>Jharkhand</option><option>Uttar Pradesh</option><option>West Bengal</option><option>Delhi</option><option>Maharashtra</option><option>Rajasthan</option><option>Other</option></select></div>
                        </div>
                      </div>

                      <div className="mt-8 overflow-x-auto rounded-md border border-[#bfc5cb]">
                        <table className="min-w-[1060px] w-full text-sm">
                          <thead>
                            <tr className="bg-[#eef0f2] text-xs font-semibold text-[#45515d]">
                              <th rowSpan={2} className="w-10 border-r border-[#cbd0d5] px-2 py-2 text-center">#</th>
                              <th rowSpan={2} className="border-r border-[#cbd0d5] px-2 py-2 text-left">ITEM</th>
                              <th rowSpan={2} className="w-20 border-r border-[#cbd0d5] px-2 py-2 text-left">QTY</th>
                              <th rowSpan={2} className="w-20 border-r border-[#cbd0d5] px-2 py-2 text-left">UNIT</th>
                              <th className="w-32 border-r border-[#cbd0d5] px-2 py-1.5 text-right">PRICE/UNIT</th>
                              <th colSpan={2} className="w-44 border-r border-[#cbd0d5] px-2 py-1.5 text-center">DISCOUNT</th>
                              <th colSpan={2} className="w-48 border-r border-[#cbd0d5] px-2 py-1.5 text-center">TAX</th>
                              <th rowSpan={2} className="w-32 border-r border-[#cbd0d5] px-2 py-2 text-right">AMOUNT</th>
                              <th rowSpan={2} className="w-10 px-1 text-center">+</th>
                            </tr>
                            <tr className="bg-[#f7f8f9] text-[11px] text-[#65707b]"><th className="border-r border-[#cbd0d5] px-2 pb-2 text-right font-normal">Without Tax</th><th className="border-r border-[#cbd0d5] px-2 pb-2 text-center font-normal">%</th><th className="border-r border-[#cbd0d5] px-2 pb-2 text-right font-normal">AMOUNT</th><th className="border-r border-[#cbd0d5] px-2 pb-2 text-center font-normal">%</th><th className="border-r border-[#cbd0d5] px-2 pb-2 text-right font-normal">AMOUNT</th></tr>
                          </thead>
                          <tbody>
                            {lines.map((line, index) => { const net = lineNet(line); const taxAmount = net * line.taxRate / 100; const amount = net + taxAmount; return <tr key={`${index}-${line.itemId}`} className="border-t border-[#d3d7db] bg-[#fbfcfd] hover:bg-[#f4f8fc]">
                              <td className="border-r border-[#d3d7db] px-2 py-2.5 text-center text-[#7b858e]">{index + 1}</td>
                              <td className="border-r border-[#d3d7db] px-1 py-1.5"><select value={line.itemId} onChange={e => updateLine(index, "itemId", e.target.value)} disabled={readOnly} className={`w-full border-0 bg-transparent px-2 py-1.5 text-sm outline-none ${disabledField}`}><option value="">Select item</option>{items.map(item => <option key={item.id} value={item.id}>{item.name || "Unnamed Item"}</option>)}</select></td>
                              <td className="border-r border-[#d3d7db] px-1"><input type="number" min="1" value={line.quantity} onChange={e => updateLine(index, "quantity", e.target.value)} disabled={readOnly} className={`w-full border-0 bg-transparent px-2 py-1.5 text-right outline-none ${disabledField}`} /></td>
                              <td className="border-r border-[#d3d7db] px-2 text-center text-xs text-[#53606c]">{line.unit}</td>
                              <td className="border-r border-[#d3d7db] px-1"><input type="number" min="0" value={line.price} onChange={e => updateLine(index, "price", e.target.value)} disabled={readOnly} className={`w-full border-0 bg-transparent px-2 py-1.5 text-right outline-none ${disabledField}`} /></td>
                              <td className="border-r border-[#d3d7db] px-1"><input type="number" min="0" max="100" value={line.discountPercent} onChange={e => updateLine(index, "discountPercent", e.target.value)} disabled={readOnly} className={`w-full border-0 bg-transparent px-2 py-1.5 text-right outline-none ${disabledField}`} /></td>
                              <td className="border-r border-[#d3d7db] px-2 text-right text-xs text-[#53606c]">{money(line.discount)}</td>
                              <td className="border-r border-[#d3d7db] px-1"><select value={line.taxRate} onChange={e => updateLine(index, "taxRate", e.target.value)} disabled={readOnly} className={`w-full border-0 bg-transparent px-1 py-1.5 text-xs outline-none ${disabledField}`}><option value={0}>Select</option><option value={5}>GST@5%</option><option value={12}>GST@12%</option><option value={18}>GST@18%</option><option value={28}>GST@28%</option></select></td>
                              <td className="border-r border-[#d3d7db] px-2 text-right text-xs text-[#53606c]">{money(taxAmount)}</td>
                              <td className="border-r border-[#d3d7db] px-2 text-right font-medium text-[#263442]">{money(amount)}</td>
                              <td className="px-1 text-center">{(!selectedSale || editing) && <button type="button" onClick={() => removeRow(index)} className="text-lg leading-none text-red-500 hover:text-red-700" title="Remove row">×</button>}</td>
                            </tr>; })}
                          </tbody>
                          <tfoot>
                            <tr className="border-t border-[#c8cdd2] bg-white font-semibold text-[#43505c]">
                              <td colSpan={2} className="px-2 py-2.5">{(!selectedSale || editing) && <button type="button" onClick={addRow} className="rounded-md border border-[#1787f2] bg-white px-4 py-1.5 text-xs font-semibold text-[#1787f2] hover:bg-[#eef7ff]">ADD ROW</button>}</td>
                              <td className="px-2 py-2.5 text-right">{validLines.reduce((s, l) => s + l.quantity, 0)}</td><td /><td /><td /><td className="px-2 py-2.5 text-right">{money(discount)}</td><td /><td className="px-2 py-2.5 text-right">{money(tax)}</td><td className="px-2 py-2.5 text-right">{money(total)}</td><td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>

                    <aside className="border-t border-[#d7dbe0] bg-[#fafbfc] p-5 xl:border-l xl:border-t-0 sm:p-6">
                      <div className="xl:pt-20">
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#68737e]">Payment Type</label>
                        <select value={paymentType} onChange={e => setPaymentType(e.target.value as "Credit" | "Cash")} disabled={readOnly} className={`w-full ${field} ${disabledField}`}><option>Cash</option><option>Credit</option></select>
                        <div className="mt-7 rounded-md border border-[#d7dbe0] bg-white p-4">
                          <div className="flex items-center justify-between text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={roundOff} onChange={e => setRoundOff(e.target.checked)} disabled={readOnly} className="h-4 w-4" /><span>Round Off</span></label><span className="font-medium">{money(roundAmount)}</span></div>
                          <div className="mt-4 flex items-center justify-between gap-4"><span className="text-sm font-semibold">Total</span><input value={money(total)} readOnly className="h-10 w-40 rounded-md border border-[#cbd1d8] bg-white px-3 text-right text-sm font-semibold" /></div>
                          <div className="mt-4 flex items-center justify-between gap-4"><span className="text-sm">Received</span><input type="number" min="0" value={paymentType === "Cash" ? total : received} onChange={e => setReceived(e.target.value)} disabled={paymentType === "Cash" || readOnly} className={`h-10 w-40 text-right ${field} ${disabledField}`} /></div>
                          <div className="mt-4 flex items-center justify-between gap-4 border-t border-[#e4e7ea] pt-4"><span className="text-sm font-semibold">Balance Due</span><span className={`text-lg font-bold ${balance > 0 ? "text-[#d64545]" : "text-[#1787f2]"}`}>{money(balance)}</span></div>
                        </div>
                        <textarea value={note} onChange={e => setNote(e.target.value)} disabled={readOnly} placeholder="Add description" className={`mt-4 h-28 w-full resize-none ${field} ${disabledField} py-3`} />
                      </div>
                    </aside>
                  </div>

                  {error && <div className="border-t border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700">{error}</div>}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d7dbe0] bg-white px-5 py-3 sm:px-6">
                    <div className="text-xs text-[#7b858e]">{selectedSale ? `Invoice #${invoiceNumber}` : "New sales invoice"}</div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button type="button" onClick={shareInvoice} className="rounded-md border border-[#1787f2] bg-white px-5 py-2 text-sm font-medium text-[#1787f2] hover:bg-[#eef7ff]">Share</button>
                      <button type="button" onClick={printInvoice} className="rounded-md border border-[#1787f2] bg-white px-5 py-2 text-sm font-medium text-[#1787f2] hover:bg-[#eef7ff]">Print</button>
                      {(!selectedSale || editing) ? <button type="button" onClick={saveInvoice} disabled={saving || (selectedSale ? !canEdit : !canCreate)} className="rounded-md bg-[#1787f2] px-7 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#0877df] disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : selectedSale ? "Update" : "Save"}</button> : <button type="button" onClick={() => { setShowList(true); setSelectedSale(null); setEditing(false); }} className="rounded-md bg-[#1787f2] px-7 py-2 text-sm font-semibold text-white">Close</button>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  </AuthGate>;
}
