export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Whether one place name contains another as whole words, so "to" never matches "Toronto". */
export function containsPhrase(haystack: string, needle: string): boolean {
  const words = (s: string) => normalize(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const n = words(needle);
  return /\p{L}{3}/u.test(n) && ` ${words(haystack)} `.includes(` ${n} `);
}

/** Fast non-cryptographic hash (cyrb53), for spotting that a page's text changed. Not for cache keys or security. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const RELEVANT = /\$|salary|salaire|compensation|pay range|per hour|\/hr|hourly|annual|hybrid|hybride|remote|télétravail|teletravail|work from home|on-?site|in[- ]office|in person|days? (a|per|each) week|french|français|francais|bilingu|years?|yrs?\b|\bans\b|location|located|lieu/i;

/**
 * Fit a posting into the model's context window. Salary and language lines are
 * often at the very bottom, so a plain head-cut would lose exactly what we need:
 * lines that look relevant are kept first, then the rest fills in document order.
 */
export function prepareText(text: string, limit = 6000): string {
  const clean = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  if (clean.length <= limit) return clean;
  const lines = clean.split("\n").map((l) => l.trim().slice(0, 600));
  const keep = new Set<number>();
  let used = 0;
  const take = (i: number) => {
    const line = lines[i]!;
    if (keep.has(i) || used + line.length + 1 > limit) return;
    keep.add(i);
    used += line.length + 1;
  };
  // The title and location block is at the top.
  for (let i = 0; i < Math.min(6, lines.length); i++) take(i);
  lines.forEach((l, i) => { if (RELEVANT.test(l)) take(i); });
  lines.forEach((_, i) => take(i));
  return lines.filter((_, i) => keep.has(i)).join("\n");
}

/** Every number written in the text, including "85k" and "85,000" and "85 000". */
export function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  // Shorthand range where the k applies to both ends: "65-75k".
  for (const m of text.matchAll(/\b(\d{1,3})\s?[-–]\s?(\d{1,3})\s?[kK]\b/g)) {
    out.add(Number(m[1]) * 1000);
    out.add(Number(m[2]) * 1000);
  }
  for (const m of text.matchAll(/\d{1,3}(?:[,\s ]\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?(?:\s?[kK]\b)?/g)) {
    const raw = m[0];
    const isK = /[kK]$/.test(raw);
    const digits = raw.replace(/[kK]$/, "").trim();
    // A comma followed by exactly 1-2 digits is a French decimal: "22,50".
    const n = /^\d+,\d{1,2}$/.test(digits) ? Number(digits.replace(",", ".")) : Number(digits.replace(/[,\s ]/g, ""));
    if (Number.isFinite(n)) out.add(isK ? n * 1000 : n);
  }
  return out;
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5 };

/** Same as numbersIn, plus small numbers spelled out ("three days"). */
export function smallNumbersIn(text: string): Set<number> {
  const out = numbersIn(text);
  for (const m of normalize(text).matchAll(/\b[a-z]+\b/g)) {
    const n = WORDS[m[0]];
    if (n !== undefined) out.add(n);
  }
  return out;
}
