# Security

PostingSieve reads text written by strangers, on sites it doesn't control, and feeds it to a language model. This file covers what it defends against, how, and what it can't fix.

## What it protects

- Your criteria (salary floor, cities, limits), which reveal your situation.
- Which jobs you opened and how they scored.
- The accuracy of the verdict.

## Who it defends against

| Attacker | Can do | Defence |
|---|---|---|
| Anyone publishing a posting | Write any text, including instructions to the model | Treated as data; values are checked against the text |
| A job site | Run any script in its own pages, and read and measure the DOM | Isolated world, closed shadow root, nothing readable in the DOM |
| A compromised tab | Send any message from its content script | The service worker decides what each sender may do |
| Other extensions and websites | Try to message the extension | Rejected |

## Defences

**Least privilege.** The only permissions are `storage` and `sidePanel`, with no host permissions and no web-accessible resources. Content scripts run only on four exact origins, in the top frame, and read nothing outside the job sections of those sites. The extension doesn't run in Incognito.

**No network.** The Content Security Policy sets `connect-src 'none'` for the service worker and settings page. Content scripts contain no network calls, and the build fails if any appear.

**Trust boundary at the service worker.** Storage is set to `TRUSTED_CONTEXTS`, so content scripts can't read or write it. The service worker identifies each sender from the browser-supplied origin, never from the message. A tab can only act as its own site, and only gets verdicts for that site's jobs. Raw output and forced re-reads are for the settings page only.

**Nothing in the page.** By default the content script only reads. Results go to the toolbar icon and side panel, which pages can't see, so a site's own scripts find no added elements and can't probe extension files. On-page badges are opt-in. When on, they have no attributes, classes or open shadow roots, and the same size for every verdict.

**Posting text is hostile.** It's stripped of invisible and direction-changing characters, can't close the prompt's delimiter, is capped at 100,000 characters, and has runs of digits and whitespace bounded so the checks can't be made slow. Model output must match a fixed pattern, is parsed defensively, and is then checked against the posting. All of it is rendered with `textContent`.

**Resource limits.** One prompt at a time, at most 8 queued, 30 uncached reads per tab per minute, and a 45-second timeout. Constant page mutations can't starve the badge.

**Stored data.** Job results are in memory-only session storage, so job history doesn't reach disk, and any cache an earlier version saved is removed on install or update. Entries are validated on read and keyed by SHA-256 of the cleaned text. Only your must-haves and the on-page setting are on disk.

**Supply chain and your PC.** Nothing third-party ships: there are no runtime dependencies. Dev dependencies are pinned with a lockfile and install scripts are disabled in `.npmrc`. `npm run build` and `npm test` run those tools inside a macOS sandbox ([scripts/build.sb](scripts/build.sb)) with no network, no writes outside the project and temp folders, and no reads of credentials or personal folders. `npm run test:sandbox` checks that it's still blocking. The extension itself has no permission to run programs, connect to native apps, or read files outside Chrome.

**Test tooling.** The Chrome driver in `scripts/` deletes profile data and enables debugging, so it refuses any profile not marked as a test profile. It only launches Chrome at its standard path.

**No identifying data in the project.** Source and bundle contain no names, home paths or real job IDs, and the same bundle comes out when built in a different folder, so no path is embedded. Test postings are invented. There's no telemetry.

`scripts/check-dist.mjs` runs on every build and fails if the manifest or bundle loses these properties. `tests/security.test.ts` covers the logic.

## Known limits

These can't be fully fixed from inside an extension.

- **A posting can lie.** If it says "$200,000" in plain text, the badge believes it. The same goes for visually disguised text, such as white text on white, which still counts as visible to the browser. The checks catch a model that disagrees with its evidence, not a posting that lies consistently.
- **A sophisticated prompt injection may still work.** If injected text gets the model to change a value and its quote together, using wording that really is in the posting, the checks can't tell. Treat a green badge as a filter, not proof.
- **Job sites know what you open.** A site you're signed into sees which postings you view, with or without this extension. That's normal use of the site and nothing here can change it.
- **On-page badges are detectable, if you turn them on.** A site can see an element was added, which suggests the extension is in use, and could link that to your account and to the jobs you scored, though not the verdict. It could also hide the badge or draw a fake one. The toolbar and panel avoid this.
- **Indirect signals.** Running the model uses CPU or GPU, and reading the page forces layout. A site could in theory measure timing, though nothing would distinguish that from other load on your machine.
- **A URL can mislabel a job.** The job ID comes from the URL, so with on-page badges on, a crafted link pairing one job's ID with another's page could put the wrong small badge on that job's card. It affects only that one card, in that browser session, and opening the posting corrects it, since the score comes from the text you're viewing.
- **Your must-haves aren't encrypted.** They sit in your Chrome profile, so anything with access to that folder, or a backup of it, can read them. Use disk encryption.
- **Other extensions with broad access.** An extension with debugger or all-sites permissions can see the same pages and may reach further. Chrome doesn't protect against that.
- **Google's model and Chrome.** A capture of Chrome's traffic, including decrypted bytes, with marker text in a posting and in the must-haves found neither during scoring. A search like this can't see data that Chrome compresses or encrypts again before sending. Chrome separately contacts Google for its own updates and services, which this extension doesn't control. This was tested on one version of Chrome and doesn't amount to auditing it.
- **Installing dependencies.** `npm install` itself isn't sandboxed, though install scripts are off so no package code runs during it. Only install from a lockfile you trust.
- **The extension ID.** Chrome derives an unpacked extension's ID from its folder path, so it differs per machine. It can't be reversed into the path, and pages have no way to read it or reach anything with it, but it's stable on your machine, so avoid sharing it.
- **Sharing the folder.** A zip or tar of the project can carry your macOS username and file timestamps. Publish through git, with a separate commit identity, and not as an archive of this folder.

## Reporting

Open an issue on the repository, or contact the maintainer privately for anything sensitive.
