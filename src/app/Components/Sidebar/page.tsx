"use client";

import React, { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const icons = {
  dashboard: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  activity: "M4 17h3V7H4v10ZM10.5 17h3V4h-3v13ZM17 17h3v-7h-3v7Z",
  parties: "M16 20v-1.5c0-2-1.8-3.5-4-3.5H7c-2.2 0-4 1.5-4 3.5V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16 4.5a3.5 3.5 0 0 1 0 6.8M17 15c2.2 0 4 1.5 4 3.5V20",
  items: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4.5 7.5l7.5 4 7.5-4M12 11.5V21",
  sales: "M5 3h10l4 4v14H5V3ZM15 3v5h5M8 12h8M8 16h5",
  purchases: "M3 5h2l2 11h10l2-8H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  expenses: "M12 3v18M17 7.5c0-1.4-1.8-2.5-4-2.5s-4 1.1-4 2.5 1.8 2.5 4 2.5 4 1.1 4 2.5-1.8 2.5-4 2.5-4-1.1-4-2.5",
  orders: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5",
  money: "M4 7h16v12H4zM7 7V5h10v2M8 13h8M12 10v6",
  payments: "M3 7h18v10H3zM7 12h.01M17 12h.01M7 15h4",
  loans: "M3 10h18M5 10V7l7-4 7 4v3M7 10v8M12 10v8M17 10v8M3 18h18",
  reports: "M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6",
  tools: "M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-3 3-2-2 3-3Z",
  sync: "M20 7v5h-5M4 17v-5h5M6.2 9A7 7 0 0 1 19 7M18 15A7 7 0 0 1 5 17",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 12H2m20 0h-2M12 4V2m0 20v-2M6.3 6.3 4.9 4.9m14.2 14.2-1.4-1.4m0-11.4 1.4-1.4M4.9 19.1l1.4-1.4",
  user: "M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  search: "m21 21-4.5-4.5M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
};

const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={icons[name]} />
  </svg>
);

