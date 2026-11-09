import type { Extraction, SalaryPeriod, Seniority, WorkMode } from "./types";

/** Longest posting accepted. Real ones are well under this. */
export const MAX_POSTING_CHARS = 100_000;

/**
 * Neutralize posting text before anything reads it. It is attacker-controlled: anyone can
 * publish a posting. This removes invisible characters that can hide instructions from the
 * reader or reorder displayed quotes, stops the text closing the prompt's delimiter, and
 * bounds the runs of digits and whitespace that make the regular expressions slow.
 */
export function cleanPostingText(text: string): string {
  return text
    .slice(0, MAX_POSTING_CHARS * 2)
    .replace(/[\p{Cf}\p{Co}\p{Cs}]/gu, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/\r\n?|[\u2028\u2029]/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n[ \n]*/g, "\n")
    .replace(/\d{16,}/g, " ")
    .replace(/"{3,}/g, "''")
    .slice(0, MAX_POSTING_CHARS)
    .trim();
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const opt = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const pick = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (allowed.includes(v as T) ? (v as T) : dflt);

const PERIODS: readonly SalaryPeriod[] = ["hour", "day", "week", "month", "year"];
const MODES: readonly WorkMode[] = ["remote", "hybrid", "onsite", "unknown"];
const SENIORITY: readonly Seniority[] = ["intern", "junior", "intermediate", "senior", "lead", "manager", "director", "unknown"];

/** Rebuild a stored extraction, so a corrupt or hand-edited entry can't reach scoring or the UI. */
export function sanitizeExtraction(v: unknown): Extraction | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  let salary: Extraction["salary"] = null;
  if (typeof o.salary === "object" && o.salary !== null) {
    const s = o.salary as Record<string, unknown>;
    const min = num(s.min, 0, 2_000_000), max = num(s.max, 0, 2_000_000);
    if ((min !== null || max !== null) && PERIODS.includes(s.period as SalaryPeriod)) {
      salary = {
        min, max,
        currency: pick(s.currency, ["CAD", "USD", "OTHER"] as const, "CAD"),
        period: s.period as SalaryPeriod,
        quote: str(s.quote, 300),
        source: pick(s.source, ["model", "pattern"] as const, "model"),
      };
    }
  }
  return {
    salary,
    city: opt(o.city, 100),
    region: opt(o.region, 100),
    workMode: pick(o.workMode, MODES, "unknown"),
    officeDaysPerWeek: num(o.officeDaysPerWeek, 0, 5),
    workModeQuote: str(o.workModeQuote, 300),
    seniority: pick(o.seniority, SENIORITY, "unknown"),
    requiredYears: num(o.requiredYears, 0, 60),
    yearsQuote: str(o.yearsQuote, 300),
    french: pick(o.french, ["required", "preferred", "mentioned", "not_mentioned"] as const, "not_mentioned"),
    frenchQuote: str(o.frenchQuote, 300),
    corrections: Array.isArray(o.corrections) ? o.corrections.filter((c): c is string => typeof c === "string").slice(0, 20).map((c) => c.slice(0, 300)) : [],
  };
}
