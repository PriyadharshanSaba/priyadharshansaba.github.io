# portfolio-engage

Reusable comments + 10-day visitor analytics for any portfolio (static HTML or Next.js).

- `src/handler.ts` – one `Request -> Response` handler (mount in Next route, Vercel fn, Cloudflare Worker)
- `src/types.ts` – the `Store` interface; the only thing a storage backend implements
- `src/adapters/` – `memory` (tests/dev), `libsql` (Turso or local SQLite file)
- `src/client/embed.js` – drop-in script: comments box + anonymous page view. Copy it into each page folder.
- `public/track.js` – view-only tracker for pages with no comments. One copy, served by the API host.
- `public/dashboard/index.html` – analytics page served at `/dashboard` (needs the admin token)

One deployment serves every portfolio; rows are keyed by `site`.

## Counting visits
Add this to any page that doesn't use `embed.js` (which already sends a view):
```html
<script defer src="https://engage-api-ochre.vercel.app/track.js" data-site="github-io"></script>
```
It is under 1 KB, deferred, and uses `sendBeacon`, so it never blocks rendering.

Counting rules (all in `src/handler.ts`):
- One view per visitor per page per **15 minutes** (reloads don't inflate numbers).
- Bots, crawlers, headless browsers and requests with no user-agent are ignored.
- `/india/`, `/india/index.html` and `/india/?utm=x` are the same page.
- A referrer equal to the site's own host is dropped (internal navigation).
- Views older than **90 days** are deleted, opportunistically on ~2% of view requests (`cleanupChance`).

## Dashboard
Open `https://<api-host>/dashboard`, enter the site name (`github-io`) and the admin token.
Two headline numbers:
- **Visits**: one per person per day, however many pages they open. The 10-day chart plots this.
- **Page views**: every page opened (deduped to one per page per 15 minutes).

The **cities, countries and pages** tables count visits too: a person counts once per item per day (so someone
opening 3 pages counts once in their city and on each of those 3 pages). The **referrers** table counts page
views. Totals are computed only from the
days shown in the chart (UTC days, today included), so the headline numbers always match the bars.
A "person" is approximate: the visitor code is IP + browser type + date, so the same person on another
day or device counts again, and people sharing a network and device type can merge.

## VPN / datacenter grouping
Cloud servers, scanners and VPNs often report a city that isn't where a person is (Ashburn and Des Moines are
AWS and Azure regions). A user-agent check can't catch a scanner with a normal user-agent, so each view's IP is
checked against the [X4BNet/lists_vpn](https://github.com/X4BNet/lists_vpn) network lists:

| Label | Meaning |
|---|---|
| `vpn` | on the strict VPN list (checked first) |
| `datacenter` | on the combined VPN + datacenter list ("anything that is not an eyeball network") |
| `regular` | on neither list |
| *(none)* | unknown: lists not loaded, unreadable IP, or a row from before this existed |

- Only the **label** is stored (`views.network`); the IP stays in memory. The column is added to an existing
  table automatically on first run.
- The dashboard keeps `vpn` and `datacenter` visits out of the Cities and Countries lists and groups them in a
  collapsible **VPN / datacenter** row under each. They still count in the headline Visits and in Pages.
- Lists are matched in memory (merged ranges + binary search): about 90 ms and 20 MB to load once per cold
  start, then under a microsecond per lookup.
- The lists are broad but not complete (X4BNet says it does not list every VPN), so some VPN and bot traffic
  will still look regular. Old rows can't be reclassified because no IPs were kept.
- `/api/stats` includes `networkLists: { loaded, fetchedAt }` and the dashboard warns if the lists didn't load,
  so a broken deploy is visible rather than silent. If the lists are missing, views are still counted, just unlabelled.

**Licensing:** the X4BNet repo has no LICENSE file, and its data is built from IPLocate's IP-to-ASN database,
which asks for attribution ("IP address data powered by IPLocate.io"). Because of that the lists are **not
committed** here. They are downloaded into `engage/data/` (git-ignored): on Vercel by the build step, locally by `npm run lists`.

## Local development
`npm run lists` once to download the lists, then `npm run dev` serves the API at `http://localhost:8787/api`,
plus `/track.js` and `/dashboard` from `public/`. Without the lists everything works, but nothing is grouped.
Secrets go in `engage/.env` (git-ignored). Never commit it. Use a separate Turso database for local work.

## Deploying
From `engage/`: **`npm run deploy`** (same as `npx vercel --prod`).

The VPN/datacenter lists are fetched **on Vercel during the build** (`vercel.json` `buildCommand` runs
`scripts/fetch-lists.mjs`), so every deploy ships fresh lists and nothing needs downloading on your machine.
`includeFiles` puts the downloaded `data/` folder into the function. The lists are refreshed **per deploy**, not on a
schedule; the dashboard shows how old they are and warns after 30 days.

If GitHub can't be reached (3 tries) or a list looks truncated, the script exits with an error, the **build fails**,
and the previous deployment keeps serving. Re-run the deploy to retry.

**Do not connect the Vercel project to the GitHub repo**: Vercel would build the whole site repo and replace
the API with a static site.

## Storage options
| Option | Fit | Catch |
|---|---|---|
| **Turso (libSQL)** – recommended | SQLite semantics, free tier, same code locally via `file:dev.db` | one more account |
| Cloudflare D1 + Worker | Free, geo headers built in, very fast | tied to Cloudflare; needs a small adapter |
| Supabase Postgres | Dashboard, auth if you want logins later | heavier; free projects pause |
| Upstash Redis | Cheap counters | poor for listing comments / city queries |
| JSON file / local | Zero setup | needs a server you run; not for static hosting |

## Privacy choices
No cookies. Visitor = SHA-256(salt + day + IP + UA), so it rotates daily and the IP is never stored.
City/country come from CDN headers (Vercel/Cloudflare/Netlify), so no GeoIP database.
"Unique visitors" is therefore per-day approximate. The visitor's IP is also checked in memory against the
VPN/datacenter lists; only the resulting label (`vpn` / `datacenter` / `regular`) is stored.

## Open items
- No UI for approving comments yet (use `POST /api/moderate` with the admin token).
- Bot filtering is a user-agent pattern plus the datacenter list, so it is still partial.
- Cloud-provider ranges (AWS/Azure/GCP), Tor exit nodes and a browser-timezone-vs-IP check could be added later.
- Visitor identity is IP + browser type, so people behind one shared network and device type can merge.
