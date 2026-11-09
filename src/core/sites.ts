export type Site = "linkedin" | "indeed" | "jobbank";

const ORIGINS: Record<string, Site> = {
  "https://www.linkedin.com": "linkedin",
  "https://ca.indeed.com": "indeed",
  "https://www.indeed.com": "indeed",
  "https://www.jobbank.gc.ca": "jobbank",
};

export const siteForOrigin = (origin: string | undefined): Site | null =>
  origin !== undefined && Object.hasOwn(ORIGINS, origin) ? ORIGINS[origin]! : null;

export const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type Caller = { kind: "settings" } | { kind: "content"; site: Site; tabId: number };

/**
 * Who sent a message, from the browser-supplied sender rather than anything in the message.
 * A compromised tab can send any payload but can't forge its origin, so one site's tab
 * never gets to act as another site, or as the settings page.
 */
export function classifySender(sender: { id?: string; origin?: string; url?: string; frameId?: number; tab?: { id?: number } }, runtimeId: string): Caller | null {
  if (sender.id !== runtimeId) return null;
  const own = `chrome-extension://${runtimeId}`;
  if (sender.origin === own) return sender.url?.startsWith(`${own}/src/options/`) || sender.url?.startsWith(`${own}/src/panel/`) ? { kind: "settings" } : null;
  const site = siteForOrigin(sender.origin);
  if (!site || sender.frameId !== 0 || sender.tab?.id === undefined) return null;
  return { kind: "content", site, tabId: sender.tab.id };
}
