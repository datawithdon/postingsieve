/**
 * Per-site DOM knowledge. These selectors are the part most likely to break,
 * since the sites change markup without notice, so each lists fallbacks and
 * nothing outside this file touches site markup.
 */
import { MAX_POSTING_CHARS } from "../core/sanitize";
import { JOB_ID, siteForOrigin, type Site } from "../core/sites";

export interface Posting { key: string; title: string; text: string; anchor: Element | null }
export interface Card { key: string; mount: Element }
export interface Adapter {
  site: Site;
  /** Whether this URL could hold a posting or a results list. Elsewhere on the site, nothing is read. */
  active(url: URL): boolean;
  current(doc: Document, url: URL): Posting | null;
  cards(doc: Document): Card[];
}

/** Enough to hold a location and a salary: partner postings on Job Bank are this short. */
const MIN_TEXT = 60;
const first = (doc: Document | Element, selectors: string[]) => {
  for (const s of selectors) {
    const el = doc.querySelector(s);
    if (el) return el;
  }
  return null;
};
export const textOf = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? "").slice(0, MAX_POSTING_CHARS).trim();

const posting = (key: string, container: Element | null, titleEl: Element | null, extra = ""): Posting | null => {
  if (!container) return null;
  // Header text goes first, the way a person reads it, so the location isn't taken for an afterthought.
  const text = `${extra}\n${textOf(container)}`.trim();
  if (text.length < MIN_TEXT) return null;
  return { key, title: titleEl ? textOf(titleEl) : "", text, anchor: titleEl };
};

const jobBank: Adapter = {
  site: "jobbank",
  active: (url) => url.pathname.startsWith("/jobsearch/"),
  current(doc, url) {
    const id = url.pathname.match(/\/jobposting\/(\d+)/)?.[1];
    if (!id) return null;
    // The summary is in a visually hidden element, which innerText skips.
    const hidden = doc.querySelector('.job-posting-details-body [property="description"]')?.textContent?.trim() ?? "";
    return posting(`jobbank:${id}`, first(doc, [".job-posting-details-body", "main"]), first(doc, ["h1.title", "main h1"]), hidden);
  },
  cards(doc) {
    return [...doc.querySelectorAll('article[id^="article-"]')].flatMap((a) => {
      const id = a.id.replace("article-", "");
      const mount = first(a, ["h3.title", "a"]);
      return /^\d+$/.test(id) && mount ? [{ key: `jobbank:${id}`, mount }] : [];
    });
  },
};

/** LinkedIn hashes many class names, so fall back to its visible "About the job" heading. */
function linkedInContainer(doc: Document): Element | null {
  const known = first(doc, [".jobs-search__job-details--container", ".job-view-layout", ".jobs-details", ".jobs-details__main-content", "main .details-pane__content", ".decorated-job-posting__details"]);
  if (known) return known;
  const heading = [...doc.querySelectorAll("h1, h2, h3")].find((h) => /^(about the job|à propos de l.offre)/i.test(textOf(h)));
  let el = heading?.parentElement ?? null;
  while (el && el !== doc.body && textOf(el).length < MIN_TEXT) el = el.parentElement;
  return el && el !== doc.body ? el : null;
}

const linkedIn: Adapter = {
  site: "linkedin",
  active: (url) => url.pathname.startsWith("/jobs"),
  current(doc, url) {
    if (!url.pathname.startsWith("/jobs")) return null;
    const id = url.searchParams.get("currentJobId") ?? url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1];
    if (!id || !/^\d{1,20}$/.test(id)) return null;
    const container = linkedInContainer(doc);
    const title = (container && first(container, ["h1", ".job-details-jobs-unified-top-card__job-title"])) ?? first(doc, [".top-card-layout__title", "main h1", "h1"]);
    // On the signed-out page, the location and salary are in a top card outside the description.
    const topCard = doc.querySelector(".top-card-layout");
    return posting(`linkedin:${id}`, container, title, topCard && !container?.contains(topCard) ? textOf(topCard) : "");
  },
  cards(doc) {
    const out = new Map<string, Card>();
    for (const c of doc.querySelectorAll("[data-occludable-job-id], [data-job-id], [data-entity-urn*='jobPosting']")) {
      const id = c.getAttribute("data-occludable-job-id") ?? c.getAttribute("data-job-id") ?? c.getAttribute("data-entity-urn")?.match(/(\d+)$/)?.[1];
      if (!id || !/^\d+$/.test(id) || out.has(id)) continue;
      const mount = first(c, [".artdeco-entity-lockup__title", ".job-card-list__title--link", ".base-search-card__title", "a"]) ?? c;
      out.set(id, { key: `linkedin:${id}`, mount });
    }
    return [...out.values()];
  },
};

const indeed: Adapter = {
  site: "indeed",
  active: (url) => /^\/(jobs|viewjob|m\/jobs|m\/viewjob)\b/.test(url.pathname),
  current(doc, url) {
    const id = url.searchParams.get("vjk") ?? url.searchParams.get("jk");
    if (!id || !JOB_ID.test(id)) return null;
    const desc = doc.querySelector("#jobDescriptionText");
    if (!desc) return null;
    // The salary and location sit in a header outside the description.
    const container = first(doc, [".jobsearch-JobComponent", "#jobsearch-ViewjobPaneWrapper", ".jobsearch-ViewJobLayout-jobDisplay"]) ?? desc;
    const title = first(doc, ['[data-testid="jobsearch-JobInfoHeader-title"]', "h1.jobsearch-JobInfoHeader-title", ".jobsearch-JobInfoHeader-title", "h1, h2"]);
    return posting(`indeed:${id}`, container, title);
  },
  cards(doc) {
    const out = new Map<string, Card>();
    for (const a of doc.querySelectorAll("a[data-jk], [data-jk]")) {
      const id = a.getAttribute("data-jk");
      if (id && JOB_ID.test(id) && !out.has(id)) out.set(id, { key: `indeed:${id}`, mount: a.closest("h2") ?? a });
    }
    return [...out.values()];
  },
};

const ADAPTERS: Record<Site, Adapter> = { jobbank: jobBank, linkedin: linkedIn, indeed };

export const adapterFor = (origin: string): Adapter | null => {
  const site = siteForOrigin(origin);
  return site ? ADAPTERS[site] : null;
};
