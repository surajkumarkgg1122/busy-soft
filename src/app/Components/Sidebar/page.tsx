"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navigation, isNavigationActive, type NavigationItem } from "../../../config/navigation";
import { SidebarSyncIndicator } from "../../../components/sync/SidebarSyncIndicator";

const icons: Record<string, string> = {
  dashboard: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  activity: "M4 17h3V7H4v10ZM10.5 17h3V4h-3v13ZM17 17h3v-7h-3v7Z",
  parties: "M16 20v-1.5c0-2-1.8-3.5-4-3.5H7c-2.2 0-4 1.5-4 3.5V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16 4.5a3.5 3.5 0 0 1 0 6.8M17 15c2.2 0 4 1.5 4 3.5V20",
  items: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4.5 7.5l7.5 4 7.5-4M12 11.5V21",
  sales: "M5 3h10l4 4v14H5V3ZM15 3v5h5M8 12h8M8 16h5",
  purchases: "M3 5h2l2 11h10l2-8H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  expenses: "M12 3v18M17 7.5c0-1.4-1.8-2.5-4-2.5s-4 1.1-4 2.5 1.8 2.5 4 2.5 4 1.1 4 2.5-1.8 2.5-4 2.5-4-1.1-4-2.5",
  orders: "M4 4h16v16H4zM8 8h8M8 12h8M8 16h5",
  "cash-bank": "M4 7h16v12H4zM7 7V5h10v2M8 13h8M12 10v6",
  payments: "M3 7h18v10H3zM7 12h.01M17 12h.01M7 15h4",
  loans: "M3 10h18M5 10V7l7-4 7 4v3M7 10v8M12 10v8M17 10v8M3 18h18",
  reports: "M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-6",
  gst: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  inventory: "m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3ZM4.5 7.5l7.5 4 7.5-4M12 11.5V21",
  "party-reports": "M16 20v-1.5c0-2-1.8-3.5-4-3.5H7c-2.2 0-4 1.5-4 3.5V20M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM16 4.5a3.5 3.5 0 0 1 0 6.8M17 15c2.2 0 4 1.5 4 3.5V20",
  tools: "M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-3 3-2-2 3-3Z",
  settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0-8ZM4 12H2m20 0h-2M12 4V2m0 20v-2M6.3 6.3 4.9 4.9m14.2 14.2-1.4-1.4m0-11.4 1.4-1.4M4.9 19.1l1.4-1.4",
  search: "m21 21-4.5-4.5M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  menu: "M4 6h16M4 12h16M4 18h16",
};

