import { EMPTY_CRITERIA, sanitizeCriteria } from "../core/criteria";
import { MODEL_OPTIONS } from "../core/schema";
import { hasAnyCriteria, score } from "../core/score";
import type { Criteria, ExtractResponse, Status } from "../core/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => {
  const v = $<HTMLInputElement>(id).value.trim();
  return v === "" ? null : Number(v);
};
const setNum = (id: string, v: number | null) => { $<HTMLInputElement>(id).value = v === null ? "" : String(v); };
const el = (tag: string, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

let criteria: Criteria = EMPTY_CRITERIA;

async function refreshModel() {
  const status = $("model-status");
  const download = $<HTMLButtonElement>("download");
  download.hidden = true;
  if (typeof LanguageModel === "undefined") {
    status.textContent = "This version of Chrome doesn't offer the Prompt API. Update Chrome to 138 or later.";
    return;
  }
  const a = await LanguageModel.availability(MODEL_OPTIONS);
  if (a === "available") status.textContent = "Ready. Scoring runs entirely on this computer.";
  else if (a === "unavailable") status.textContent = "Chrome says the model can't run here. It needs macOS 13+, Windows 10/11, Linux or a Chromebook Plus, 22 GB free disk, and either a GPU with over 4 GB VRAM or 16 GB RAM with 4+ CPU cores.";
  else {
    status.textContent = a === "downloading"
      ? "Downloading. Press the button to watch progress."
      : "Chrome needs to download the model once, on an unmetered connection. After that it works offline, and this is the only network use.";
    download.hidden = false;
  }
}

async function downloadModel() {
  const status = $("model-status");
  const download = $<HTMLButtonElement>("download");
  const progress = $<HTMLProgressElement>("progress");
  download.disabled = true;
  progress.hidden = false;
  status.textContent = "Downloading…";
  try {
    const session = await LanguageModel.create({
      ...MODEL_OPTIONS,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const loaded = (e as ProgressEvent).loaded;
          progress.value = loaded;
          status.textContent = `Downloading… ${Math.round(loaded * 100)}%`;
        });
      },
    });
    session.destroy();
  } catch (e) {
    status.textContent = `Download failed: ${(e as Error).message}`;
    download.disabled = false;
    progress.hidden = true;
    return;
  }
  progress.hidden = true;
  download.disabled = false;
  await refreshModel();
}

function fillForm(c: Criteria) {
  setNum("salaryFloor", c.salaryFloor);
  setNum("maxOfficeDays", c.maxOfficeDays);
  setNum("maxRequiredYears", c.maxRequiredYears);
  $<HTMLTextAreaElement>("commuteCities").value = c.commuteCities.join("\n");
  $<HTMLInputElement>("rejectFrenchRequired").checked = c.rejectFrenchRequired;
}

async function save(ev: Event) {
  ev.preventDefault();
  criteria = sanitizeCriteria({
    salaryFloor: num("salaryFloor"),
    maxOfficeDays: num("maxOfficeDays"),
    maxRequiredYears: num("maxRequiredYears"),
    commuteCities: $<HTMLTextAreaElement>("commuteCities").value.split("\n"),
    rejectFrenchRequired: $<HTMLInputElement>("rejectFrenchRequired").checked,
  });
  // storage.local rather than .sync: sync would upload your criteria to your Google account.
  await chrome.storage.local.set({ criteria, showOnPage: $<HTMLInputElement>("showOnPage").checked });
  fillForm(criteria);
  $("saved").textContent = "Saved. Open postings update right away.";
}

const MARK: Record<Status, string> = { pass: "✓", warn: "!", fail: "✕" };
const CLS: Record<Status, string> = { pass: "green", warn: "amber", fail: "red" };

async function runSample() {
  const result = $("result");
  const button = $<HTMLButtonElement>("run");
  const text = $<HTMLTextAreaElement>("sample").value.trim();
  if (!text) { result.textContent = "Paste a posting first."; return; }
  button.disabled = true;
  result.textContent = "Reading…";
  const started = performance.now();
  let r: ExtractResponse;
  try {
    r = (await chrome.runtime.sendMessage({ type: "extract", text, fresh: true })) as ExtractResponse;
  } catch {
    r = { ok: false, code: "model-error", message: "Couldn't reach the extension. Reload this page." };
  }
  button.disabled = false;
  result.replaceChildren();
  if (!r.ok) { result.textContent = r.message; return; }
  if (hasAnyCriteria(criteria)) {
    const s = score(criteria, r.extraction);
    result.append(el("div", `verdict ${s.verdict}`, { green: "Passes", amber: "Check", red: "Fails" }[s.verdict]));
    const ul = el("ul");
    for (const reason of s.reasons) {
      const li = el("li");
      li.append(el("span", CLS[reason.status], `${MARK[reason.status]} `), document.createTextNode(reason.text));
      if (reason.quote) li.append(el("span", "quote", `"${reason.quote}"`));
      ul.append(li);
    }
    result.append(ul);
  } else {
    result.append(el("p", "hint", "Save at least one must-have above to see a score."));
  }
  result.append(el("p", "hint", `Took ${((performance.now() - started) / 1000).toFixed(1)}s.`));
  const details = (label: string, value: unknown, open = false) => {
    const d = el("details") as HTMLDetailsElement;
    d.open = open;
    d.append(el("summary", "", label), el("pre", "", JSON.stringify(value, null, 2)));
    return d;
  };
  result.append(details("After checks (what scoring uses)", r.extraction, true));
  if (r.raw) result.append(details("Raw model output", r.raw));
}

async function clearSaved() {
  await chrome.storage.session.clear();
  $("cleared").textContent = "Cleared.";
}

async function init() {
  const stored = await chrome.storage.local.get(["criteria", "showOnPage"]);
  criteria = sanitizeCriteria(stored.criteria);
  fillForm(criteria);
  $<HTMLInputElement>("showOnPage").checked = stored.showOnPage === true;
  $("criteria").addEventListener("submit", save);
  $("download").addEventListener("click", downloadModel);
  $("run").addEventListener("click", runSample);
  $("clear").addEventListener("click", clearSaved);
  for (const id of ["salaryFloor", "maxOfficeDays", "maxRequiredYears", "commuteCities", "rejectFrenchRequired", "showOnPage"]) {
    $(id).addEventListener("input", () => { $("saved").textContent = ""; });
  }
  await refreshModel();
}

void init();
