import { sanitizeCriteria } from "../core/criteria";
import { cleanPostingText, MAX_POSTING_CHARS, sanitizeExtraction } from "../core/sanitize";
import { EXTRACTION_PATTERN, MODEL_OPTIONS, SYSTEM_PROMPT, parseRaw } from "../core/schema";
import { factsLine, hasAnyCriteria, score } from "../core/score";
import { JOB_ID, classifySender, type Caller, type Site } from "../core/sites";
import { prepareText } from "../core/text";
import type { ExtractResponse, Extraction, Failure, RawExtraction, ScoreResponse, TabState, Verdict, VerdictsResponse } from "../core/types";
import { verifyExtraction } from "../core/verify";

const CACHE_VERSION = 3; // Bump when the prompt, pattern or checks change.
const CACHE_LIMIT = 300;
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Typically about 4s. A much longer run means the model is stuck, so give up and offer a retry.
const PROMPT_TIMEOUT_MS = 45_000;
const MAX_QUEUED_PROMPTS = 8;
const MAX_PROMPTS_PER_TAB_PER_MINUTE = 30;
const MAX_VERDICT_IDS = 200;

interface CacheEntry { extraction: Extraction; at: number }
type JobsIndex = Record<string, { key: string; at: number }>;

// Content scripts share a process with the page, so they get no direct access to storage: a
// compromised tab on one site must not be able to read your criteria or your history on another.
const lockStorage = () => {
  void chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
};
lockStorage();
const openPanelOnClick = () => void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
openPanelOnClick();
chrome.runtime.onStartup.addListener(() => { lockStorage(); openPanelOnClick(); });

// Job history stays in memory-only session storage, so it never reaches disk. Only your settings
// live in storage.local. This also removes job data an earlier version saved there.
const SETTINGS_KEYS = new Set(["criteria", "showOnPage"]);
async function removeLegacyDiskCache() {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter((k) => !SETTINGS_KEYS.has(k));
  if (stale.length) await chrome.storage.local.remove(stale);
}

chrome.runtime.onInstalled.addListener((d) => {
  lockStorage();
  openPanelOnClick();
  void removeLegacyDiskCache();
  if (d.reason === "install") void chrome.runtime.openOptionsPage();
});

/* ---------- model ---------- */

let base: Promise<LanguageModelSession> | null = null;
const getBase = () =>
  // Low randomness: the same posting should read the same way each time.
  (base ??= LanguageModel.create({ ...MODEL_OPTIONS, temperature: 0, topK: 1, initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }] }).catch((e) => {
    base = null;
    throw e;
  }));

function resetBase() {
  const old = base;
  base = null;
  void old?.then((s) => s.destroy(), () => undefined);
}

/** Rejects after the timeout even if the API ignores its abort signal, so a stuck call can't block the queue. */
function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException("Timed out", "TimeoutError"));
    }, PROMPT_TIMEOUT_MS);
  });
  return Promise.race([work(controller.signal), timeout]).finally(() => clearTimeout(timer));
}

async function runModel(text: string, limit = 6000): Promise<string> {
  try {
    return await withTimeout(async (signal) => {
      const session = await (await getBase()).clone({ signal });
      try {
        return await session.prompt(`Job posting:\n"""\n${prepareText(text, limit)}\n"""`, { responseConstraint: EXTRACTION_PATTERN, signal });
      } finally {
        session.destroy();
      }
    });
  } catch (e) {
    // Too big for the model's context window: retry once with a much shorter cut.
    if ((e as Error).name === "QuotaExceededError" && limit > 2000) return runModel(text, 2000);
    throw e;
  }
}

// One prompt at a time: the model is a single shared resource. The cap stops a page from building an unbounded backlog.
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  queued++;
  const run = queue.then(job, job).finally(() => { queued--; });
  queue = run.catch(() => undefined);
  return run;
}

// A page can rewrite its text forever to keep the model busy, so uncached reads are limited per tab.
const recentPrompts = new Map<number, number[]>();
function allowPrompt(tabId: number): boolean {
  const now = Date.now();
  const recent = (recentPrompts.get(tabId) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= MAX_PROMPTS_PER_TAB_PER_MINUTE) { recentPrompts.set(tabId, recent); return false; }
  recent.push(now);
  recentPrompts.set(tabId, recent);
  return true;
}
chrome.tabs.onRemoved.addListener((id) => recentPrompts.delete(id));

/* ---------- cache ---------- */

