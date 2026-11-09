import type { Status, TabState, Verdict } from "../core/types";

const view = document.getElementById("view")!;
const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const VERDICT: Record<Verdict, string> = { green: "Passes", amber: "Check", red: "Fails" };
const MARK: Record<Status, string> = { pass: "✓", warn: "!", fail: "✕" };
const NAME: Record<Status, string> = { pass: "Passes", warn: "Check", fail: "Fails" };
const CLS: Record<Status, string> = { pass: "green", warn: "amber", fail: "red" };

let currentTab: number | undefined;

function render(state: TabState | undefined) {
  view.replaceChildren();
  if (!state) {
    view.append(el("p", "neutral", "Open a job posting on LinkedIn, Indeed or Job Bank to see how it scores."));
    return;
  }
  if (state.title) view.append(el("p", "title", state.title));
  if (state.kind === "reading") {
    view.append(el("p", "verdict neutral", "Reading…"));
  } else if (state.kind === "message") {
    view.append(el("p", "", state.text));
    if (state.retry) {
      const retry = el("button", "", "Try again");
      retry.addEventListener("click", () => void chrome.runtime.sendMessage({ type: "retry", tabId: currentTab }));
      view.append(retry);
    }
  } else {
    view.append(el("p", `verdict ${state.score.verdict}`, VERDICT[state.score.verdict]));
    const ul = el("ul");
    for (const r of state.score.reasons) {
      const li = el("li");
      const mark = el("span", `mark ${CLS[r.status]}`, MARK[r.status]);
      mark.setAttribute("aria-label", NAME[r.status]);
      li.append(mark, el("span", "", r.text));
      if (r.quote) li.append(el("q", "", r.quote));
      ul.append(li);
    }
    view.append(ul);
    if (state.facts) view.append(el("div", "facts", `Read from the posting: ${state.facts}`));
  }
}

async function refresh() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab?.id;
  if (currentTab === undefined) { render(undefined); return; }
  const key = `tab:${currentTab}`;
  render((await chrome.storage.session.get(key))[key] as TabState | undefined);
}

chrome.tabs.onActivated.addListener(() => void refresh());
chrome.storage.session.onChanged.addListener(() => void refresh());
document.getElementById("settings")!.addEventListener("click", () => void chrome.runtime.openOptionsPage());
void refresh();
