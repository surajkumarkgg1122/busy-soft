"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Shortcut = { key: string; label: string; action?: string; href?: string; modifier: "alt" | "shift" | "ctrl" };

const shortcuts: Shortcut[] = [
  { modifier: "alt", key: "S", label: "Sale", action: "sale", href: "/sales" },
  { modifier: "alt", key: "P", label: "Purchase", action: "purchase" },
  { modifier: "alt", key: "I", label: "Payment-In", action: "payment-in", href: "/payments" },
  { modifier: "alt", key: "O", label: "Payment-Out", action: "payment-out", href: "/payments" },
  { modifier: "alt", key: "E", label: "Expense", action: "expense", href: "/expenses" },
  { modifier: "alt", key: "N", label: "Add Party", action: "add-party", href: "/customers" },
  { modifier: "alt", key: "A", label: "Add Item", action: "add-item", href: "/items" },
  { modifier: "alt", key: "F", label: "Sale Order", action: "sale-order" },
  { modifier: "alt", key: "G", label: "Purchase Order", action: "purchase-order" },
  { modifier: "alt", key: "D", label: "Delivery Challan", action: "delivery-challan" },
  { modifier: "alt", key: "M", label: "Estimate", action: "estimate", href: "/quotations" },
  { modifier: "alt", key: "R", label: "Cr. Note / Sale Return", action: "sale-return", href: "/sales-return" },
  { modifier: "alt", key: "L", label: "Dr. Note / Purchase Return", action: "purchase-return" },
  { modifier: "alt", key: "B", label: "Add Bank Account", action: "add-bank-account", href: "/cash-bank" },
  { modifier: "alt", key: "J", label: "Party to Party Transfer", action: "party-transfer" },
  { modifier: "shift", key: "H", label: "Home", href: "/" },
  { modifier: "shift", key: "P", label: "Parties", href: "/customers" },
  { modifier: "shift", key: "I", label: "Items", href: "/items" },
  { modifier: "shift", key: "R", label: "Reports", href: "/reports/party-wise-statement" },
  { modifier: "shift", key: "B", label: "Bank Accounts", href: "/cash-bank" },
  { modifier: "shift", key: "C", label: "Cash In Hand", href: "/cash-bank" },
  { modifier: "shift", key: "E", label: "Expenses", href: "/expenses" },
  { modifier: "shift", key: "O", label: "Orders", action: "orders" },
  { modifier: "shift", key: "S", label: "Estimate / Quotations", href: "/quotations" },
  { modifier: "shift", key: "U", label: "Cheques", action: "cheques" },
  { modifier: "shift", key: "1", label: "Settings", action: "settings" },
  { modifier: "shift", key: "2", label: "View Print Center", action: "print-center" },
  { modifier: "shift", key: "3", label: "Calculator", action: "calculator" },
  { modifier: "shift", key: "4", label: "Refer And Earn", action: "refer-earn" },
  { modifier: "ctrl", key: "S", label: "Save", action: "save" },
  { modifier: "ctrl", key: "N", label: "Save & New", action: "save-new" },
  { modifier: "ctrl", key: "P", label: "Save & Print", action: "save-print" },
  { modifier: "ctrl", key: "R", label: "Save & Preview", action: "save-preview" },
  { modifier: "ctrl", key: "E", label: "Generate Eway Bill", action: "eway-bill" },
];

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || element.isContentEditable;
}

function matches(event: KeyboardEvent, shortcut: Shortcut) {
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  const ctrl = event.ctrlKey || event.metaKey;
  if (shortcut.modifier === "alt") return event.altKey && !ctrl && !event.shiftKey && key === shortcut.key;
  if (shortcut.modifier === "shift") return event.shiftKey && !ctrl && !event.altKey && key === shortcut.key;
  return ctrl && !event.altKey && !event.shiftKey && key === shortcut.key;
}

export default function KeyboardShortcuts() {
  const router = useRouter();
  const pathname = usePathname();
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setShowHelp((value) => !value);
        return;
      }

      const shortcut = shortcuts.find((candidate) => matches(event, candidate));
      if (!shortcut) return;

      const typing = isTypingTarget(event.target);
      const isActivityCommand = shortcut.modifier === "ctrl";
      if (typing && !isActivityCommand) return;

      event.preventDefault();
      if (shortcut.href) router.push(shortcut.href);
      window.dispatchEvent(new CustomEvent("busy-soft:shortcut", { detail: { action: shortcut.action, label: shortcut.label, href: shortcut.href } }));
      if (shortcut.action) window.dispatchEvent(new CustomEvent(`busy-soft:${shortcut.action}`));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [router]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowHelp(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);

  if (!showHelp) return null;

  const groups = ["alt", "shift", "ctrl"] as const;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setShowHelp(false)}>
      <div className="max-h-[85vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b bg-white px-5 py-4">
          <div><h2 className="text-lg font-bold text-slate-800">BUSY Soft Shortcuts</h2><p className="text-xs text-slate-500">Keyboard-first navigation and accounting actions</p></div>
          <button type="button" onClick={() => setShowHelp(false)} className="rounded-md border px-3 py-1.5 text-sm">Close</button>
        </div>
        <div className="grid gap-6 p-5 md:grid-cols-3">
          {groups.map((group) => (
            <section key={group}>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-500">{group === "alt" ? "Actions" : group === "shift" ? "Navigation" : "Activities"}</h3>
              <div className="space-y-1">
                {shortcuts.filter((item) => item.modifier === group).map((item) => (
                  <div key={`${group}-${item.key}-${item.label}`} className={`flex items-center justify-between rounded-md px-2 py-1.5 ${item.href === pathname ? "bg-slate-100" : ""}`}>
                    <span className="text-sm text-slate-700">{item.label}</span>
                    <kbd className="rounded border bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{group === "ctrl" ? "Ctrl" : group === "alt" ? "Alt" : "Shift"} + {item.key}</kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="border-t bg-slate-50 px-5 py-3 text-xs text-slate-500">Ctrl+T / Ctrl+W / Ctrl+Tab are reserved for the future internal tab manager. Press Ctrl+K to open this shortcut guide.</div>
      </div>
    </div>
  );
}
