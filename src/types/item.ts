import type { Timestamp } from "firebase/firestore";

export type ItemType = "product" | "service";
export type ItemStatus = "active" | "inactive";

export interface ItemTax {
  rate: number;
  inclusive: boolean;
}

export interface ItemStock {
  quantity: number;
  minimumQuantity: number;
}

export interface Item {
  itemId: string;
  itemCode: string;
  name: string;
  type: ItemType;
  categoryId?: string;
  unitId?: string;
  purchasePrice: number;
  salePrice: number;
  tax?: ItemTax;
  stock?: ItemStock;
  trackStock: boolean;
  barcode?: string;
  status: ItemStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Category {
  categoryId: string;
  name: string;
  description?: string;
  status: ItemStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Unit {
  unitId: string;
  name: string;
  shortName: string;
  status: ItemStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
