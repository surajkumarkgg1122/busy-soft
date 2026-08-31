import { describe, expect, it } from "vitest";
import { assertValidGstin, classifyGstSupply, isValidGstinFormat, validateGstSettings } from "./gstPolicy";

describe("GST production policy validation",()=>{
  it("accepts a structurally valid GSTIN",()=>{const gstin="10ABCDE1234F1Z5";expect(isValidGstinFormat(gstin)).toBe(true);expect(assertValidGstin(gstin)).toBe(gstin);});
  it("rejects malformed GSTIN",()=>{expect(()=>assertValidGstin("10ABCDE1234F1" )).toThrow();});
  it("requires GSTIN for registered businesses",()=>{expect(()=>validateGstSettings({enabled:true,registrationType:"regular"})).toThrow(/GSTIN/i);});
  it("allows GST disabled without GSTIN",()=>{expect(()=>validateGstSettings({enabled:false,registrationType:"unregistered"})).not.toThrow();});
  it("classifies supplies by supplier and place-of-supply state",()=>{expect(classifyGstSupply({supplierStateCode:"10",placeOfSupplyCode:"10"})).toBe("intra_state");expect(classifyGstSupply({supplierStateCode:"10",placeOfSupplyCode:"09"})).toBe("inter_state");});
});