// Writes are read-modify-write, so they run one at a time or concurrent requests would lose entries.
let cacheWrites: Promise<unknown> = Promise.resolve();
function withCache<T>(job: () => Promise<T>): Promise<T> {
  const run = cacheWrites.then(job, job);
  cacheWrites = run.catch(() => undefined);
  return run;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const cache = chrome.storage.session;
const readJobs = async () => ((await cache.get("jobs")).jobs ?? {}) as JobsIndex;

async function pruneCache() {
  const all = await cache.get(null);
  const cutoff = Date.now() - CACHE_MAX_AGE_MS;
  const entries = Object.entries(all).filter(([k]) => k.startsWith("x:")) as [string, CacheEntry][];
  entries.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
  const expired = entries.filter(([k, e], i) => i >= CACHE_LIMIT || !(e?.at > cutoff) || !k.startsWith(`x:${CACHE_VERSION}:`)).map(([k]) => k);
  if (expired.length) await cache.remove(expired);
  const gone = new Set(expired);
  const jobs = (all.jobs ?? {}) as JobsIndex;
  const kept = Object.entries(jobs).filter(([, j]) => j?.at > cutoff && !gone.has(j.key)).sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_LIMIT);
  await cache.set({ jobs: Object.fromEntries(kept) });
}

const remember = (key: string, jobKey: string | undefined, extraction: Extraction) =>
  withCache(async () => {
    const at = Date.now();
    const jobs = await readJobs();
    if (jobKey) jobs[jobKey] = { key, at };
    await cache.set({ [key]: { extraction, at } satisfies CacheEntry, jobs });
    await pruneCache();
  });

const readEntry = async (key: string) => {
  const hit = (await cache.get(key))[key] as CacheEntry | undefined;
  return hit ? sanitizeExtraction(hit.extraction) : null;
};

/* ---------- extraction ---------- */

const FAILED_MESSAGES: Record<string, string> = { TimeoutError: "The model took too long on this posting." };

async function extract(input: string, opts: { jobKey?: string; fresh?: boolean; tabId?: number }): Promise<ExtractResponse> {
  if (typeof LanguageModel === "undefined") return { ok: false, code: "unavailable", message: "This version of Chrome doesn't offer the Prompt API." };
  const text = cleanPostingText(input);
  const key = `x:${CACHE_VERSION}:${await sha256(text)}`;
  if (!opts.fresh) {
    const extraction = await readEntry(key);
    if (extraction) {
      if (opts.jobKey) await remember(key, opts.jobKey, extraction);
      return { ok: true, extraction, cached: true };
    }
  }
  const availability = await LanguageModel.availability(MODEL_OPTIONS);
  if (availability === "unavailable") return { ok: false, code: "unavailable", message: "Chrome says the on-device model can't run on this device." };
  if (availability !== "available") return { ok: false, code: "needs-setup", message: availability === "downloading" ? "The on-device model is still downloading." : "The on-device model needs downloading first." };
  const limited: Failure = { ok: false, code: "rate-limited", message: "Too many postings at once. Wait a minute and try again." };
  if (queued >= MAX_QUEUED_PROMPTS) return limited;
  if (opts.tabId !== undefined && !allowPrompt(opts.tabId)) return limited;
  try {
    const raw: RawExtraction = parseRaw(await enqueue(() => runModel(text)));
    const extraction = verifyExtraction(raw, text);
    await remember(key, opts.jobKey, extraction);
    return { ok: true, extraction, raw, cached: false };
  } catch (e) {
    resetBase(); // A dead session shouldn't poison the next attempt.
    return { ok: false, code: "model-error", message: FAILED_MESSAGES[(e as Error).name] ?? "The model couldn't read this posting." };
  }
}

/* ---------- messages ---------- */

const readCriteria = async () => sanitizeCriteria((await chrome.storage.local.get("criteria")).criteria);
const invalid: Failure = { ok: false, code: "invalid", message: "That request wasn't valid." };
const validText = (t: unknown): t is string => typeof t === "string" && t.length > 0 && t.length <= MAX_POSTING_CHARS * 2;

const readShowOnPage = async () => (await chrome.storage.local.get("showOnPage")).showOnPage === true;

/* Results show on the toolbar icon and in the side panel, which pages can't see. */
const ICON: Record<Verdict, { text: string; color: string }> = {
  green: { text: "OK", color: "#0b7a3e" },
  amber: { text: "?", color: "#a65500" },
  red: { text: "NO", color: "#b3261e" },
};

