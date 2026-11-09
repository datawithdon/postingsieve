// Runs the labelled postings through the real on-device model and reports accuracy,
// before and after the checks in src/core/verify.ts. Usage: node scripts/eval.mjs <chrome-profile> [runs] [fixtures.json]
import fs from "node:fs";
import { launch, loadExtension } from "./harness.mjs";

const postings = JSON.parse(fs.readFileSync(process.argv[4] ?? "tests/fixtures/postings.json", "utf8"));
const c = await launch(process.argv[2] ?? ".chrome-profile");
const { id } = await loadExtension(c);
const { session } = await c.open(`chrome-extension://${id}/src/options/index.html`);
await new Promise((r) => setTimeout(r, 800));

const FIELDS = ["salaryMin", "salaryMax", "period", "currency", "city", "workMode", "officeDays", "years", "french"];
const flatRaw = (r) => ({ salaryMin: r.salaryMin, salaryMax: r.salaryMax, period: r.salaryPeriod === "unknown" ? null : r.salaryPeriod, currency: r.salaryMin === null && r.salaryMax === null ? null : r.salaryCurrency, city: r.city, workMode: r.workMode, officeDays: r.officeDaysPerWeek, years: r.requiredYears, french: r.french });
const flat = (e) => ({ salaryMin: e.salary?.min ?? null, salaryMax: e.salary?.max ?? null, period: e.salary?.period ?? null, currency: e.salary?.currency ?? null, city: e.city, workMode: e.workMode, officeDays: e.officeDaysPerWeek, years: e.requiredYears, french: e.french });
// On-site with no figure and on-site with 5 days score identically, so don't count that as a miss.
const same = (f, a, b, workMode) => f === "officeDays" && workMode === "onsite" && (a === 5 || a === null) && (b === 5 || b === null) ? true : (typeof a === "string" && typeof b === "string" ? a.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() === b.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase() : a === b);

let rawOk = 0, checkedOk = 0, total = 0;
const times = [];
const RUNS = Number(process.argv[3] ?? 1);
for (const p of postings) p.expect.currency = p.expect.salaryMin === null ? null : /USD/.test(p.text) ? "USD" : "CAD";
let errors = 0;
for (let run = 0; run < RUNS; run++) for (const p of postings) {
  const started = Date.now();
  const r = await c.evaluate(session, `chrome.runtime.sendMessage({type:"extract",text:${JSON.stringify(p.text)},fresh:true})`);
  const secs = (Date.now() - started) / 1000;
  times.push(secs);
  if (!r.ok) { errors++; console.log(`${p.name}: ERROR ${r.code}: ${r.message}`); total += FIELDS.length; continue; }
  const raw = flatRaw(r.raw), checked = flat(r.extraction);
  const misses = [];
  for (const f of FIELDS) {
    total++;
    const rOk = same(f, raw[f], p.expect[f], p.expect.workMode), cOk = same(f, checked[f], p.expect[f], p.expect.workMode);
    if (rOk) rawOk++;
    if (cOk) checkedOk++;
    if (!rOk || !cOk) misses.push(`    ${f}: want ${JSON.stringify(p.expect[f])}, model ${JSON.stringify(raw[f])}, checked ${JSON.stringify(checked[f])}`);
  }
  console.log(`${p.name} (${secs.toFixed(1)}s)${misses.length ? "\n" + misses.join("\n") : ": all fields right"}`);
}
console.log(`\nModel alone: ${rawOk}/${total} fields. After checks: ${checkedOk}/${total}. Median ${times.sort((a, b) => a - b)[times.length >> 1]?.toFixed(1)}s per posting. ${errors} of ${times.length} runs failed.`);
await c.close();
process.exit(0);