const Chevron = ({ expanded = false }) => (
  <svg
    className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const Sidebar = () => {
  const pathname = usePathname();
  const searchRef = useRef(null);
  const [openGroups, setOpenGroups] = useState({ sales: false, purchases: false, orders: false, cash: false, financial: false, gst: false, inventory: false, party: false });
  const [search, setSearch] = useState("");

  const groups = [
    { title: "Operations", links: [
      { label: "Parties", icon: "parties", href: "/customers" },
      { label: "Items", icon: "items", href: "/items" },
      { label: "Sales", icon: "sales", children: [{ label: "Sale invoices", href: "/sales" }, { label: "Estimates & quotations" }, { label: "Payment in", href: "/payments" }, { label: "Orders" }] },
      { label: "Purchases", icon: "purchases", children: [{ label: "Purchase bills" }, { label: "Payment out" }, { label: "Purchase orders" }, { label: "Purchase returns" }] },
      { label: "Expenses", icon: "expenses" },
      { label: "Orders", icon: "orders", children: [{ label: "Sales orders" }, { label: "Purchase orders" }, { label: "Delivery challans" }] },
    ] },
    { title: "Money", links: [
      { label: "Cash & Bank", icon: "money", children: [{ label: "Bank accounts" }, { label: "Cash in hand" }, { label: "Cheques" }] },
      { label: "Payments", icon: "payments", href: "/payments" },
      { label: "Loans", icon: "loans" },
    ] },
    { title: "Reports", links: [
      { label: "Financial reports", icon: "reports", children: [{ label: "Profit & loss" }, { label: "Cash flow" }, { label: "Balance sheet" }] },
      { label: "GST reports", icon: "reports", children: [{ label: "GSTR 1" }, { label: "GSTR 2" }, { label: "GSTR 3B" }] },
      { label: "Inventory reports", icon: "items", children: [{ label: "Stock summary" }, { label: "Stock detail" }] },
      { label: "Party reports", icon: "parties", children: [{ label: "Party statement", href: "/reports/party-wise-statement" }, { label: "Party profit & loss" }] },
    ] },
    { title: "Tools", links: [
      { label: "Barcode", icon: "tools" },
      { label: "Import / Export", icon: "tools" },
      { label: "Backup & Restore", icon: "tools" },
      { label: "Sync", icon: "sync" },
    ] },
    { title: "Administration", links: [
      { label: "Business settings", icon: "settings" },
      { label: "Users & Permissions", icon: "user" },
      { label: "Billing", icon: "payments" },
    ] },
  ];

  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const toggleGroup = (group) => {
    setOpenGroups((groups) => ({ ...groups, [group]: !groups[group] }));
  };

  const normalizedSearch = search.trim().toLowerCase();
  const visibleGroups = groups.map((group) => ({ ...group, links: group.links.filter((link) => !normalizedSearch || link.label.toLowerCase().includes(normalizedSearch)) })).filter((group) => group.links.length);

  return (
    <aside className="sticky top-0 flex h-screen max-h-screen w-full max-w-[276px] shrink-0 flex-col overflow-hidden border-r border-[#263244] bg-[#182230] text-[#d8e0eb]">
      <div className="border-b border-[#2a3748] px-5 py-5"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f5b544] text-[#182230] shadow-[0_5px_15px_rgba(245,181,68,0.22)]"><Icon name="items" /></div><div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8392a8]">Business Soft</p><button type="button" className="mt-0.5 flex max-w-full items-center gap-1 text-left text-[15px] font-semibold text-white"><span className="truncate">Ganpati Neer</span><Chevron /></button></div></div></div>
      <div className="px-4 py-4"><label className="flex h-10 items-center gap-2 rounded-lg border border-[#344258] bg-[#202c3d] px-3 text-[#aab8c9] focus-within:border-[#f5b544] focus-within:text-white"><span className="h-4 w-4 shrink-0"><Icon name="search" /></span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#8392a8]" aria-label="Search navigation" /><kbd className="rounded border border-[#435269] px-1.5 py-0.5 text-[10px] text-[#93a1b3]">Ctrl K</kbd></label></div>
      <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-color:#435269_#182230] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#182230] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#435269] [&::-webkit-scrollbar-thumb:hover]:bg-[#60718a]"><a href="/" className={`mb-5 flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors hover:bg-[#243247] ${pathname === "/" ? "bg-[#243247] text-white before:h-6 before:w-0.5 before:rounded-full before:bg-[#f5b544] before:content-['']" : "text-[#d8e0eb]"}`}><span className="h-[18px] w-[18px] text-[#f5b544]"><Icon name="dashboard" /></span><span>Dashboard</span></a><a href="#activity" className="mb-6 flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-[#aebbc9] transition-colors hover:bg-[#243247] hover:text-white"><span className="h-[18px] w-[18px] text-[#8392a8]"><Icon name="activity" /></span><span>Activity</span></a>{visibleGroups.map((group) => <section key={group.title} className="mb-6"><p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#718198]">{group.title}</p><div className="space-y-0.5">{group.links.map((link) => { const groupKey = link.label.toLowerCase().split(" ")[0]; const isOpen = openGroups[groupKey]; const isActive = link.href === pathname || link.children?.some((child) => child.href === pathname); if (!link.children) return <a key={link.label} href={link.href || `#${groupKey}`} className={`flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-[#243247] hover:text-white ${isActive ? "bg-[#243247] text-white" : "text-[#aebbc9]"}`}><span className={`h-[18px] w-[18px] ${isActive ? "text-[#f5b544]" : "text-[#8392a8]"}`}><Icon name={link.icon} /></span><span>{link.label}</span></a>; return <div key={link.label}><button type="button" aria-expanded={isOpen} onClick={() => toggleGroup(groupKey)} className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-[#243247] hover:text-white ${isActive ? "text-white" : "text-[#aebbc9]"}`}><span className={`h-[18px] w-[18px] ${isActive ? "text-[#f5b544]" : "text-[#8392a8]"}`}><Icon name={link.icon} /></span><span>{link.label}</span><span className="ml-auto text-[#8392a8]"><Chevron expanded={isOpen} /></span></button>{isOpen && <div className="ml-9 space-y-0.5 border-l border-[#344258] py-1 pl-2">{link.children.map((child) => <a key={child.label} href={child.href || `#${child.label.toLowerCase().replaceAll(" ", "-")}`} className={`flex min-h-8 items-center px-2 text-xs transition-colors hover:text-white ${pathname === child.href ? "font-semibold text-[#f5b544]" : "text-[#93a1b3]"}`}>{child.label}</a>)}</div>}</div>; })}</div></section>)}</nav>
      <div className="shrink-0 border-t border-[#2a3748] bg-[#182230] p-4"><div className="mb-4 flex items-center gap-2 rounded-lg bg-[#202c3d] px-3 py-2 text-xs text-[#b8c5d4]"><span className="h-2 w-2 rounded-full bg-[#46d18c] shadow-[0_0_0_3px_rgba(70,209,140,0.12)]" />Sync: Up to date</div><button type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[#243247]"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f5b544] text-sm font-bold text-[#182230]">SK</span><span className="min-w-0 flex-1 truncate text-sm font-medium text-white">Suraj Kumar</span><Chevron /></button></div>
    </aside>
  );
};

export default Sidebar;