async function setTabState(tabId: number, state: TabState | null) {
  const key = `tab:${tabId}`;
  if (state) await cache.set({ [key]: state });
  else await cache.remove(key);
  const icon = state?.kind === "score" ? ICON[state.score.verdict] : state?.kind === "reading" ? { text: "…", color: "#56606b" } : state ? { text: "!", color: "#56606b" } : { text: "", color: "#56606b" };
  // A tab can close mid-read, which makes these fail harmlessly.
  await chrome.action.setBadgeText({ tabId, text: icon.text }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ tabId, color: icon.color }).catch(() => undefined);
}

async function scorePosting(site: Site, tabId: number, msg: { text?: unknown; id?: unknown; title?: unknown }): Promise<ScoreResponse> {
  const showOnPage = await readShowOnPage();
  if (!validText(msg.text) || typeof msg.id !== "string" || !JOB_ID.test(msg.id)) return { ...invalid, showOnPage };
  const title = typeof msg.title === "string" ? cleanPostingText(msg.title).slice(0, 200) : "";
  const criteria = await readCriteria();
  // No must-haves means nothing to score, so don't run the model or record the job.
  if (!hasAnyCriteria(criteria)) {
    const message = "Add your must-haves to start scoring.";
    await setTabState(tabId, { kind: "message", title, text: message, retry: false });
    return { ok: false, code: "no-criteria", message, showOnPage };
  }
  await setTabState(tabId, { kind: "reading", title });
  // The site comes from the browser-verified sender, so a tab can't write to another site's records.
  const r = await extract(msg.text, { jobKey: `${site}:${msg.id}`, tabId });
  if (!r.ok) {
    await setTabState(tabId, { kind: "message", title, text: r.message, retry: r.code !== "needs-setup" && r.code !== "unavailable" });
    return { ...r, showOnPage };
  }
  const result = score(criteria, r.extraction);
  const facts = factsLine(r.extraction);
  await setTabState(tabId, { kind: "score", title, score: result, facts });
  return { ok: true, score: result, facts, showOnPage };
}

async function verdictsFor(site: Site, ids: unknown): Promise<VerdictsResponse> {
  if (!Array.isArray(ids) || !(await readShowOnPage())) return [];
  const criteria = await readCriteria();
  if (!hasAnyCriteria(criteria)) return [];
  const jobs = await readJobs();
  const out: VerdictsResponse = [];
  for (const id of ids.slice(0, MAX_VERDICT_IDS)) {
    if (typeof id !== "string" || !JOB_ID.test(id)) continue;
    const jobKey = `${site}:${id}`;
    const job = Object.hasOwn(jobs, jobKey) ? jobs[jobKey] : undefined;
    const extraction = job ? await readEntry(job.key) : null;
    if (extraction) out.push([id, score(criteria, extraction).verdict]);
  }
  return out;
}

let lastSettingsOpen = 0;

function handle(caller: Caller, msg: Record<string, unknown>): Promise<unknown> | null {
  if (caller.kind === "settings") {
    if (msg.type === "retry" && Number.isInteger(msg.tabId)) {
      chrome.tabs.sendMessage(msg.tabId as number, { type: "rescore" }).catch(() => undefined);
      return Promise.resolve(null);
    }
    if (msg.type !== "extract" || !validText(msg.text)) return null;
    return extract(msg.text, { fresh: msg.fresh === true });
  }
  if (msg.type === "no-posting") return setTabState(caller.tabId, null);
  if (msg.type === "score-posting") return scorePosting(caller.site, caller.tabId, msg);
  if (msg.type === "card-verdicts") return verdictsFor(caller.site, msg.ids);
  if (msg.type === "open-settings") {
    // A page can't click inside the closed badge, but a compromised tab could send this in a loop.
    const now = Date.now();
    if (now - lastSettingsOpen > 3000) {
      lastSettingsOpen = now;
      void chrome.runtime.openOptionsPage();
    }
    return Promise.resolve(null);
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const caller = classifySender(sender, chrome.runtime.id);
  if (!caller || typeof msg !== "object" || msg === null) return false;
  const work = handle(caller, msg as Record<string, unknown>);
  if (!work) return false;
  void work.then(reply, () => reply(invalid));
  return true; // Keep the channel open for the async reply.
});

const askTabToRescore = (tabId: number) => chrome.tabs.sendMessage(tabId, { type: "rescore" }).catch(() => undefined);

// Tabs can't watch storage, so tell them to re-ask. The message carries no data.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || (!changes.criteria && !changes.showOnPage)) return;
  void chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id !== undefined) void askTabToRescore(tab.id);
    }
  });
});

// A navigation ends what was on screen. Same-document updates also land here, so re-ask once it settles.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading") void setTabState(tabId, null);
  if (info.status === "complete") void askTabToRescore(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => void cache.remove(`tab:${tabId}`));
