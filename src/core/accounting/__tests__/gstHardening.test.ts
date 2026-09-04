import { describe, expect, it } from "vitest";
import { calculateTax, reverseTax } from "../gst";
import { ValidationError } from "../errors";

describe("GST engine hardening",()=>{
  it("splits intra-state GST into CGST and SGST",()=>{
    const tax=calculateTax({taxableValue:10000,rate:18,intraState:true});
    expect(tax.cgst).toBe(900); expect(tax.sgst).toBe(900); expect(tax.igst).toBe(0); expect(tax.totalTax).toBe(1800); expect(tax.total).toBe(11800);
  });
  it("uses IGST for inter-state transactions",()=>{
    const tax=calculateTax({taxableValue:10000,rate:18,intraState:false});
    expect(tax.cgst).toBe(0); expect(tax.sgst).toBe(0); expect(tax.igst).toBe(1800); expect(tax.totalTax).toBe(1800);
  });
  it("handles cess and zero-rated tax",()=>{
    const cess=calculateTax({taxableValue:10000,rate:18,intraState:true,cessRate:2});
    expect(cess.cess).toBe(200); expect(cess.total).toBe(12000);
    const zero=calculateTax({taxableValue:10000,rate:0,intraState:true});
    expect(zero.totalTax).toBe(0); expect(zero.total).toBe(10000);
  });
  it("reverses every tax component exactly",()=>{
    const tax=calculateTax({taxableValue:12345,rate:18,intraState:true,cessRate:1});
    const reversed=reverseTax(tax);
    expect(reversed.taxableValue).toBe(-tax.taxableValue); expect(reversed.cgst).toBe(-tax.cgst); expect(reversed.sgst).toBe(-tax.sgst); expect(reversed.igst).toBe(-tax.igst); expect(reversed.cess).toBe(-tax.cess); expect(reversed.totalTax).toBe(-tax.totalTax); expect(reversed.total).toBe(-tax.total);
  });
  it("rejects invalid tax configuration",()=>{
    expect(()=>calculateTax({taxableValue:10000,rate:-1,intraState:true})).toThrow(ValidationError);
    expect(()=>calculateTax({taxableValue:10000,rate:101,intraState:true})).toThrow(ValidationError);
    expect(()=>calculateTax({taxableValue:10000,rate:18,intraState:true,cessRate:101})).toThrow(ValidationError);
  });
  it("preserves total tax across the CGST/SGST rounding split",()=>{
    const tax=calculateTax({taxableValue:9999,rate:5,intraState:true});
    expect(tax.cgst+tax.sgst).toBe(500); expect(tax.totalTax).toBe(500);
  });
});
