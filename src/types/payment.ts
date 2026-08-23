import type { Timestamp } from "firebase/firestore";

export type PaymentType = "receipt" | "payment";
export type PartyType = "customer" | "supplier" | "other";
export type PaymentMethod = "cash" | "upi" | "card" | "bank" | "cheque" | "other";

export interface Payment {
  paymentId: string;
  paymentNumber: string;
  type: PaymentType;
  partyType: PartyType;
  partyId?: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  date: Timestamp;
  notes?: string;
  createdBy: string;
  createdAt: Timestamp;
}
