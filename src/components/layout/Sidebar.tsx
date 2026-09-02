"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const manufacturingLinks = [
  { href: "/items/manufacturing", label: "Manufacturing / BOM" },
  { href: "/production/planning", label: "Production Planning" },
  { href: "/production", label: "Production Entry" },
  { href: "/production/register", label: "Production Register" },
  { href: "/reports/manufacturing", label: "Manufacturing Reports" },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r border-slate-800 bg-[#0f172a] text-slate-200">
      <div className="flex h-full flex-col">
        <div className="border-b border-slate-800 px-5 py-4">
          <div className="text-lg font-bold tracking-tight text-white">BUSY Soft</div>
          <div className="text-xs text-slate-400">ERP & Accounting</div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Inventory & Manufacturing</div>
          {manufacturingLinks.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`mb-1 flex items-center rounded-md border-l-2 px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-indigo-500 bg-slate-800 text-white"
                    : "border-transparent text-slate-300 hover:bg-slate-800/70 hover:text-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
