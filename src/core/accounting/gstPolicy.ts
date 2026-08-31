import { ValidationError } from "./errors";

export type GstRegistrationType = "regular" | "composition" | "unregistered" | "other";
export type GstTaxMode = "exclusive" | "inclusive";

/** Validate the structural format of an Indian GSTIN. The checksum is intentionally separate. */
export function isValidGstinFormat(gstin: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(gstin.trim().toUpperCase());
}

export function assertValidGstin(gstin: string): string {
  const value = gstin.trim().toUpperCase();
  if (!isValidGstinFormat(value)) throw new ValidationError("Invalid GSTIN format.");
  return value;
}

export function validateGstSettings(input:{enabled:boolean;registrationType:GstRegistrationType;gstin?:string}):void {
  if (!input.enabled) return;
  if (input.registrationType === "regular" || input.registrationType === "composition") {
    if (!input.gstin) throw new ValidationError("GSTIN is required for a registered business.");
    assertValidGstin(input.gstin);
  }
  if (input.gstin) assertValidGstin(input.gstin);
}

export function normalizeStateCode(value:string):string {
  const code=value.trim();
  if (!/^\d{2}$/.test(code) || Number(code)<1 || Number(code)>38) throw new ValidationError("State code must be a valid two-digit GST state code.");
  return code;
}

export function classifyGstSupply(input:{supplierStateCode:string;placeOfSupplyCode:string}):"intra_state"|"inter_state" {
  return normalizeStateCode(input.supplierStateCode)===normalizeStateCode(input.placeOfSupplyCode) ? "intra_state" : "inter_state";
}

export function assertTaxMode(mode:GstTaxMode):void {
  if (mode!=="exclusive" && mode!=="inclusive") throw new ValidationError("Unsupported GST tax mode.");
}
