export type NavigationItem = {
  label: string;
  href: string;
  icon?: string;
  description?: string;
  children?: NavigationItem[];
};

// Keep the sidebar limited to routes that have a real implementation.
// Unimplemented modules are intentionally omitted until their pages are built.
export const navigation: NavigationItem[] = [
  { label: "Dashboard", href: "/", icon: "dashboard" },
  { label: "Customers", href: "/customers", icon: "parties" },
  { label: "Items", href: "/items", icon: "items" },
  {
    label: "Inventory",
    href: "/inventory",
    icon: "inventory",
    children: [
      { label: "Stock Summary", href: "/inventory" },
      { label: "Opening Stock", href: "/inventory/opening-stock" },
      { label: "Stock Adjustment", href: "/inventory/adjustment" },
      { label: "Stock Transfer", href: "/inventory/transfer" },
      { label: "Stock Ledger", href: "/inventory/ledger" },
      { label: "Batch / Expiry", href: "/inventory/batch-expiry" },
      { label: "Serial Numbers", href: "/inventory/serial-numbers" },
      { label: "Stock Valuation", href: "/inventory/valuation" },
      { label: "Manufacturing / BOM", href: "/items/manufacturing" },
      { label: "Production Entry", href: "/production" },
      { label: "Production Register", href: "/production/register" },
    ],
  },
  {
    label: "Sales",
    href: "/sales",
    icon: "sales",
    children: [
      { label: "Invoices", href: "/sales" },
      { label: "Quotations", href: "/quotations" },
    ],
  },
  { label: "Expenses", href: "/expenses", icon: "expenses" },
  { label: "Cash & Bank", href: "/cash-bank", icon: "cash-bank" },
  { label: "Payments", href: "/payments", icon: "payments" },
];

export function isNavigationActive(pathname: string, item: NavigationItem) {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