const Icon = ({ name }: { name?: string }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-full w-full"><path d={icons[name || "items"] || icons.items} /></svg>;
const Chevron = ({ expanded = false }: { expanded?: boolean }) => <svg className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>;
const CollapseIcon = ({ collapsed }: { collapsed: boolean }) => <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{collapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}</svg>;
const sections: { title: string; labels: string[] }[] = [
  { title: "Operations", labels: ["Parties", "Items", "Sales", "Purchases", "Expenses", "Orders"] },
  { title: "Money", labels: ["Cash & Bank", "Payments", "Loans"] },
  { title: "Reports", labels: ["Reports", "GST Reports", "Inventory", "Party Reports"] },
  { title: "Tools", labels: ["Tools"] },
  { title: "Administration", labels: ["Administration"] },
];
const STORAGE_KEY = "erp.sidebar.collapsed";

const Sidebar = () => {
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => { try { setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true"); } catch { setCollapsed(false); } }, []);
  useEffect(() => { const active = navigation.find((item) => isNavigationActive(pathname, item)); if (active?.children) setOpenGroups((current) => ({ ...current, [active.label]: true })); }, [pathname]);
  useEffect(() => { const handleShortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (collapsed) setCollapsed(false); window.setTimeout(() => searchRef.current?.focus(), 0); } }; window.addEventListener("keydown", handleShortcut); return () => window.removeEventListener("keydown", handleShortcut); }, [collapsed]);

  const toggleGroup = (label: string) => { if (collapsed) { setCollapsed(false); window.setTimeout(() => setOpenGroups((current) => ({ ...current, [label]: true })), 0); return; } setOpenGroups((current) => ({ ...current, [label]: !current[label] })); };
  const toggleCollapsed = () => setCollapsed((current) => { const next = !current; try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch {} return next; });
  const matchesSearch = (item: NavigationItem) => { if (!search.trim()) return true; const query = search.trim().toLowerCase(); return item.label.toLowerCase().includes(query) || Boolean(item.children?.some((child) => child.label.toLowerCase().includes(query))); };
  const getItem = (label: string) => navigation.find((item) => item.label === label);

  const renderItem = (item: NavigationItem) => {
    const active = isNavigationActive(pathname, item);
    const open = openGroups[item.label] || Boolean(search.trim());
    if (!item.children) return <Link key={item.label} href={item.href} title={collapsed ? item.label : undefined} className={`group flex h-9 items-center rounded-lg text-sm font-medium transition-colors hover:bg-[#243247] hover:text-white ${collapsed ? "justify-center px-2" : "gap-3 px-3"} ${active ? "bg-[#243247] text-white" : "text-[#aebbc9]"}`}><span className={`h-[18px] w-[18px] shrink-0 ${active ? "text-[#f5b544]" : "text-[#8392a8]"}`}><Icon name={item.icon} /></span>{!collapsed && <span>{item.label}</span>}</Link>;
    const children = item.children.filter((child) => !search.trim() || child.label.toLowerCase().includes(search.trim().toLowerCase()) || item.label.toLowerCase().includes(search.trim().toLowerCase()));
    if (collapsed) return <div key={item.label}><button type="button" title={item.label} aria-expanded={open} onClick={() => toggleGroup(item.label)} className={`flex h-9 w-full items-center justify-center rounded-lg transition-colors hover:bg-[#243247] hover:text-white ${active ? "text-white" : "text-[#aebbc9]"}`}><span className={`h-[18px] w-[18px] ${active ? "text-[#f5b544]" : "text-[#8392a8]"}`}><Icon name={item.icon} /></span></button></div>;
    return <div key={item.label}><button type="button" aria-expanded={open} onClick={() => toggleGroup(item.label)} className={`flex h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium transition-colors hover:bg-[#243247] hover:text-white ${active ? "text-white" : "text-[#aebbc9]"}`}><span className={`h-[18px] w-[18px] ${active ? "text-[#f5b544]" : "text-[#8392a8]"}`}><Icon name={item.icon} /></span><span>{item.label}</span><span className="ml-auto text-[#8392a8]"><Chevron expanded={open} /></span></button>{open && <div className="ml-9 space-y-0.5 border-l border-[#344258] py-1 pl-2">{children.map((child) => <Link key={child.label} href={child.href} className={`flex min-h-8 items-center px-2 text-xs transition-colors hover:text-white ${pathname === child.href ? "font-semibold text-[#f5b544]" : "text-[#93a1b3]"}`}>{child.label}</Link>)}</div>}</div>;
  };

  return <aside className={`sticky top-0 flex h-screen max-h-screen shrink-0 flex-col overflow-hidden border-r border-[#263244] bg-[#182230] text-[#d8e0eb] transition-[width] duration-200 ${collapsed ? "w-[72px]" : "w-full max-w-[276px]"}`}>
    <div className={`${collapsed ? "px-2" : "px-5"} border-b border-[#2a3748] py-4`}><div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f5b544] text-[#182230] shadow-[0_5px_15px_rgba(245,181,68,0.22)]"><Icon name="items" /></div>{!collapsed && <div className="min-w-0"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8392a8]">Business Soft</p><button type="button" className="mt-0.5 flex max-w-full items-center gap-1 text-left text-[15px] font-semibold text-white"><span className="truncate">Ganpati Neer</span><Chevron /></button></div>}</div><button type="button" onClick={toggleCollapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} className={`absolute top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-[#344258] bg-[#202c3d] text-[#aebbc9] transition hover:bg-[#2a394d] hover:text-white ${collapsed ? "left-[56px]" : "right-2"}`}><CollapseIcon collapsed={collapsed} /></button></div>
    {!collapsed && <div className="px-4 py-4"><label className="flex h-10 items-center gap-2 rounded-lg border border-[#344258] bg-[#202c3d] px-3 text-[#aab8c9] focus-within:border-[#f5b544] focus-within:text-white"><span className="h-4 w-4 shrink-0"><Icon name="search" /></span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#8392a8]" aria-label="Search navigation" /><kbd className="rounded border border-[#435269] px-1.5 py-0.5 text-[10px] text-[#93a1b3]">Ctrl K</kbd></label></div>}
    <nav aria-label="Main navigation" className={`${collapsed ? "px-2" : "px-3"} min-h-0 flex-1 overflow-y-auto pb-4 [scrollbar-color:#435269_#182230] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#182230] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#435269] [&::-webkit-scrollbar-thumb:hover]:bg-[#60718a]`}><Link href="/" title={collapsed ? "Dashboard" : undefined} className={`mb-5 flex h-10 items-center rounded-lg text-sm font-semibold transition-colors hover:bg-[#243247] ${collapsed ? "justify-center px-2" : "gap-3 px-3"} ${pathname === "/" ? "bg-[#243247] text-white before:h-6 before:w-0.5 before:rounded-full before:bg-[#f5b544] before:content-['']" : "text-[#d8e0eb]"}`}><span className="h-[18px] w-[18px] shrink-0 text-[#f5b544]"><Icon name="dashboard" /></span>{!collapsed && <span>Dashboard</span>}</Link><div title={collapsed ? "Activity" : undefined} className={`mb-6 flex h-10 items-center rounded-lg text-sm font-medium text-[#aebbc9] ${collapsed ? "justify-center px-2" : "gap-3 px-3"}`}><span className="h-[18px] w-[18px] shrink-0 text-[#8392a8]"><Icon name="activity" /></span>{!collapsed && <span>Activity</span>}</div>{sections.map((section) => { const items = section.labels.map(getItem).filter((item): item is NavigationItem => Boolean(item)).filter(matchesSearch); if (!items.length) return null; return <section key={section.title} className="mb-6"><p className={`${collapsed ? "sr-only" : "mb-2 px-3"} text-[10px] font-bold uppercase tracking-[0.18em] text-[#718198]`}>{section.title}</p><div className="space-y-0.5">{items.map(renderItem)}</div></section>; })}</nav>
    <div className={`${collapsed ? "p-2" : "p-4"} shrink-0 border-t border-[#2a3748] bg-[#182230]`}>
      {!collapsed && <SidebarSyncIndicator />}
      {collapsed && <Link href="/sync-center" title="Sync Center" className="mb-2 flex h-9 items-center justify-center rounded-lg text-[#aebbc9] hover:bg-[#243247] hover:text-white"><span className="h-4 w-4 rounded-full bg-[#12b76a]" /></Link>}
      <button type="button" title="User profile" className={`flex w-full items-center rounded-lg py-2 text-left transition-colors hover:bg-[#243247] ${collapsed ? "justify-center px-1" : "gap-3 px-2"}`}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f5b544] text-sm font-bold text-[#182230]">SK</span>{!collapsed && <><span className="min-w-0 flex-1 truncate text-sm font-medium text-white">Suraj Kumar</span><Chevron /></>}</button>
    </div>
  </aside>;
};

export default Sidebar;
