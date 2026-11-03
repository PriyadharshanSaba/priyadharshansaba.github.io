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
Shows views, approximate visitors, a 10-day chart, and top cities, countries, pages and referrers.

## Local development
`npm run dev` serves the API at `http://localhost:8787/api`, plus `/track.js` and `/dashboard` from `public/`.
Secrets go in `engage/.env` (git-ignored). Never commit it. Use a separate Turso database for local work.

## Deploying
Deploy by hand from `engage/` with `npx vercel --prod`. **Do not connect the Vercel project to the
GitHub repo**: Vercel would build the whole site repo and replace the API with a static site.

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
"Unique visitors" is therefore per-day approximate.

## Open items
- No UI for approving comments yet (use `POST /api/moderate` with the admin token).
- Bot filtering is a user-agent pattern, so it is partial.
- Visitor identity is IP + browser type, so people behind one shared network and device type can merge.
