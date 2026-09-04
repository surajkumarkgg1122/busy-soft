import { ValidationError } from "./errors";
import type { FinancialYear } from "./types";

export interface FinancialYearResolution {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  startMonth: number;
}

/**
 * Single financial-year resolver for the accounting domain.
 * Indian businesses default to April-March, but the start month is explicit
 * so callers cannot silently embed a second FY rule.
 */
export function resolveFinancialYear(date: string, startMonth = 4): FinancialYearResolution {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ValidationError("Transaction date must be YYYY-MM-DD.");
  }
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new ValidationError("Financial year start month must be between 1 and 12.");
  }

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  if (month < 1 || month > 12) throw new ValidationError("Transaction date has an invalid month.");

  const startYear = month >= startMonth ? year : year - 1;
  const endYear = startYear + 1;
  const startDate = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const endDate = `${startYear + (endMonth < startMonth ? 1 : 0)}-${String(endMonth).padStart(2, "0")}-${daysInMonth(startYear + (endMonth < startMonth ? 1 : 0), endMonth)}`;
  const shortEnd = String(endYear).slice(-2);

  return {
    id: `fy-${startYear}-${shortEnd}`,
    name: `FY ${startYear}-${shortEnd}`,
    startDate,
    endDate,
    startMonth,
  };
}

export function assertDateInFinancialYear(date: string, financialYear: FinancialYear): void {
  if (financialYear.startDate > date || financialYear.endDate < date) {
    throw new ValidationError(`Transaction date ${date} is outside financial year ${financialYear.name}.`);
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
