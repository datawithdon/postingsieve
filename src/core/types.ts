export type SalaryPeriod = "hour" | "day" | "week" | "month" | "year";
export type WorkMode = "remote" | "hybrid" | "onsite" | "unknown";
export type Seniority = "intern" | "junior" | "intermediate" | "senior" | "lead" | "manager" | "director" | "unknown";

/** What the model returns, before anything is checked against the posting. */
export interface RawExtraction {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: "CAD" | "USD" | "OTHER" | "UNKNOWN";
  salaryPeriod: SalaryPeriod | "unknown";
  salaryQuote: string;
  city: string | null;
  region: string | null;
  workMode: WorkMode;
  officeDaysPerWeek: number | null;
  workModeQuote: string;
  seniority: Seniority;
  requiredYears: number | null;
  yearsQuote: string;
  french: "required" | "preferred" | "not_mentioned";
  frenchQuote: string;
}

/** Checked extraction. Anything that couldn't be traced to the posting is null or "unknown". */
export interface Extraction {
  salary: { min: number | null; max: number | null; currency: "CAD" | "USD" | "OTHER"; period: SalaryPeriod; quote: string; source: "model" | "pattern" } | null;
  city: string | null;
  region: string | null;
  workMode: WorkMode;
  officeDaysPerWeek: number | null;
  workModeQuote: string;
  seniority: Seniority;
  requiredYears: number | null;
  yearsQuote: string;
  /** "mentioned": the posting names French but the model saw no requirement. */
  french: "required" | "preferred" | "mentioned" | "not_mentioned";
  frenchQuote: string;
  /** What the checks changed, in plain words, for the options-page tester. */
  corrections: string[];
}

export interface Criteria {
  /** Annual, in CAD. */
  salaryFloor: number | null;
  maxOfficeDays: number | null;
  commuteCities: string[];
  maxRequiredYears: number | null;
  rejectFrenchRequired: boolean;
}

export type Status = "pass" | "warn" | "fail";
export interface Reason { criterion: "salary" | "office" | "commute" | "years" | "french"; status: Status; text: string; quote?: string }
export type Verdict = "green" | "amber" | "red";
export interface Score { verdict: Verdict; reasons: Reason[] }

export type FailureCode = "needs-setup" | "unavailable" | "model-error" | "rate-limited" | "invalid";
export type Failure = { ok: false; code: FailureCode; message: string };

/** To the settings page only: includes the raw model output. */
export type ExtractResponse = { ok: true; extraction: Extraction; raw?: RawExtraction; cached: boolean } | Failure;

/** To a content script: what it needs if on-page badges are on, and no more. */
export type ScoreResponse = ({ ok: true; score: Score; facts: string } | { ok: false; code: "no-criteria"; message: string } | Failure) & { showOnPage: boolean };

/** A tab's current result, for the side panel. Lives in memory-only session storage. */
export type TabState =
  | { kind: "reading"; title: string }
  | { kind: "score"; title: string; score: Score; facts: string }
  | { kind: "message"; title: string; text: string; retry: boolean };

/** [job id, verdict] pairs, limited to the asking tab's own site. */
export type VerdictsResponse = [string, Verdict][];
