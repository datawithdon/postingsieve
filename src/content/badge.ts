import type { Reason, Score, Verdict } from "../core/types";

const CSS = `
/* Fixed sizes: the page can measure this element, and a width that varied by verdict would reveal it. */
:host { all: initial; display: inline-block; width: 210px; height: 28px; overflow: visible; font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; vertical-align: middle; --bg:#fff; --fg:#1c1f23; --muted:#5b6470; --line:#d8dce1; }
@media (prefers-color-scheme: dark) { :host { --bg:#1f2329; --fg:#eef0f3; --muted:#a8b0ba; --line:#3a4048; } }
button { font: inherit; }
.pill { display: inline-flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; padding: 4px 11px; color: #fff; font-weight: 600; cursor: pointer; white-space: nowrap; }
.pill:focus-visible { outline: 2px solid #1a66d6; outline-offset: 2px; }
.green { background: #0b7a3e; } .amber { background: #a65500; } .red { background: #b3261e; } .neutral { background: #56606b; }
.mini { display: block; width: 52px; box-sizing: border-box; text-align: center; border-radius: 999px; padding: 0 7px; font-size: 11px; font-weight: 600; line-height: 18px; color: #fff; }
.panel { position: absolute; z-index: 2147483000; margin-top: 6px; width: 340px; max-width: calc(100vw - 32px); max-height: 60vh; overflow: auto; background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 28px rgba(0,0,0,.2); font-weight: 400; }
ul { list-style: none; margin: 0; padding: 0; }
li { display: grid; grid-template-columns: 18px 1fr; gap: 2px 6px; margin-bottom: 8px; }
.mark { font-weight: 700; } .pass { color: #0b7a3e; } .warn { color: #a65500; } .fail { color: #b3261e; }
@media (prefers-color-scheme: dark) { .pass { color: #58c98b; } .warn { color: #f0a94f; } .fail { color: #f28b82; } }
q { grid-column: 2; color: var(--muted); font-size: 12px; }
.facts { border-top: 1px solid var(--line); padding-top: 8px; color: var(--muted); font-size: 12px; }
.note { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
.link { background: none; border: 0; padding: 0; color: inherit; text-decoration: underline; cursor: pointer; font-size: 12px; }
`;

const sheet = (css: string) => { const s = new CSSStyleSheet(); s.replaceSync(css); return s; };
// Constructed sheets aren't blocked by the host page's style-src CSP, unlike a <style> tag.
let sheets: { base: CSSStyleSheet; card: CSSStyleSheet } | null = null;
function attachStyles(root: ShadowRoot, kind: "detail" | "card") {
  sheets ??= { base: sheet(CSS), card: sheet(":host { width: 52px; height: 18px; margin-left: 6px; }") };
  root.adoptedStyleSheets = kind === "card" ? [sheets.base, sheets.card] : [sheets.base];
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text = ""): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text) el.textContent = text;
  return el;
};

export const LABEL: Record<Verdict, string> = { green: "Passes", amber: "Check", red: "Fails" };
const MARK: Record<Reason["status"], string> = { pass: "✓", warn: "!", fail: "✕" };
const STATUS_NAME: Record<Reason["status"], string> = { pass: "Passes", warn: "Check", fail: "Fails" };

// Only used if on-page badges are turned on. Nothing about a badge is written where the page can
// read it: no attributes or classes, a closed shadow root, and state kept in this isolated world.
function makeHost(kind: "detail" | "card"): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement("span");
  const root = host.attachShadow({ mode: "closed" });
  attachStyles(root, kind);
  return { host, root };
}

export type BadgeState =
  | { kind: "busy"; text: string }
  | { kind: "message"; text: string; action?: { label: string; run(): void } }
  | { kind: "score"; score: Score; facts: string };

/** The large badge for the open posting. */
export class DetailBadge {
  private host: HTMLElement;
  private root: ShadowRoot;
  private open = false;
  private state: BadgeState | null = null;

  constructor() {
    ({ host: this.host, root: this.root } = makeHost("detail"));
  }

  place(anchor: Element | null) {
    if (anchor) {
      this.host.style.removeProperty("position");
      if (anchor.nextElementSibling !== this.host) anchor.insertAdjacentElement("afterend", this.host);
    } else if (this.host.parentElement !== document.body) {
      // Unknown markup: still show the result, just not beside the title.
      this.host.style.cssText = "position:fixed;top:72px;right:16px;z-index:2147483000";
      document.body.append(this.host);
    }
  }

  remove() { this.host.remove(); this.state = null; this.open = false; }
  get visible() { return this.host.isConnected; }

  show(state: BadgeState) {
    this.state = state;
    this.render();
  }

  private render() {
    const s = this.state;
    if (!s) return;
    const pill = h("button", "pill");
    pill.type = "button";
    const body: Node[] = [];
    if (s.kind === "score") {
      pill.classList.add(s.score.verdict);
      pill.textContent = `PostingSieve: ${LABEL[s.score.verdict]}`;
      const ul = h("ul");
      for (const r of s.score.reasons) {
        const li = h("li");
        const mark = h("span", `mark ${r.status}`, MARK[r.status]);
        mark.setAttribute("aria-label", STATUS_NAME[r.status]);
        li.append(mark, h("span", "", r.text));
        if (r.quote) li.append(h("q", "", r.quote));
        ul.append(li);
      }
      body.push(ul);
      if (s.facts) body.push(h("div", "facts", `Read from the posting: ${s.facts}`));
      body.push(h("p", "note", "Read by a small on-device model, so it can be wrong. Skim anything that matters."));
    } else {
      pill.classList.add("neutral");
      pill.textContent = s.kind === "busy" ? `PostingSieve: ${s.text}` : "PostingSieve: setup needed";
      if (s.kind === "message") {
        body.push(h("div", "", s.text));
        if (s.action) {
          const a = h("button", "link", s.action.label);
          a.type = "button";
          const run = s.action.run;
          a.addEventListener("click", () => run());
          body.push(a);
        }
      }
    }
    const interactive = body.length > 0;
    pill.disabled = !interactive;
    pill.setAttribute("aria-expanded", String(this.open && interactive));
    pill.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.open = !this.open;
      this.render();
    });
    const nodes: Node[] = [pill];
    if (this.open && interactive) {
      const panel = h("div", "panel");
      panel.append(...body);
      nodes.push(panel);
    }
    this.root.replaceChildren(...nodes);
  }
}

const cardBadges = new WeakMap<Element, { host: HTMLElement; verdict: Verdict }>();

/** The small badge on a list card, for postings already scored. */
export function setCardBadge(mount: Element, verdict: Verdict) {
  const existing = cardBadges.get(mount);
  if (existing?.verdict === verdict && existing.host.parentElement === mount) return;
  existing?.host.remove();
  const { host, root } = makeHost("card");
  root.append(h("span", `mini ${verdict}`, LABEL[verdict]));
  mount.append(host);
  cardBadges.set(mount, { host, verdict });
}

export function clearCardBadge(mount: Element) {
  cardBadges.get(mount)?.host.remove();
  cardBadges.delete(mount);
}
