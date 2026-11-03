# portfolio-engage

Reusable comments + 10-day visitor analytics for any portfolio (static HTML or Next.js).

- `src/handler.ts` – one `Request -> Response` handler (mount in Next route, Vercel fn, Cloudflare Worker)
- `src/types.ts` – the `Store` interface; the only thing a storage backend implements
- `src/adapters/` – `memory` (tests/dev), `libsql` (Turso or local SQLite file)
- `src/client/embed.js` – drop-in script: comments box + anonymous page view
- `src/client/dashboard.html` – analytics page (needs admin token)

One deployment serves every portfolio; rows are keyed by `site`.

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
Moderation default, rate limiting, hosting target, and wiring into each portfolio.
