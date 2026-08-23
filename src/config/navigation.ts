export type NavigationItem = {
  label: string;
  href: string;
  icon?: string;
  description?: string;
  children?: NavigationItem[];
};

export const navigation: NavigationItem[] = [
  { label: "Dashboard", href: "/", icon: "dashboard" },
  {
    label: "Parties",
    href: "/customers",
    icon: "parties",
    children: [
      { label: "Customers", href: "/customers" },
      { label: "Suppliers", href: "/suppliers" },
    ],
  },
  {
    label: "Items",
    href: "/items",
    icon: "items",
    children: [
      { label: "Products", href: "/items" },
      { label: "Services", href: "/items/services" },
      { label: "Units", href: "/items/units" },
      { label: "Categories", href: "/items/categories" },
    ],
  },
  {
    label: "Sales",
    href: "/sales",
    icon: "sales",
    children: [
      { label: "Invoices", href: "/sales" },
      { label: "Quotations", href: "/quotations" },
      { label: "Sales Orders", href: "/sales-orders" },
      { label: "Sales Returns", href: "/sales-returns" },
    ],
  },
  {
    label: "Purchases",
    href: "/purchases",
    icon: "purchases",
    children: [
      { label: "Purchase Bills", href: "/purchases" },
      { label: "Purchase Orders", href: "/purchases/orders" },
      { label: "Purchase Returns", href: "/purchases/returns" },
    ],
  },
  {
    label: "Expenses",
    href: "/expenses",
    icon: "expenses",
    children: [
      { label: "Expenses", href: "/expenses" },
      { label: "Expense Categories", href: "/expenses/categories" },
    ],
  },
  {
    label: "Orders",
    href: "/orders",
    icon: "orders",
    children: [
      { label: "All Orders", href: "/orders" },
      { label: "Pending Orders", href: "/orders/pending" },
      { label: "Completed Orders", href: "/orders/completed" },
    ],
  },
  {
    label: "Cash & Bank",
    href: "/cash-bank",
    icon: "cash-bank",
    children: [
      { label: "Cash Book", href: "/cash-bank/cash" },
      { label: "Bank Accounts", href: "/cash-bank/bank" },
      { label: "Bank Transactions", href: "/cash-bank/transactions" },
    ],
  },
  { label: "Payments", href: "/payments", icon: "payments" },
  {
    label: "Loans",
    href: "/loans",
    icon: "loans",
    children: [
      { label: "Loans Given", href: "/loans/given" },
      { label: "Loans Taken", href: "/loans/taken" },
    ],
  },
  {
    label: "Reports",
    href: "/reports",
    icon: "reports",
    children: [
      { label: "Party-wise Statement", href: "/reports/party-wise-statement" },
      { label: "Sales Report", href: "/reports/sales" },
      { label: "Purchase Report", href: "/reports/purchases" },
      { label: "Sales Register", href: "/reports/sales-register" },
      { label: "Purchase Register", href: "/reports/purchase-register" },
      { label: "Cash Book", href: "/reports/cash-book" },
      { label: "Bank Book", href: "/reports/bank-book" },
      { label: "Day Book", href: "/reports/day-book" },
      { label: "Profit & Loss", href: "/reports/profit-loss" },
      { label: "Balance Sheet", href: "/reports/balance-sheet" },
    ],
  },
  {
    label: "GST Reports",
    href: "/reports/gst",
    icon: "gst",
    children: [
      { label: "GSTR-1", href: "/reports/gst/gstr-1" },
      { label: "GSTR-3B", href: "/reports/gst/gstr-3b" },
      { label: "GST Summary", href: "/reports/gst/summary" },
    ],
  },
  {
    label: "Inventory",
    href: "/inventory",
    icon: "inventory",
    children: [
      { label: "Stock Summary", href: "/inventory" },
      { label: "Stock Movement", href: "/inventory/movements" },
      { label: "Stock Adjustment", href: "/inventory/adjustment" },
      { label: "Low Stock", href: "/inventory/low-stock" },
      { label: "Stock Valuation", href: "/inventory/valuation" },
    ],
  },
  {
    label: "Party Reports",
    href: "/reports/parties",
    icon: "party-reports",
    children: [
      { label: "Receivables", href: "/reports/parties/receivables" },
      { label: "Payables", href: "/reports/parties/payables" },
      { label: "Customer Ledger", href: "/reports/parties/customer-ledger" },
      { label: "Supplier Ledger", href: "/reports/parties/supplier-ledger" },
    ],
  },
  {
    label: "Tools",
    href: "/tools",
    icon: "tools",
    children: [
      { label: "Import Data", href: "/tools/import" },
      { label: "Export Data", href: "/tools/export" },
      { label: "Backup", href: "/tools/backup" },
    ],
  },
  {
    label: "Administration",
    href: "/settings",
    icon: "settings",
    children: [
      { label: "Business Settings", href: "/settings/business" },
      { label: "Users & Roles", href: "/settings/users" },
      { label: "Invoice Settings", href: "/settings/invoices" },
      { label: "Taxes", href: "/settings/taxes" },
    ],
  },
];

export function isNavigationActive(pathname: string, item: NavigationItem) {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
