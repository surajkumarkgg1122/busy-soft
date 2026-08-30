import type { Money, TaxBreakdown, TaxInput } from "./types";
import { ValidationError } from "./errors";

function assertMoney(value: Money, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError(`${name} must be a non-negative integer minor-unit amount.`);
}

function roundMoney(value: number): Money {
  const rounded = Math.round(value);
  if (!Number.isSafeInteger(rounded)) throw new ValidationError("Calculated tax exceeds safe integer range.");
  return rounded;
}

/** Calculates GST from a tax-exclusive taxable value. */
export function calculateTax(input: TaxInput): TaxBreakdown {
  assertMoney(input.taxableValue, "taxableValue");
  if (!Number.isFinite(input.rate) || input.rate < 0) throw new ValidationError("Tax rate must be a non-negative number.");
  if (input.rate > 100) throw new ValidationError("Tax rate cannot exceed 100%.");
  const cessRate = input.cessRate ?? 0;
  if (!Number.isFinite(cessRate) || cessRate < 0 || cessRate > 100) throw new ValidationError("Invalid cess rate.");

  const totalTax = roundMoney(input.taxableValue * input.rate / 100);
  const cess = roundMoney(input.taxableValue * cessRate / 100);
  const gst = totalTax;

  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  if (input.intraState) {
    cgst = Math.floor(gst / 2);
    sgst = gst - cgst;
  } else {
    igst = gst;
  }

  return {
    taxableValue: input.taxableValue,
    cgst,
    sgst,
    igst,
    cess,
    totalTax: gst + cess,
    total: input.taxableValue + gst + cess,
  };
}

export function reverseTax(tax: TaxBreakdown): TaxBreakdown {
  return {
    taxableValue: -tax.taxableValue,
    cgst: -tax.cgst,
    sgst: -tax.sgst,
    igst: -tax.igst,
    cess: -tax.cess,
    totalTax: -tax.totalTax,
    total: -tax.total,
  };
}
