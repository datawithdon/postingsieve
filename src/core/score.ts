import type { Criteria, Extraction, Reason, SalaryPeriod, Score } from "./types";
import { containsPhrase } from "./text";

const PER_YEAR: Record<SalaryPeriod, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

export const hasAnyCriteria = (c: Criteria) =>
  c.salaryFloor !== null || c.maxOfficeDays !== null || c.commuteCities.length > 0 || c.maxRequiredYears !== null || c.rejectFrenchRequired;

function scoreSalary(floor: number, e: Extraction): Reason {
  const s = e.salary;
  if (!s) return { criterion: "salary", status: "warn", text: `No salary listed (your floor: ${money(floor)})` };
  const quote = s.quote || undefined;
  if (s.currency !== "CAD") return { criterion: "salary", status: "warn", text: `Salary is in ${s.currency === "USD" ? "USD" : "another currency"}, not compared to your floor`, quote };
  const k = PER_YEAR[s.period];
  const low = (s.min ?? s.max!) * k;
  const high = (s.max ?? s.min!) * k;
  const shown = low === high ? `${money(low)}/yr` : `${money(low)}–${money(high)}/yr`;
  const hourly = s.period === "year" ? "" : " (at full-time hours)";
  if (high < floor) return { criterion: "salary", status: "fail", text: `Pays ${shown}${hourly}, under your ${money(floor)} floor`, quote };
  if (low >= floor) return { criterion: "salary", status: "pass", text: `Pays ${shown}${hourly}, meets your ${money(floor)} floor`, quote };
  return { criterion: "salary", status: "warn", text: `Pays ${shown}${hourly}: your ${money(floor)} floor is inside the range`, quote };
}

function scoreOffice(maxDays: number, e: Extraction): Reason {
  const quote = e.workModeQuote || undefined;
  const limit = `your limit is ${maxDays}`;
  if (e.workMode === "remote") return { criterion: "office", status: "pass", text: "Fully remote", quote };
  if (e.workMode === "unknown") return { criterion: "office", status: "warn", text: "Doesn't say remote, hybrid or on-site", quote };
  const days = e.officeDaysPerWeek ?? (e.workMode === "onsite" ? 5 : null);
  if (days === null) return { criterion: "office", status: "warn", text: `Hybrid, but no office days stated (${limit})`, quote };
  const label = e.workMode === "onsite" && e.officeDaysPerWeek === null ? "On-site" : `${days} office day${days === 1 ? "" : "s"} a week`;
  return days <= maxDays
    ? { criterion: "office", status: "pass", text: `${label}, ${limit}`, quote }
    : { criterion: "office", status: "fail", text: `${label}, ${limit}`, quote };
}

function scoreCommute(cities: string[], e: Extraction): Reason {
  if (e.workMode === "remote") return { criterion: "commute", status: "pass", text: "Remote, so no commute" };
  if (!e.city) return { criterion: "commute", status: "warn", text: "No city found" };
  const match = cities.some((c) => containsPhrase(e.city!, c) || containsPhrase(c, e.city!));
  if (match) return { criterion: "commute", status: "pass", text: `Based in ${e.city}, on your list` };
  // Red needs evidence you'd actually have to travel, which an unknown work mode doesn't give.
  if (e.workMode === "unknown") return { criterion: "commute", status: "warn", text: `Based in ${e.city}, not on your list, and work mode is unclear` };
  return { criterion: "commute", status: "fail", text: `Based in ${e.city}, not on your list` };
}

function scoreYears(max: number, e: Extraction): Reason {
  const quote = e.yearsQuote || undefined;
  if (e.requiredYears === null) return { criterion: "years", status: "warn", text: "No required experience stated" };
  const y = `${e.requiredYears}+ years required`;
  return e.requiredYears <= max
    ? { criterion: "years", status: "pass", text: `${y}, your limit is ${max}`, quote }
    : { criterion: "years", status: "fail", text: `${y}, your limit is ${max}`, quote };
}

function scoreFrench(e: Extraction): Reason {
  const quote = e.frenchQuote || undefined;
  if (e.french === "required") return { criterion: "french", status: "fail", text: "French is required", quote };
  if (e.french === "preferred") return { criterion: "french", status: "warn", text: "French is an asset", quote };
  if (e.french === "mentioned") return { criterion: "french", status: "warn", text: "Mentions French: check whether it's required", quote };
  return { criterion: "french", status: "pass", text: "No French requirement" };
}

/** One line of what was read, for the badge panel. */
export function factsLine(e: Extraction): string {
  const parts: string[] = [];
  if (e.city) parts.push([e.city, e.region].filter(Boolean).join(", "));
  if (e.workMode !== "unknown") parts.push(e.workMode === "onsite" ? "on-site" : e.workMode);
  if (e.seniority !== "unknown") parts.push(e.seniority);
  return parts.join(" · ");
}

/** Plain rules, no model: same extraction and criteria always give the same score. */
export function score(c: Criteria, e: Extraction): Score {
  const reasons: Reason[] = [];
  if (c.salaryFloor !== null) reasons.push(scoreSalary(c.salaryFloor, e));
  if (c.maxOfficeDays !== null) reasons.push(scoreOffice(c.maxOfficeDays, e));
  if (c.commuteCities.length) reasons.push(scoreCommute(c.commuteCities, e));
  if (c.maxRequiredYears !== null) reasons.push(scoreYears(c.maxRequiredYears, e));
  if (c.rejectFrenchRequired) reasons.push(scoreFrench(e));
  const rank = { fail: 0, warn: 1, pass: 2 };
  reasons.sort((a, b) => rank[a.status] - rank[b.status]);
  const verdict = reasons.some((r) => r.status === "fail") ? "red" : reasons.some((r) => r.status === "warn") ? "amber" : "green";
  return { verdict, reasons };
}
