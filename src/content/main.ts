import { cleanPostingText } from "../core/sanitize";
import { hash } from "../core/text";
import type { ScoreResponse, VerdictsResponse } from "../core/types";
import { adapterFor, type Card, type Posting } from "./adapters";
import { DetailBadge, clearCardBadge, setCardBadge, type BadgeState } from "./badge";

const adapter = adapterFor(location.origin);
if (adapter) start();

const jobId = (key: string) => key.slice(key.indexOf(":") + 1);

/** sendMessage throws outright once the extension is reloaded, so turn that into a rejection. */
async function send<T>(msg: object): Promise<T> {
  return (await chrome.runtime.sendMessage(msg)) as T;
}

/**
 * By default this script only reads the page. It adds nothing to the DOM, so a site can't detect
 * it there. Results go to the toolbar icon and side panel, via the service worker.
 */
function start() {
  const site = adapter!;
  const badge = new DetailBadge();
  // Off until the service worker says the setting is on, so nothing is ever injected by accident.
  let showOnPage = false;

  let activeKey: string | null = null;
  let activeHash: string | null = null;
  let requested: string | null = null; // key|hash we've asked about
  let activeAnchor: Element | null = null;
  let toldNoPosting = false;

  // Single-page sites change the URL before the pane: hold off until the text is new and steady.
  let previousHash: string | null = null;
  let candidate = "";
  let waitedTicks = 0;

  const openSettings = () => void send({ type: "open-settings" }).catch(() => undefined);

  const showBadge = (state: BadgeState) => {
    if (!showOnPage) { badge.remove(); return; }
    badge.place(activeAnchor);
    badge.show(state);
  };

  const askedIds = new Set<string>();
  const seenCards = new Map<string, Card>();
  const applyVerdicts = (pairs: VerdictsResponse) => {
    for (const [id, verdict] of pairs) {
      const card = seenCards.get(id);
      if (showOnPage && card?.mount.isConnected) setCardBadge(card.mount, verdict);
    }
  };
  const paint = () => {
    if (!showOnPage) return;
    const fresh: string[] = [];
    for (const card of site.cards(document)) {
      const id = jobId(card.key);
      seenCards.set(id, card);
      if (!askedIds.has(id)) { askedIds.add(id); fresh.push(id); }
    }
    if (fresh.length) send<VerdictsResponse>({ type: "card-verdicts", ids: fresh }).then(applyVerdicts, () => undefined);
  };

  const request = (p: Posting, textHash: string) => {
    const token = `${p.key}|${textHash}`;
    if (requested === token) return;
    requested = token;
    toldNoPosting = false;
    showBadge({ kind: "busy", text: "reading…" });
    send<ScoreResponse>({ type: "score-posting", id: jobId(p.key), text: p.text, title: cleanPostingText(p.title).slice(0, 200) }).then(
      (r) => {
        if (requested !== token) return; // The user has moved on.
        showOnPage = r.showOnPage;
        if (r.ok) {
          showBadge({ kind: "score", score: r.score, facts: r.facts });
          askedIds.delete(jobId(p.key));
          paint();
          return;
        }
        showBadge({
          kind: "message",
          text: r.message,
          action: r.code === "needs-setup" || r.code === "no-criteria"
            ? { label: "Open settings", run: openSettings }
            : { label: "Try again", run: () => { requested = null; tick(); } },
        });
      },
      () => {
        // The extension was reloaded or updated underneath this tab.
        if (requested === token) showBadge({ kind: "message", text: "PostingSieve was updated. Reload this page." });
      },
    );
  };

  const noPosting = () => {
    if (activeKey) { badge.remove(); activeKey = activeHash = requested = null; }
    if (!toldNoPosting) {
      toldNoPosting = true;
      send({ type: "no-posting" }).catch(() => undefined);
    }
  };

  const tick = () => {
    const url = new URL(location.href);
    // Elsewhere on the site, such as the LinkedIn feed or messages, read nothing at all.
    if (!site.active(url)) { noPosting(); return; }
    paint();
    const p = site.current(document, url);
    if (!p) { noPosting(); return; }
    activeAnchor = p.anchor;
    const textHash = hash(p.text);
    if (p.key !== activeKey) {
      previousHash = activeHash;
      activeKey = p.key;
      activeHash = null;
      requested = null;
      candidate = "";
      waitedTicks = 0;
      showBadge({ kind: "busy", text: "waiting…" });
    }
    if (showOnPage && badge.visible) badge.place(p.anchor);
    if (textHash === activeHash) {
      if (requested === null) request(p, textHash);
      return;
    }

    const stale = textHash === previousHash && waitedTicks < 6;
    const settled = textHash === candidate;
    candidate = textHash;
    waitedTicks++;
    if (stale || !settled) { schedule(600); return; }
    activeHash = textHash;
    request(p, textHash);
  };

  // Debounced, with a ceiling: a page that mutates constantly can't starve scoring forever.
  const MAX_WAIT_MS = 2000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingSince = 0;
  function schedule(ms: number) {
    const now = Date.now();
    if (timer === undefined) pendingSince = now;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; tick(); }, Math.min(ms, Math.max(0, pendingSince + MAX_WAIT_MS - now)));
  }

  // From our service worker only: settings changed, so ask again. Scoring happens there and reads are cached.
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || sender.tab || msg?.type !== "rescore") return;
    requested = null;
    toldNoPosting = false;
    askedIds.clear();
    for (const card of seenCards.values()) clearCardBadge(card.mount);
    tick();
  });

  new MutationObserver(() => schedule(500)).observe(document.documentElement, { childList: true, subtree: true });
  schedule(0);
}
