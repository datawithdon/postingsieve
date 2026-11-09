// Minimal Chrome driver over the DevTools pipe. Branded Chrome ignores --load-extension,
// so the extension is loaded with the Extensions.loadUnpacked CDP command instead.
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MARKER = ".postingsieve-test-profile";

/**
 * This driver deletes data from the profile it opens and turns on remote debugging, so it only
 * runs on a profile made for it. Pointing it at a real Chrome profile must fail, not wipe data.
 */
function assertTestProfile(profile) {
  const marker = path.join(profile, MARKER);
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(profile, { recursive: true });
  const existing = fs.readdirSync(profile).filter((f) => f !== "OptGuideOnDeviceModel");
  if (existing.length) throw new Error(`Refusing to use ${profile}: it has data and no ${MARKER} file, so it may be a real Chrome profile.`);
  fs.writeFileSync(marker, "");
}

export async function launch(profile, { headless = true, extraArgs = [] } = {}) {
  assertTestProfile(profile);
  // Chrome caches a service worker's script between runs of the same profile, which would test an old build.
  fs.rmSync(path.join(profile, "Default", "Service Worker"), { recursive: true, force: true });
  const args = ["--remote-debugging-pipe", "--enable-unsafe-extension-debugging", "--no-first-run", "--window-size=1280,1000", `--user-data-dir=${path.resolve(profile)}`, "about:blank"];
  if (headless) args.unshift("--headless=new");
  args.unshift(...extraArgs);
  const proc = spawn(CHROME, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
  let id = 0, buf = "";
  const pending = new Map(), listeners = [];
  proc.stdio[4].on("data", (d) => {
    buf += d;
    for (let i; (i = buf.indexOf("\0")) >= 0; buf = buf.slice(i + 1)) {
      const m = JSON.parse(buf.slice(0, i));
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      else listeners.forEach((l) => l(m));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    proc.stdio[3].write(JSON.stringify({ id: i, method, params, sessionId }) + "\0");
  });
  const attach = async (targetId) => (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  const open = async (url) => {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const session = await attach(targetId);
    await send("Page.enable", {}, session);
    await send("Runtime.enable", {}, session);
    await send("DOM.enable", {}, session);
    if (url) await send("Page.navigate", { url }, session);
    return { session, targetId };
  };
  const evaluate = async (session, expression, userGesture = false) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture }, session);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const close = () => { proc.kill(); return sleep(300); };
  return { send, open, attach, evaluate, close, on: (l) => listeners.push(l) };
}

/** All text in the page's badges, including inside closed shadow roots. */
export async function badges(c, session) {
  const { root } = await c.send("DOM.getDocument", { depth: -1, pierce: true }, session);
  const out = [];
  const text = (n) => (n.nodeType === 3 ? n.nodeValue : [...(n.shadowRoots ?? []), ...(n.children ?? [])].map(text).join(" "));
  const walk = (n) => {
    // Badges carry no marker the page could read, so find them by their closed shadow root.
    if ((n.shadowRoots ?? []).some((r) => r.shadowRootType === "closed")) {
      const t = text(n).replace(/\s+/g, " ").trim();
      if (/^PostingSieve:/.test(t)) out.push({ kind: "detail", text: t });
      else if (/^(Passes|Check|Fails)$/.test(t)) out.push({ kind: "card", text: t });
    }
    [...(n.shadowRoots ?? []), ...(n.children ?? [])].forEach(walk);
  };
  walk(root);
  return out;
}

export async function loadExtension(c, dir = "dist") {
  const { id } = await c.send("Extensions.loadUnpacked", { path: path.resolve(dir) });
  await sleep(1000);
  const { targetInfos } = await c.send("Target.getTargets");
  const sw = targetInfos.find((t) => t.type === "service_worker" && t.url.includes(id));
  return { id, swSession: await c.attach(sw.targetId) };
}
