import type { AuthoritativeInvoicePresentation } from "@/core/accounting/invoicePresentation";

const money = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);

export default function InvoiceDocument({ invoice }: { invoice: AuthoritativeInvoicePresentation }) {
  const s = invoice.settings;
  return (
    <article className={`busy-invoice busy-invoice-${s.paperSize.toLowerCase()}`} data-invoice-id={invoice.voucherId} data-invoice-total={invoice.total}>
      <header className="busy-invoice-header">
        {s.logoUrl && <img src={s.logoUrl} alt="Business logo" className="busy-invoice-logo" />}
        <div><h1>Tax Invoice</h1><div>Invoice No. {invoice.invoiceNumber}</div><div>Date {invoice.date}{invoice.dueDate ? ` · Due ${invoice.dueDate}` : ""}</div></div>
      </header>
      <table className="busy-invoice-lines"><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Tax %</th><th>Amount</th></tr></thead><tbody>
        {invoice.lines.map((line, index) => <tr key={`${line.itemId ?? "line"}-${index}`}><td>{line.description}</td><td>{line.quantity ?? "—"} {line.unit ?? ""}</td><td>{line.rate == null ? "—" : money(line.rate)}</td><td>{line.taxRate ?? "—"}</td><td>{line.amount == null ? "—" : money(line.amount)}</td></tr>)}
      </tbody></table>
      <section className="busy-invoice-summary">
        <div>Taxable Value <strong>{money(invoice.taxableValue)}</strong></div>
        {invoice.taxLines.filter((x) => x.amount).map((tax) => <div key={tax.accountId}>{tax.label} <strong>{money(tax.amount)}</strong></div>)}
        <div className="busy-invoice-grand-total">Grand Total <strong>{money(invoice.total)}</strong></div>
        <div>Paid <strong>{money(invoice.paidAmount)}</strong></div><div>Outstanding <strong>{money(invoice.outstandingAmount)}</strong></div>
      </section>
      {(s.bankDetails || s.upiId || s.qrValue) && <section className="busy-invoice-payment"><strong>Payment Details</strong>{s.bankDetails && <div>{s.bankDetails.name ?? ""}{s.bankDetails.accountNumber ? ` · A/C ${s.bankDetails.accountNumber}` : ""}{s.bankDetails.ifsc ? ` · IFSC ${s.bankDetails.ifsc}` : ""}</div>}{s.upiId && <div>UPI: {s.upiId}</div>}{s.qrValue && <div data-qr-value={s.qrValue}>UPI QR: {s.qrValue}</div>}</section>}
      {s.terms?.length ? <section><strong>Terms & Conditions</strong><ul>{s.terms.map((term) => <li key={term}>{term}</li>)}</ul></section> : null}
      {s.signatureUrl && <footer><img src={s.signatureUrl} alt="Authorized signature" className="busy-invoice-signature" /></footer>}
    </article>
  );
}
