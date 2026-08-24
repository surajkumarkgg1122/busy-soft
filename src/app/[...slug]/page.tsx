import Link from "next/link";

const PAGE_CONFIG: Record<string, { title: string; description: string; action?: string }> = {
  suppliers: { title: "Suppliers", description: "Manage supplier accounts, balances, contacts and purchase history.", action: "New supplier" },
  "items/services": { title: "Services", description: "Manage service items, pricing, tax rates and service codes.", action: "New service" },
  "items/units": { title: "Units", description: "Manage measurement units used across products and transactions.", action: "New unit" },
  "items/categories": { title: "Item Categories", description: "Organize products and services into reusable categories.", action: "New category" },
  purchases: { title: "Purchase Bills", description: "Record purchases, supplier balances, taxes and stock receipts.", action: "New purchase" },
  "purchases/orders": { title: "Purchase Orders", description: "Create and track purchase orders sent to suppliers.", action: "New purchase order" },
  "purchases/returns": { title: "Purchase Returns", description: "Record returned goods and update supplier and stock balances.", action: "New purchase return" },
  expenses: { title: "Expenses", description: "Track business expenses, payment accounts and expense categories.", action: "New expense" },
  "expenses/categories": { title: "Expense Categories", description: "Manage categories used for expense classification and reporting.", action: "New category" },
  orders: { title: "All Orders", description: "View and manage orders across your business.", action: "New order" },
  "orders/pending": { title: "Pending Orders", description: "Orders waiting for fulfilment, delivery or completion." },
  "orders/completed": { title: "Completed Orders", description: "Completed customer orders and fulfilment history." },
  "cash-bank/cash": { title: "Cash Book", description: "Track cash receipts, payments and running cash balance.", action: "New cash entry" },
  "cash-bank/bank": { title: "Bank Accounts", description: "Manage business bank accounts and opening balances.", action: "Add bank account" },
  "cash-bank/transactions": { title: "Bank Transactions", description: "Review deposits, withdrawals, transfers and reconciliations.", action: "New transaction" },
  "loans/given": { title: "Loans Given", description: "Track money lent to customers, staff or other parties.", action: "New loan" },
  "loans/taken": { title: "Loans Taken", description: "Track business borrowings, repayments and outstanding balances.", action: "New loan" },
  reports: { title: "Reports", description: "Business intelligence and accounting reports in one workspace." },
  "reports/party-wise-statement": { title: "Party-wise Statement", description: "View account statements for customers and suppliers." },
  "reports/sales": { title: "Sales Report", description: "Analyze sales by date, customer, item and payment status." },
  "reports/purchases": { title: "Purchase Report", description: "Analyze purchases by supplier, item, tax and period." },
  "reports/sales-register": { title: "Sales Register", description: "Detailed register of all sales invoices and returns." },
  "reports/purchase-register": { title: "Purchase Register", description: "Detailed register of purchase bills and returns." },
  "reports/cash-book": { title: "Cash Book Report", description: "Review cash movement and closing balance by period." },
  "reports/bank-book": { title: "Bank Book Report", description: "Review bank movement and closing balances by account." },
  "reports/day-book": { title: "Day Book", description: "Chronological view of business transactions." },
  "reports/profit-loss": { title: "Profit & Loss", description: "Review income, expenses and net profit for a selected period." },
  "reports/balance-sheet": { title: "Balance Sheet", description: "Review assets, liabilities and business equity." },
  "reports/gst": { title: "GST Reports", description: "GST compliance, tax summaries and return preparation." },
  "reports/gst/gstr-1": { title: "GSTR-1", description: "Prepare outward supply data for GSTR-1 review and filing." },
  "reports/gst/gstr-3b": { title: "GSTR-3B", description: "Review taxable supplies, input tax credit and GST liability." },
  "reports/gst/summary": { title: "GST Summary", description: "Consolidated output tax, input tax and net GST summary." },
  inventory: { title: "Stock Summary", description: "Monitor stock quantity, value, reorder levels and availability." },
  "inventory/movements": { title: "Stock Movement", description: "Trace stock received, sold, returned and adjusted." },
  "inventory/adjustment": { title: "Stock Adjustment", description: "Record physical stock corrections and adjustment reasons.", action: "New adjustment" },
  "inventory/low-stock": { title: "Low Stock", description: "Identify products that need replenishment." },
  "inventory/valuation": { title: "Stock Valuation", description: "Review inventory value using your selected valuation method." },
  "reports/parties": { title: "Party Reports", description: "Receivables, payables and party ledger reports." },
  "reports/parties/receivables": { title: "Receivables", description: "Track outstanding customer balances and collection status." },
  "reports/parties/payables": { title: "Payables", description: "Track supplier balances and upcoming payments." },
  "reports/parties/customer-ledger": { title: "Customer Ledger", description: "Detailed customer-wise debit, credit and balance history." },
  "reports/parties/supplier-ledger": { title: "Supplier Ledger", description: "Detailed supplier-wise debit, credit and balance history." },
  tools: { title: "Tools", description: "Data utilities for importing, exporting and protecting business information." },
  "tools/import": { title: "Import Data", description: "Import customers, suppliers, items and transactions from supported files.", action: "Start import" },
  "tools/export": { title: "Export Data", description: "Export business data for analysis, sharing or migration.", action: "Export data" },
  "tools/backup": { title: "Backup", description: "Create and manage business data backups." , action: "Create backup"},
  settings: { title: "Administration", description: "Configure business-wide preferences, users and transaction settings." },
  "settings/users": { title: "Users & Roles", description: "Manage team members, permissions and access levels.", action: "Invite user" },
  "settings/invoices": { title: "Invoice Settings", description: "Configure invoice numbering, layout, printing and transaction defaults." },
  "settings/taxes": { title: "Taxes", description: "Configure GST rates, tax groups and business tax preferences.", action: "Add tax rate" },
};

