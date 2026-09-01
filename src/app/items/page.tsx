"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../Components/Sidebar/page";
import TopNav from "../Components/TopNav/page";
import AuthGate from "../Components/Auth/AuthGate";
import { auth } from "../../lib/firebase";
import { useBusiness } from "../../context/BusinessContext";

type Item = {
  id: string;
  name: string;
  code: string;
  unit?: string;
  unitId?: string;
  categoryId?: string;
  itemType?: string;
  hsnSac?: string;
  gstRate?: number;
  purchasePrice?: number;
  salePrice?: number;
  mrp?: number;
  barcode?: string;
  stock?: number;
  stockValue?: number;
  minStock?: number;
  maxStock?: number;
  reorderLevel?: number;
  status?: string;
  trackStock?: boolean;
  tracking?: { batch?: boolean; serial?: boolean; expiry?: boolean };
};

type Master = {
  id: string;
  name: string;
  shortName?: string;
  address?: string;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format((Number(value) || 0) / 100);

async function getToken() {
  if (!auth.currentUser) throw new Error("Please sign in again.");
  return auth.currentUser.getIdToken();
}

const emptyForm = {
  name: "",
  code: "",
  itemType: "product",
  unitId: "",
  categoryId: "",
  hsnSac: "",
  gstRate: "0",
  purchasePrice: "0",
  salePrice: "0",
  mrp: "0",
  barcode: "",
  minStock: "0",
  maxStock: "0",
  reorderLevel: "0",
  trackStock: true,
  batch: false,
  serial: false,
  expiry: false,
};

export default function ItemsPage() {
  const { activeBusinessId, businessName, loading } = useBusiness();
  const [items, setItems] = useState<Item[]>([]);
  const [masters, setMasters] = useState<Record<string, Master[]>>({
    units: [],
    categories: [],
    warehouses: [],
  });
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"items" | "masters" | "reports">("items");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
  const [masterType, setMasterType] = useState("units");
  const [masterName, setMasterName] = useState("");
  const [masterShort, setMasterShort] = useState("");

  const load = async () => {
    if (!activeBusinessId) return;
    try {
      const token = await getToken();
      const headers = { Authorization: `Bearer ${token}` };

      const response = await fetch(
        `/api/items?businessId=${activeBusinessId}`,
        { headers, cache: "no-store" }
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load items");
      setItems(data.items || []);

      for (const type of ["units", "categories", "warehouses"]) {
        const masterResponse = await fetch(
          `/api/item-masters?businessId=${activeBusinessId}&type=${type}`,
          { headers, cache: "no-store" }
        );
        const masterData = await masterResponse.json();
        if (masterResponse.ok) {
          setMasters((current) => ({ ...current, [type]: masterData.items || [] }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load inventory");
    }
  };

  useEffect(() => {
    if (!loading) void load();
  }, [activeBusinessId, loading]);

  const filteredItems = useMemo(() => {
    const value = query.toLowerCase().trim();
    if (!value) return items;
    return items.filter((item) =>
      `${item.name} ${item.code} ${item.barcode || ""}`
        .toLowerCase()
        .includes(value)
    );
  }, [items, query]);

  const stats = {
    count: items.length,
    quantity: items.reduce((sum, item) => sum + Number(item.stock || 0), 0),
    value: items.reduce((sum, item) => sum + Number(item.stockValue || 0), 0),
    low: items.filter(
      (item) =>
        Number(item.stock || 0) <=
        Number(item.reorderLevel ?? item.minStock ?? 0)
    ).length,
  };

  const openItem = (item?: Item) => {
    setEditing(item || null);
    if (!item) {
      setForm({ ...emptyForm });
    } else {
      setForm({
        ...emptyForm,
        name: item.name || "",
        code: item.code || "",
        itemType: item.itemType || "product",
        unitId: item.unitId || "",
        categoryId: item.categoryId || "",
        hsnSac: item.hsnSac || "",
        gstRate: String(item.gstRate || 0),
        purchasePrice: String(Number(item.purchasePrice || 0) / 100),
        salePrice: String(Number(item.salePrice || 0) / 100),
        mrp: String(Number(item.mrp || 0) / 100),
        barcode: item.barcode || "",
        minStock: String(item.minStock || 0),
        maxStock: String(item.maxStock || 0),
        reorderLevel: String(item.reorderLevel || 0),
        trackStock: item.trackStock !== false,
        batch: Boolean(item.tracking?.batch),
        serial: Boolean(item.tracking?.serial),
        expiry: Boolean(item.tracking?.expiry),
      });
    }
    setError("");
    setShowForm(true);
  };

  const saveItem = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const token = await getToken();
      const unit = masters.units.find((entry) => entry.id === form.unitId);

      const body: Record<string, unknown> = {
        businessId: activeBusinessId,
        name: String(form.name || "").trim(),
        code: String(form.code || "").trim(),
        itemType: form.itemType || "product",
        unit: unit?.shortName || unit?.name || "Piece",
        unitId: form.unitId || null,
        categoryId: form.categoryId || null,
        hsnSac: form.hsnSac || null,
        gstRate: Number(form.gstRate || 0),
        purchasePrice: Math.round(Number(form.purchasePrice || 0) * 100),
        salePrice: Math.round(Number(form.salePrice || 0) * 100),
        mrp: Math.round(Number(form.mrp || 0) * 100),
        barcode: form.barcode || null,
        minStock: Number(form.minStock || 0),
        maxStock: Number(form.maxStock || 0),
        reorderLevel: Number(form.reorderLevel || 0),
        trackStock: Boolean(form.trackStock),
        tracking: {
          batch: Boolean(form.batch),
          serial: Boolean(form.serial),
          expiry: Boolean(form.expiry),
        },
      };

      if (editing) body.itemId = editing.id;

      const response = await fetch("/api/items", {
        method: editing ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save item");

      setShowForm(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save item");
    } finally {
      setSaving(false);
    }
  };

  const addMaster = async () => {
    if (!masterName.trim()) return;
    try {
      const token = await getToken();
      const response = await fetch("/api/item-masters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          businessId: activeBusinessId,
          type: masterType,
          name: masterName.trim(),
          shortName: masterShort.trim() || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create master");
      setMasterName("");
      setMasterShort("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create master");
    }
  };

  return (
    <AuthGate>
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 pb-10 sm:px-8">
          <TopNav />
          <div className="mx-auto max-w-[1500px] py-5">
            <header className="flex flex-wrap justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-indigo-600">
                  {businessName || "Business"} · Inventory
                </p>
                <h1 className="text-3xl font-bold text-slate-900">
                  Items & Inventory
                </h1>
                <p className="mt-1 text-sm text-slate-500">
                  Complete item master, tracking and stock control.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openItem()}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white"
              >
                + New Item
              </button>
            </header>

            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <nav className="mt-6 flex gap-1 overflow-x-auto rounded-xl border bg-white p-1">
              {(["items", "masters", "reports"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    tab === value
                      ? "bg-slate-900 text-white"
                      : "text-slate-600"
                  }`}
                >
                  {value === "items"
                    ? "Items"
                    : value === "masters"
                    ? "Units / Categories / Warehouses"
                    : "Inventory Reports"}
                </button>
              ))}
            </nav>

            {tab === "items" && (
              <>
                <div className="mt-5 grid gap-4 sm:grid-cols-4">
                  {[
                    ["Items", stats.count],
                    ["Quantity", stats.quantity],
                    ["Low / Reorder", stats.low],
                    ["Stock Value", money(stats.value)],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-2xl border bg-white p-5">
                      <p className="text-sm text-slate-500">{label}</p>
                      <p className="mt-2 text-2xl font-bold">{value}</p>
                    </div>
                  ))}
                </div>

                <section className="mt-5 overflow-hidden rounded-2xl border bg-white">
                  <div className="flex justify-between gap-3 border-b p-5">
                    <h2 className="font-bold">Item Catalogue</h2>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search item / SKU / barcode"
                      className="h-10 w-full max-w-sm rounded-xl border px-3 text-sm"
                    />
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[1200px] text-left">
                      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                        <tr>
                          {["Item / SKU", "Type", "Unit", "GST", "Stock", "Value", "Purchase", "Sale", "Tracking", "Status"].map((heading) => (
                            <th className="px-5 py-3" key={heading}>{heading}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredItems.map((item) => (
                          <tr
                            key={item.id}
                            onClick={() => setSelected(item)}
                            className="cursor-pointer hover:bg-slate-50"
                          >
                            <td className="px-5 py-4">
                              <b>{item.name}</b>
                              <div className="text-xs text-slate-400">
                                {item.code}{item.barcode ? ` · ${item.barcode}` : ""}
                              </div>
                            </td>
                            <td className="px-5 py-4 text-sm capitalize">{item.itemType || "product"}</td>
                            <td className="px-5 py-4">{item.unit || "Piece"}</td>
                            <td className="px-5 py-4">{item.gstRate || 0}%</td>
                            <td className="px-5 py-4 font-semibold">{item.stock || 0}</td>
                            <td className="px-5 py-4">{money(Number(item.stockValue || 0))}</td>
                            <td className="px-5 py-4">{money(Number(item.purchasePrice || 0))}</td>
                            <td className="px-5 py-4">{money(Number(item.salePrice || 0))}</td>
                            <td className="px-5 py-4 text-xs">
                              {[
                                item.tracking?.batch && "Batch",
                                item.tracking?.serial && "Serial",
                                item.tracking?.expiry && "Expiry",
                              ].filter(Boolean).join(" · ") || "—"}
                            </td>
                            <td className="px-5 py-4 text-xs font-semibold">{item.status || "Active"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {tab === "masters" && (
              <div className="mt-5 grid gap-5 lg:grid-cols-[360px_1fr]">
                <section className="rounded-2xl border bg-white p-5">
                  <h2 className="font-bold">Master Setup</h2>
                  <select value={masterType} onChange={(event) => setMasterType(event.target.value)} className="mt-4 h-10 w-full rounded-xl border px-3">
                    <option value="units">Units</option>
                    <option value="categories">Categories</option>
                    <option value="warehouses">Warehouses</option>
                  </select>
                  <input value={masterName} onChange={(event) => setMasterName(event.target.value)} placeholder="Name" className="mt-3 h-10 w-full rounded-xl border px-3" />
                  {masterType === "units" && (
                    <input value={masterShort} onChange={(event) => setMasterShort(event.target.value)} placeholder="Short name" className="mt-3 h-10 w-full rounded-xl border px-3" />
                  )}
                  <button type="button" onClick={addMaster} className="mt-4 w-full rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white">Add</button>
                </section>
                <section className="rounded-2xl border bg-white p-5">
                  <h2 className="font-bold capitalize">{masterType}</h2>
                  {masters[masterType].map((master) => (
                    <div key={master.id} className="flex justify-between border-b py-3">
                      <span>{master.name}</span>
                      <span className="text-xs text-slate-400">{master.shortName || master.address || "Active"}</span>
                    </div>
                  ))}
                </section>
              </div>
            )}

            {tab === "reports" && (
              <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {[
                  ["Stock Summary", "/reports/inventory?view=summary"],
                  ["Stock Ledger", "/reports/inventory?view=ledger"],
                  ["Low Stock", "/reports/inventory?view=low"],
                  ["Warehouse Stock", "/reports/inventory?view=warehouse"],
                  ["Batch / Expiry", "/reports/inventory?view=expiry"],
                  ["Stock Valuation", "/reports/inventory?view=valuation"],
                ].map(([name, href]) => (
                  <a key={name} href={href} className="rounded-2xl border bg-white p-6 hover:border-indigo-300">
                    <b>{name}</b>
                    <p className="mt-1 text-sm text-slate-500">Open inventory report →</p>
                  </a>
                ))}
              </div>
            )}
          </div>
        </main>

        {selected && (
          <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l bg-white p-6 shadow-2xl">
            <button type="button" onClick={() => setSelected(null)} className="float-right text-2xl">×</button>
            <h2 className="text-2xl font-bold">{selected.name}</h2>
            <p className="text-sm text-slate-500">{selected.code}</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl border p-4"><small>Stock</small><b className="mt-1 block text-xl">{selected.stock || 0}</b></div>
              <div className="rounded-xl border p-4"><small>Value</small><b className="mt-1 block text-xl">{money(Number(selected.stockValue || 0))}</b></div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => openItem(selected)} className="rounded-xl border px-3 py-2">Edit</button>
              <a href={`/reports/inventory?view=ledger&itemId=${selected.id}`} className="rounded-xl border px-3 py-2 text-center">Ledger</a>
            </div>
            <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm">
              <b>Tracking</b>
              <p className="mt-2 text-slate-600">
                {selected.tracking?.batch ? "Batch · " : ""}
                {selected.tracking?.serial ? "Serial · " : ""}
                {selected.tracking?.expiry ? "Expiry" : "Standard"}
              </p>
            </div>
          </aside>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/30 p-4">
            <form onSubmit={saveItem} className="my-6 w-full max-w-5xl rounded-2xl bg-white p-6 shadow-2xl">
              <div className="flex justify-between">
                <div>
                  <h2 className="text-xl font-bold">{editing ? "Edit Item" : "New Item"}</h2>
                  <p className="text-sm text-slate-500">Configure master, GST, pricing, units and tracking.</p>
                </div>
                <button type="button" onClick={() => setShowForm(false)}>×</button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <label className="text-sm">Item name
                  <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-1 h-10 w-full rounded-xl border px-3" required />
                </label>
                <label className="text-sm">Item code / SKU
                  <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} className="mt-1 h-10 w-full rounded-xl border px-3" required />
                </label>
                <label className="text-sm">Type
                  <select value={form.itemType} onChange={(event) => setForm({ ...form, itemType: event.target.value })} className="mt-1 h-10 w-full rounded-xl border px-3">
                    <option value="product">Product</option>
                    <option value="service">Service</option>
                  </select>
                </label>
                <label className="text-sm">Unit
                  <select value={form.unitId} onChange={(event) => setForm({ ...form, unitId: event.target.value })} className="mt-1 h-10 w-full rounded-xl border px-3">
                    <option value="">Piece</option>
                    {masters.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({unit.shortName || unit.name})</option>)}
                  </select>
                </label>
                <label className="text-sm">Category
                  <select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="mt-1 h-10 w-full rounded-xl border px-3">
                    <option value="">None</option>
                    {masters.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </label>

                {[
                  ["hsnSac", "HSN / SAC", "text"],
                  ["barcode", "Barcode", "text"],
                  ["gstRate", "GST %", "number"],
                  ["purchasePrice", "Purchase price ₹", "number"],
                  ["salePrice", "Sale price ₹", "number"],
                  ["mrp", "MRP ₹", "number"],
                  ["minStock", "Minimum stock", "number"],
                  ["maxStock", "Maximum stock", "number"],
                  ["reorderLevel", "Reorder level", "number"],
                ].map(([key, label, type]) => (
                  <label key={key} className="text-sm">{label}
                    <input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} type={type} min="0" className="mt-1 h-10 w-full rounded-xl border px-3" />
                  </label>
                ))}
              </div>

              <div className="mt-5 grid gap-3 rounded-xl border p-4 md:grid-cols-4">
                <label><input type="checkbox" checked={form.trackStock} onChange={(event) => setForm({ ...form, trackStock: event.target.checked })} /> Track stock</label>
                <label><input type="checkbox" checked={form.batch} onChange={(event) => setForm({ ...form, batch: event.target.checked })} /> Batch / Lot</label>
                <label><input type="checkbox" checked={form.serial} onChange={(event) => setForm({ ...form, serial: event.target.checked })} /> Serial</label>
                <label><input type="checkbox" checked={form.expiry} onChange={(event) => setForm({ ...form, expiry: event.target.checked })} /> Expiry</label>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border px-4 py-2">Cancel</button>
                <button type="submit" disabled={saving} className="rounded-xl bg-indigo-600 px-5 py-2 font-semibold text-white">
                  {saving ? "Saving…" : editing ? "Update Item" : "Save Item"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </AuthGate>
  );
}
