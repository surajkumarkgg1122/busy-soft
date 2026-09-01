export type ItemType = "product" | "service";
export type ItemStatus = "active" | "inactive";

export interface ItemTax {
  rate: number;
  inclusive: boolean;
}

export interface ItemUnitConversion {
  unitId: string;
  conversionFactor: number;
  isPurchaseUnit?: boolean;
  isSaleUnit?: boolean;
}

export interface ItemTracking {
  batch: boolean;
  serial: boolean;
  expiry: boolean;
}

export interface ItemStock {
  quantity: number;
  minimumQuantity: number;
  maximumQuantity?: number;
  reorderLevel?: number;
}

/** Domain item model. Firebase-specific types must not leak into the core/domain layer. */
export interface Item {
  itemId: string;
  itemCode: string;
  name: string;
  type: ItemType;
  categoryId?: string;
  brandId?: string;
  unitId?: string;
  alternateUnits?: ItemUnitConversion[];
  purchasePrice: number;
  salePrice: number;
  mrp?: number;
  tax?: ItemTax;
  hsnSac?: string;
  stock?: ItemStock;
  trackStock: boolean;
  tracking?: ItemTracking;
  barcode?: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  categoryId: string;
  name: string;
  description?: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Brand {
  brandId: string;
  name: string;
  description?: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Unit {
  unitId: string;
  name: string;
  shortName: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Warehouse {
  warehouseId: string;
  code: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}
