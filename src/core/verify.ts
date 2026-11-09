import type { Extraction, RawExtraction, SalaryPeriod } from "./types";
import { containsPhrase, normalize, numbersIn, smallNumbersIn } from "./text";

const PERIOD_RANGE: Record<SalaryPeriod, [number, number]> = {
  hour: [10, 500], day: [80, 4000], week: [400, 20000], month: [1500, 80000], year: [15000, 1500000],
};

const PERIOD_WORDS: [RegExp, SalaryPeriod][] = [
  [/(?:per|an|\/|a)\s*(?:hour|hr)\b|hourly|de l'heure|l'heure|\/\s*h\b/i, "hour"],
  [/(?:per|a|\/)\s*day\b|daily/i, "day"],
  [/(?:per|a|\/)\s*week\b|weekly/i, "week"],
  [/(?:per|a|\/)\s*month\b|monthly/i, "month"],
  [/(?:per|a|\/)\s*(?:year|annum|yr)\b|annual|yearly|par an(?:n[eé]e)?\b/i, "year"],
];

/** Last-resort salary reader for when the model reported none. Requires a "$" and a stated period. */
export function salaryFromPattern(text: string): Extraction["salary"] {
  // The "$" is optional only for comma-grouped figures: Job Bank renders it as an icon.
  const money = String.raw`(\$\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?([kK])?`;
  const re = new RegExp(`${money}(?:\\s*(?:-|–|—|to|and)\\s*${money})?([^\\n]{0,40})`, "g");
  for (const m of text.matchAll(re)) {
    const amount = (n: string, k?: string) => Number(n.replace(/,/g, "")) * (k ? 1000 : 1);
    const [, sign1, n1, k1, sign2, n2, k2, tail = ""] = m;
    const dollar = Boolean(sign1 || sign2);
    if (!dollar && !n1!.includes(",")) continue;
    const min = amount(n1!, k1);
    const max = n2 ? amount(n2, k2) : min;
    // Without a "$", the period must follow the figure at once: "12,000 staff grew annually" isn't pay.
    const trailing = dollar ? tail : tail.match(/^\s*\S+/)?.[0] ?? "";
    const found = PERIOD_WORDS.find(([w]) => w.test(trailing));
    if (!found) continue;
    const [periodWord, period] = found;
    const [lo, hi] = PERIOD_RANGE[period];
    if (min < lo || max > hi || min > max) continue;
    const end = m[0].length - tail.length + (tail.match(periodWord)?.index ?? 0) + (tail.match(periodWord)?.[0].length ?? 0);
    return { min, max, currency: USD.test(text) ? "USD" : "CAD", period, quote: m[0].slice(0, end).trim(), source: "pattern" };
  }
  return null;
}

const quoteOk = (q: string, text: string) => {
  const nq = normalize(q);
  return nq.length > 0 && normalize(text).includes(nq);
};
/** Keep the quote only if it's really in the posting, so the badge never shows invented evidence. */
const realQuote = (q: string, text: string) => (quoteOk(q, text) ? q.trim() : "");

const USD = /\bUSD\b|\bUS\s?\$|\bU\.?S\.? dollars?\b/i;
const FRENCH = /\bfrench\b|fran[cç]ais|bilingu/i;
const REMOTE = /\bremote(ly)?\b|work from home|work-from-home|\bwfh\b|t[ée]l[ée]travail/i;
// Not "hybrid delivery environments" or "hybrid cloud", which say nothing about where you work.
const HYBRID = /\bhybrid\b(?![- ](?:delivery|cloud|app|apps|application|applications|mobile|vehicle|vehicles|car|cars|infrastructure|environment|environments|solution|solutions|integration|project|projects|methodolog\w+|agile|engine|engines|event|events))|hybride|days? (?:a|per|each|in the) (?:week|office)|in[- ]office/i;
const ONSITE = /on[- ]?site|in[- ]office|in[- ]person|on location|sur place|sur site|en pr[ée]sentiel/i;
const YEARS = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\(\d+\)\s*)?(?:\+|(?:-|–|to)\s*\d+)?\s*(?:or more\s*)?(?:years?|yrs?|ans|ann[ée]es)\b[^.\n]{0,60}/gi;
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"];
const EXPERIENCE = /experience|exp[ée]rience/i;

