import type { Money } from "./types";
import { ValidationError } from "./errors";

export function assertMoney(value: Money, name = "Amount"): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError(`${name} must be a non-negative integer minor-unit amount.`);
}

export function addMoney(a: Money, b: Money): Money { assertMoney(a, "Money"); assertMoney(b, "Money"); const v = a + b; assertMoney(v, "Money total"); return v; }
export function subtractMoney(a: Money, b: Money): Money { assertMoney(a, "Money"); assertMoney(b, "Money"); const v = a - b; if (!Number.isSafeInteger(v)) throw new ValidationError("Money result exceeds safe integer range."); return v; }
export function multiplyMoney(amount: Money, factor: number): Money { assertMoney(amount, "Amount"); if (!Number.isFinite(factor) || factor < 0) throw new ValidationError("Multiplier must be non-negative."); const v = Math.round(amount * factor); assertMoney(v, "Calculated amount"); return v; }
export function percentage(amount: Money, rate: number): Money { if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new ValidationError("Percentage must be between 0 and 100."); return Math.round(amount * rate / 100); }
export function assertQuantity(quantity: number, name = "Quantity"): void { if (!Number.isFinite(quantity) || quantity <= 0) throw new ValidationError(`${name} must be greater than zero.`); }
export function roundToPaise(value: number): Money { if (!Number.isFinite(value)) throw new ValidationError("Amount must be finite."); const v = Math.round(value); assertMoney(v, "Amount"); return v; }