function titleFromSlug(slug: string[]) {
  return slug.map((part) => part.replace(/-/g, " ")).map((part) => part.replace(/\b\w/g, (c) => c.toUpperCase())).join(" / ");
}

const rows = [
  ["Opening balance", "—", "—", "₹ 0.00"],
  ["Current period", "—", "—", "₹ 0.00"],
  ["Pending", "—", "—", "₹ 0.00"],
  ["Closing balance", "—", "—", "₹ 0.00"],
];

export default async function WorkspacePage({ params }: { params: Promise<{ slug: string[] }> }) {
  const { slug } = await params;
  const key = slug.join("/");
  const config = PAGE_CONFIG[key] || { title: titleFromSlug(slug), description: "Manage this business workspace from one place.", action: "Add new" };

  return (
    <main className="min-h-full bg-[var(--erp-background)] p-5 md:p-7">
      <div className="mx-auto max-w-[1500px]">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-[var(--erp-text-muted)]">
              <Link href="/" className="hover:text-[var(--erp-primary)]">Dashboard</Link>
              <span>/</span>
              <span>{config.title}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--erp-text)]">{config.title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-[var(--erp-text-muted)]">{config.description}</p>
          </div>
          {config.action && <button className="erp-btn-primary h-10 shrink-0 rounded-lg px-4 text-sm font-semibold">+ {config.action}</button>}
        </div>

        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[['Total', '₹ 0.00'], ['This month', '₹ 0.00'], ['Pending', '0'], ['Transactions', '0']].map(([label, value]) => (
            <div key={label} className="erp-card rounded-xl p-4">
              <p className="text-xs font-medium text-[var(--erp-text-muted)]">{label}</p>
              <p className="mt-2 text-xl font-bold text-[var(--erp-text)]">{value}</p>
              <div className="mt-2 h-1 rounded-full bg-[var(--erp-border)]"><div className="h-1 w-1/3 rounded-full bg-[var(--erp-primary)]" /></div>
            </div>
          ))}
        </div>

        <div className="erp-card overflow-hidden rounded-xl">
          <div className="flex flex-col gap-3 border-b border-[var(--erp-border)] p-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold text-[var(--erp-text)]">Recent activity</h2>
              <p className="text-xs text-[var(--erp-text-muted)]">Live business data will appear here as this module is configured.</p>
            </div>
            <div className="flex gap-2">
              <input className="erp-input h-9 w-52 rounded-lg px-3 text-sm" placeholder="Search..." />
              <button className="h-9 rounded-lg border border-[var(--erp-border)] bg-white px-3 text-sm font-medium text-[var(--erp-text)]">Filter</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-[#fafafa] text-xs uppercase tracking-wide text-[var(--erp-text-muted)]">
                <tr>{['Description', 'Reference', 'Date', 'Amount'].map((h) => <th key={h} className="px-5 py-3 font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row) => <tr key={row[0]} className="border-t border-[var(--erp-border)]"><td className="px-5 py-4 font-medium text-[var(--erp-text)]">{row[0]}</td><td className="px-5 py-4 text-[var(--erp-text-muted)]">{row[1]}</td><td className="px-5 py-4 text-[var(--erp-text-muted)]">{row[2]}</td><td className="px-5 py-4 font-semibold text-[var(--erp-text)]">{row[3]}</td></tr>)}
              </tbody>
            </table>
          </div>
          <div className="border-t border-[var(--erp-border)] bg-[#fafafa] px-5 py-3 text-xs text-[var(--erp-text-muted)]">This is the initial workspace UI. We can make each module fully functional after your visual review.</div>
        </div>
      </div>
    </main>
  );
}