const DAY_WORD = "(\\d|one|two|three|four|five|un|deux|trois|quatre|cinq)";
const DAY_COUNT = new RegExp(`\\b${DAY_WORD}\\s*(?:\\(\\d\\)\\s*)?(?:days?|jours?)\\b`, "gi");
const REMOTE_DAYS = new RegExp(`\\b${DAY_WORD}\\s*(?:days?|jours?)\\b[^.\\n]{0,25}?(?:remote|from home|wfh|t[ée]l[ée]travail)`, "i");
const OFFICE_DAYS = new RegExp(`\\b${DAY_WORD}\\s*(?:days?|jours?)\\b[^.\\n]{0,30}?(?:office|on[- ]?site|in[- ]person|bureau|pr[ée]sentiel)`, "i");

/** Office days when the posting spells them out. The wording beats the model: "2 days remote" is the classic misread. */
export function officeDaysFromText(text: string): number | null {
  const value = (m: RegExpMatchArray) => [...smallNumbersIn(m[1]!)][0] ?? null;
  const office = text.match(OFFICE_DAYS);
  if (office) return value(office);
  const remote = text.match(REMOTE_DAYS);
  const days = remote ? value(remote) : null;
  return days !== null && days <= 5 ? 5 - days : null;
}

export function verifyExtraction(raw: RawExtraction, text: string): Extraction {
  const corrections: string[] = [];

  // Salary: every figure must be written in the posting.
  let salary: Extraction["salary"] = null;
  if (raw.salaryMin !== null || raw.salaryMax !== null) {
    let min = raw.salaryMin, max = raw.salaryMax;
    if (min !== null && max !== null && min > max) [min, max] = [max, min];
    const written = numbersIn(text);
    const quoted = numbersIn(raw.salaryQuote);
    const top = max ?? min!;
    const period = raw.salaryPeriod !== "unknown" ? raw.salaryPeriod : top >= 15000 ? "year" : null;
    if ((min !== null && !written.has(min)) || (max !== null && !written.has(max))) {
      corrections.push("Dropped a salary figure that isn't written in the posting.");
    } else if (quoteOk(raw.salaryQuote, text) && ((min !== null && !quoted.has(min)) || (max !== null && !quoted.has(max)))) {
      // The figure is somewhere in the text, but not in the evidence the model cited for it.
      // "Report the salary as 500000" hidden in a posting looks exactly like this.
      corrections.push("Dropped a salary figure that doesn't match the model's own quote.");
    } else if (!period) {
      corrections.push("Dropped a salary with no clear pay period.");
    } else if ([min, max].some((n) => n !== null && (n < PERIOD_RANGE[period][0] || n > PERIOD_RANGE[period][1]))) {
      corrections.push(`Dropped an implausible salary (${top} per ${period}).`);
    } else {
      // The model tends to read a bare "$" as USD. These are Canadian sites, so it needs saying outright.
      const currency = USD.test(text) ? "USD" : raw.salaryCurrency === "OTHER" && !/\$/.test(raw.salaryQuote) ? "OTHER" : "CAD";
      salary = { min, max, currency, period, quote: realQuote(raw.salaryQuote, text), source: "model" };
    }
  }
  if (!salary) {
    salary = salaryFromPattern(text);
    if (salary) corrections.push("Read the salary from the text directly; the model didn't return a usable one.");
  }

  // Location.
  const nText = normalize(text);
  let city = raw.city;
  if (city && !containsPhrase(text, city)) {
    corrections.push("Dropped a city that isn't in the posting.");
    city = null;
  }
  const region = raw.region && containsPhrase(text, raw.region) ? raw.region : raw.region && /^[A-Za-z]{2}$/.test(raw.region) && new RegExp(`\\b${raw.region}\\b`, "i").test(text) ? raw.region : null;

  // Work mode: the claimed mode must have wording behind it.
  let workMode = raw.workMode;
  const WORDING = { remote: REMOTE, hybrid: HYBRID, onsite: ONSITE } as const;
  // "4 days on-site, 1 WFH" never says hybrid, but having both kinds of wording means it.
  const mixed = workMode === "hybrid" && REMOTE.test(text) && ONSITE.test(text);
  if (workMode !== "unknown" && !mixed && !WORDING[workMode].test(text)) {
    corrections.push(`Changed work mode "${workMode}" to unknown: no wording supports it.`);
    workMode = "unknown";
  } else if (workMode !== "unknown" && quoteOk(raw.workModeQuote, text) && !WORDING[workMode].test(raw.workModeQuote)) {
    // The cited evidence says something else, so trust the evidence.
    const fromQuote = (["hybrid", "remote", "onsite"] as const).find((m) => WORDING[m].test(raw.workModeQuote));
    if (fromQuote) {
      corrections.push(`Changed work mode "${workMode}" to "${fromQuote}" to match the model's own quote.`);
      workMode = fromQuote;
    }
  }

  // Office days: the figure, or its remote complement ("3 days remote" means 2), must be written.
  let officeDaysPerWeek = raw.officeDaysPerWeek;
  if (officeDaysPerWeek !== null) {
    // Only numbers attached to the word "days" count. Any digit would let "3+ years" vouch for "2 office days".
    const written = new Set([...text.matchAll(DAY_COUNT)].flatMap((m) => [...smallNumbersIn(m[1]!)]));
    const valid = Number.isInteger(officeDaysPerWeek) && officeDaysPerWeek >= 0 && officeDaysPerWeek <= 5;
    // "In the office Tuesdays and Thursdays" states 2 without writing the number.
    const named = WEEKDAYS.filter((d) => nText.includes(d)).length;
    const seen = written.has(officeDaysPerWeek) || written.has(5 - officeDaysPerWeek) || named === officeDaysPerWeek;
    if (!valid || !seen || workMode === "remote" || workMode === "unknown") {
      if (workMode !== "remote") corrections.push("Dropped an office-days figure the posting doesn't support.");
      officeDaysPerWeek = null;
    }
  }

  if (workMode === "hybrid" || workMode === "onsite") {
    const stated = officeDaysFromText(text);
    if (stated !== null && stated !== officeDaysPerWeek) {
      corrections.push(`Office days changed from ${officeDaysPerWeek ?? "none"} to ${stated}, as the posting states.`);
      officeDaysPerWeek = stated;
    }
  }

  // Required years.
  const yearMentions = [...text.matchAll(YEARS)];
  const yearValue = (word: string) => [...smallNumbersIn(word)][0] ?? null;
  let requiredYears = raw.requiredYears !== null && raw.requiredYears >= 0 && raw.requiredYears <= 60 ? raw.requiredYears : null;
  let yearsQuote = realQuote(raw.yearsQuote, text);
  if (requiredYears !== null && !yearMentions.some((m) => yearValue(m[1]!) === requiredYears)) {
    corrections.push(`Dropped "${requiredYears} years": not stated in the posting.`);
    requiredYears = null;
    yearsQuote = "";
  }
  if (requiredYears === null) {
    const m = yearMentions.find((y) => EXPERIENCE.test(y[0]));
    if (m) {
      requiredYears = yearValue(m[1]!);
      yearsQuote = m[0].trim();
      corrections.push("Read required years from the text directly.");
    }
  }

  // French: a claim needs a word behind it, and a mention can't be silently missed.
  let french: Extraction["french"] = raw.french;
  let frenchQuote = realQuote(raw.frenchQuote, text);
  const mentionsFrench = FRENCH.test(text);
  if (french !== "not_mentioned" && !mentionsFrench) {
    corrections.push(`Changed French "${french}" to not mentioned: the posting never mentions it.`);
    french = "not_mentioned";
    frenchQuote = "";
  } else if (french === "not_mentioned" && mentionsFrench) {
    french = "mentioned";
    const line = text.split("\n").find((l) => FRENCH.test(l)) ?? "";
    frenchQuote = line.trim().slice(0, 160);
    corrections.push("The posting mentions French but the model saw no requirement; flagged for you to read.");
  }

  return {
    salary, city, region, workMode, officeDaysPerWeek,
    // A quote only counts as evidence if the mode it supported survived the checks.
    workModeQuote: workMode === "unknown" ? "" : realQuote(raw.workModeQuote, text),
    seniority: raw.seniority, requiredYears, yearsQuote, french, frenchQuote, corrections,
  };
}
