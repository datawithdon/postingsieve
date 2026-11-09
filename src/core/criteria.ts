import type { Criteria } from "./types";

export const EMPTY_CRITERIA: Criteria = { salaryFloor: null, maxOfficeDays: null, commuteCities: [], maxRequiredYears: null, rejectFrenchRequired: false };

const bounded = (v: unknown, lo: number, hi: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null;

/** Stored data may be hand-edited or from an older version, so rebuild it on every load. */
export function sanitizeCriteria(v: unknown): Criteria {
  if (typeof v !== "object" || v === null) return { ...EMPTY_CRITERIA };
  const o = v as Record<string, unknown>;
  return {
    salaryFloor: bounded(o.salaryFloor, 0, 5_000_000),
    maxOfficeDays: bounded(o.maxOfficeDays, 0, 5),
    commuteCities: Array.isArray(o.commuteCities)
      ? [...new Set(o.commuteCities.filter((c): c is string => typeof c === "string").map((c) => c.trim().slice(0, 80)).filter(Boolean))].slice(0, 50)
      : [],
    maxRequiredYears: bounded(o.maxRequiredYears, 0, 60),
    rejectFrenchRequired: o.rejectFrenchRequired === true,
  };
}
