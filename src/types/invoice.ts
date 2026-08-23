import type { Timestamp } from "firebase/firestore";

export type InvoiceType = "sales" | "sales_return";
export type InvoiceStatus = "draft" | "confirmed" | "cancelled" | "void";
export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface InvoiceItem {
  itemId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  amount: number;
}

export interface Invoice {
  invoiceId: string;
  invoiceNumber: string;
  type: InvoiceType;
  customerId?: string;
  date: Timestamp;
  dueDate?: Timestamp;
  items: InvoiceItem[];
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  grandTotal: number;
  paidAmount: number;
  balanceAmount: number;
  paymentStatus: PaymentStatus;
  status: InvoiceStatus;
  notes?: string;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
