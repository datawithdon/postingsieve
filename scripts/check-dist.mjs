// Fails the build if the output loses a security property. Run by `npm run build`.
import fs from "node:fs";
import path from "node:path";

const problems = [];
const m = JSON.parse(fs.readFileSync("dist/manifest.json", "utf8"));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

if (!same(m.permissions, ["storage", "sidePanel"])) problems.push(`permissions changed: ${JSON.stringify(m.permissions)}`);
for (const k of ["host_permissions", "optional_permissions", "optional_host_permissions", "web_accessible_resources"]) {
  if (m[k]) problems.push(`manifest must not declare ${k}`);
}
if (m.incognito !== "not_allowed") problems.push("incognito must be not_allowed");
const csp = m.content_security_policy?.extension_pages ?? "";
for (const part of ["default-src 'none'", "script-src 'self'", "connect-src 'none'", "frame-ancestors 'none'"]) {
  if (!csp.includes(part)) problems.push(`CSP is missing ${part}`);
}
for (const script of m.content_scripts ?? []) {
  if (script.all_frames || script.match_about_blank) problems.push("content script must stay in the top frame");
  for (const match of script.matches) {
    if (/\*\.|<all_urls>|^\*:|^http:/.test(match)) problems.push(`content script match too broad: ${match}`);
  }
}

// Spelled in pieces so this file doesn't itself trip scanners looking for these names.
const SINKS = ["inner" + "HTML", "outer" + "HTML", "insertAdjacent" + "HTML", "document\\.wr" + "ite"];
const CALLS = ["ev" + "al\\(", "new Func" + "tion", "fet" + "ch\\(", "XMLHttp" + "Request", "Web" + "Socket", "Event" + "Source", "send" + "Beacon", "import" + "Scripts", "storage\\.sy" + "nc"];
const FORBIDDEN = new RegExp(`\\b(?:${[...SINKS, ...CALLS].join("|")})|\\bimport\\(|/Users/`);
// The only URLs allowed in code are the job-site origins it recognizes.
const ALLOWED_URLS = new Set(["https://www.linkedin.com", "https://ca.indeed.com", "https://www.indeed.com", "https://www.jobbank.gc.ca"]);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const file of walk("dist")) {
  if (file.endsWith(".map")) problems.push(`source map shipped: ${file}`);
  if (!/\.(js|html|css)$/.test(file)) continue;
  const hit = fs.readFileSync(file, "utf8").match(FORBIDDEN);
  if (hit) problems.push(`${file} contains ${hit[0]}`);
  for (const [url] of fs.readFileSync(file, "utf8").matchAll(/https?:\/\/[^\s"'`)]*/g)) {
    if (!ALLOWED_URLS.has(url)) problems.push(`${file} contains the URL ${url}`);
  }
}
const content = fs.readFileSync("dist/assets/content.js", "utf8");
if (/data-verdict|setAttribute\(["']data-/.test(content)) problems.push("content script writes data attributes the page can read");

if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join("\n"));
  process.exit(1);
}
console.log("PASS: dist security checks");
