import type { Money, TaxBreakdown, TaxInput } from "./types";
import { ValidationError } from "./errors";

export type GstSupplyType="b2b"|"b2c"|"exempt"|"nil_rated"|"zero_rated";
export type GstChargeMode="forward"|"reverse_charge";
export type GstRegistrationScheme="regular"|"composition";

export interface TaxCalculationInput extends TaxInput {
  supplyType?:GstSupplyType;
  chargeMode?:GstChargeMode;
  registrationScheme?:GstRegistrationScheme;
  partyStateCode?:string;
  businessStateCode?:string;
  hsnSac?:string;
  taxCode?:string;
  roundOff?:Money;
}

export interface TaxCalculationResult extends TaxBreakdown {
  supplyType:GstSupplyType;
  chargeMode:GstChargeMode;
  registrationScheme:GstRegistrationScheme;
  hsnSac?:string;
  taxCode?:string;
  roundOff:Money;
  preRoundTotal:Money;
}

function assertMoney(value: Money, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError(`${name} must be a non-negative integer minor-unit amount.`);
}
function assertSignedMoney(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) throw new ValidationError(`${name} must be a safe integer minor-unit amount.`);
}
function roundMoney(value:number):Money{const rounded=Math.round(value);if(!Number.isSafeInteger(rounded))throw new ValidationError("Calculated tax exceeds safe integer range.");return rounded;}
function normalizeSupplyType(input:TaxCalculationInput):GstSupplyType{
  if(input.supplyType)return input.supplyType;
  return "b2c";
}
function validateClassification(input:TaxCalculationInput,supply:GstSupplyType):void{
  if(input.partyStateCode!==undefined && !/^[0-9]{2}$/.test(input.partyStateCode))throw new ValidationError("Party state code must be a valid two-digit GST state code.");
  if(input.businessStateCode!==undefined && !/^[0-9]{2}$/.test(input.businessStateCode))throw new ValidationError("Business state code must be a valid two-digit GST state code.");
  if(input.partyStateCode&&input.businessStateCode && (input.intraState!==(input.partyStateCode===input.businessStateCode)))throw new ValidationError("GST place-of-supply state conflicts with intra/inter-state classification.");
  if(supply==="exempt"||supply==="nil_rated"||supply==="zero_rated"){
    if(input.rate!==0||Boolean(input.cessRate))throw new ValidationError(`${supply} supply must have zero GST and cess rate.`);
  }
  if(input.registrationScheme==="composition" && input.chargeMode!=="reverse_charge" && input.rate!==0)throw new ValidationError("Composition supply cannot use a normal GST tax rate in the invoice tax engine.");
  if(input.chargeMode!=="forward" && input.chargeMode!=="reverse_charge")throw new ValidationError("Invalid GST charge mode.");
}

/** Authoritative GST calculator. Tax is computed only from the normalized taxable amount; callers must derive that amount after discounts. */
export function calculateTax(input: TaxCalculationInput): TaxCalculationResult {
  assertMoney(input.taxableValue,"taxableValue");
  if(!Number.isFinite(input.rate)||input.rate<0||input.rate>100)throw new ValidationError("Tax rate must be between 0 and 100%.");
  const cessRate=input.cessRate??0;
  if(!Number.isFinite(cessRate)||cessRate<0||cessRate>100)throw new ValidationError("Invalid cess rate.");
  const supply=normalizeSupplyType(input);
  const chargeMode=input.chargeMode??"forward";
  const registrationScheme=input.registrationScheme??"regular";
  validateClassification(input,supply);
  const totalGst=roundMoney(input.taxableValue*input.rate/100);
  const cess=roundMoney(input.taxableValue*cessRate/100);
  let cgst=0,sgst=0,igst=0;
  if(input.intraState){cgst=Math.floor(totalGst/2);sgst=totalGst-cgst;}else{igst=totalGst;}
  const totalTax=totalGst+cess;
  const preRoundTotal=input.taxableValue+totalTax;
  const roundOff=input.roundOff??0;
  assertSignedMoney(roundOff,"roundOff");
  return{taxableValue:input.taxableValue,cgst,sgst,igst,cess,totalTax,total:preRoundTotal+roundOff,supplyType:supply,chargeMode,registrationScheme,hsnSac:input.hsnSac,taxCode:input.taxCode,roundOff,preRoundTotal};
}

export function reverseTax(tax:TaxBreakdown):TaxBreakdown{return{taxableValue:-tax.taxableValue,cgst:-tax.cgst,sgst:-tax.sgst,igst:-tax.igst,cess:-tax.cess,totalTax:-tax.totalTax,total:-tax.total};}

export function inferIntraState(partyStateCode:string,businessStateCode:string):boolean{
  if(!/^[0-9]{2}$/.test(partyStateCode)||!/^[0-9]{2}$/.test(businessStateCode))throw new ValidationError("GST state codes must be two digits.");
  return partyStateCode===businessStateCode;
}
