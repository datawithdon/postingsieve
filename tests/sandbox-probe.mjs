// Run through scripts/sandboxed.sh to confirm the sandbox blocks what it should.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const home = os.homedir();
const results = {};
const attempt = (name, f) => { try { f(); results[name] = "ALLOWED"; } catch { results[name] = "blocked"; } };
attempt("read SSH keys", () => fs.readdirSync(path.join(home, ".ssh")));
attempt("read Chrome data", () => fs.readdirSync(path.join(home, "Library/Application Support/Google")));
attempt("read Documents", () => fs.readdirSync(path.join(home, "Documents")));
attempt("write to home", () => { const f = path.join(home, ".postingsieve-probe"); fs.writeFileSync(f, "x"); fs.rmSync(f); });
attempt("add a LaunchAgent", () => { const f = path.join(home, "Library/LaunchAgents/postingsieve-probe.plist"); fs.writeFileSync(f, "x"); fs.rmSync(f); });
try { await fetch("https://example.com/", { signal: AbortSignal.timeout(4000) }); results["reach the network"] = "ALLOWED"; } catch { results["reach the network"] = "blocked"; }
console.log(JSON.stringify(results));
process.exit(Object.values(results).includes("ALLOWED") ? 1 : 0);
