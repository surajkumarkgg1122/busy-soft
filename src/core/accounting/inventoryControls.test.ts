import { describe, expect, it } from "vitest";
import { assertSaleQuantityAvailable, validateStockTracking } from "./inventoryControls";

describe("inventory controls",()=>{
  it("requires and validates batch numbers",()=>{expect(()=>validateStockTracking({mode:"batch",quantity:5,batchNo:"B-01"})).not.toThrow();expect(()=>validateStockTracking({mode:"batch",quantity:5})).toThrow(/batch/i);});
  it("requires one serial per unit",()=>{expect(()=>validateStockTracking({mode:"serial",quantity:2,serialNumbers:["S1","S2"]})).not.toThrow();expect(()=>validateStockTracking({mode:"serial",quantity:2,serialNumbers:["S1"]})).toThrow(/serial/i);});
  it("rejects duplicate serials",()=>{expect(()=>validateStockTracking({mode:"serial",quantity:2,serialNumbers:["S1","S1"]})).toThrow(/duplicate/i);});
  it("validates expiry date format",()=>{expect(()=>validateStockTracking({mode:"batch",quantity:1,batchNo:"B",expiryDate:"2027-04-01"})).not.toThrow();expect(()=>validateStockTracking({mode:"batch",quantity:1,batchNo:"B",expiryDate:"01-04-2027"})).toThrow(/expiry/i);});
  it("prevents stock oversell",()=>{expect(()=>assertSaleQuantityAvailable(5,5)).not.toThrow();expect(()=>assertSaleQuantityAvailable(5,6)).toThrow(/insufficient/i);});
});
