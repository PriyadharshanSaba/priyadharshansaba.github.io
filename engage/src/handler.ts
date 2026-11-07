import type { Comment, Store } from "./types.ts";
import { aggregate, windowStart } from "./stats.ts";

export interface Options {
  store: Store;
  /** Origins allowed to call the API (your portfolio domains). */
  allowedOrigins: string[];
  /** Secret for GET /stats and moderation. Required to read analytics. */
  adminToken: string;
  /** Secret mixed into visitor hashes. Rotates daily automatically. */
  salt: string;
  /** "pending" = hold comments until approved. Default "visible". */
  commentStatus?: Comment["status"];
  statsDays?: number; // default 10
  /** Max comments per visitor per hour. Default 5. */
  commentsPerHour?: number;
  /** Chance (0..1) that a view request also purges rows older than 90 days. Default 0.02. */
  cleanupChance?: number;
}

const DEDUPE_MS = 15 * 60_000;           // one view per visitor per page per 15 minutes
const RETENTION_MS = 90 * 86_400_000;    // keep 90 days of views

/** Common crawlers, link previewers, headless browsers and scripts. Not exhaustive. */
const BOT_RE = /bot|crawl|spider|slurp|headless|preview|facebookexternalhit|embedly|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|httpclient|axios|node-fetch|go-http/i;
const isBot = (ua: string | null) => !ua || BOT_RE.test(ua);

/** "/india/index.html?utm=x#top" -> "/india/" so one page is one row. */
function normalizePath(raw: string) {
  let p = raw.split("#")[0].split("?")[0].slice(0, 200);
  if (!p.startsWith("/")) p = "/" + p;
  return p.replace(/index\.html$/, "");
}

const json = (data: unknown, status: number, cors: HeadersInit) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...cors } });

async function hash(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function visitorHash(req: Request, salt: string) {
  const day = new Date().toISOString().slice(0, 10);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  return hash(`${salt}|${day}|${ip}|${req.headers.get("user-agent") ?? ""}`);
}

/** Edge/CDN geo headers (Vercel, Cloudflare, Netlify). No IP lookup DB needed. */
function geo(h: Headers) {
  const dec = (s: string | null) => { try { return s ? decodeURIComponent(s) : undefined; } catch { return s ?? undefined; } };
  return {
    country: h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry") ?? h.get("x-nf-geo-country") ?? undefined,
    city: dec(h.get("x-vercel-ip-city")) ?? h.get("cf-ipcity") ?? undefined,
  };
}

/**
 * Web-standard Request -> Response, so it mounts anywhere:
 * Next route handler, Cloudflare Worker, Vercel function, Bun, Deno.
 * Routes (relative to wherever you mount it):
 *   GET  /comments?site=&slug=      POST /comments
 *   POST /view                      GET  /stats?site=&days=   (admin)
 *   POST /moderate                  (admin)
 */
export function createHandler(opts: Options) {
  const { store } = opts;
  return async function handle(req: Request): Promise<Response> {
    const origin = req.headers.get("origin") ?? "";
    const cors: HeadersInit = opts.allowedOrigins.includes(origin)
      ? { "access-control-allow-origin": origin, "access-control-allow-headers": "content-type,authorization", vary: "origin" }
      : {};
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const route = url.pathname.replace(/\/$/, "").split("/").pop();
    const isAdmin = req.headers.get("authorization") === `Bearer ${opts.adminToken}`;

    try {
      if (route === "comments" && req.method === "GET") {
        const site = url.searchParams.get("site"), slug = url.searchParams.get("slug");
        if (!site || !slug) return json({ error: "site and slug required" }, 400, cors);
        const list = await store.listComments(site, slug, 100);
        return json(list.map(({ ipHash: _h, ...pub }) => pub), 200, cors);
      }

      if (route === "comments" && req.method === "POST") {
        if (!cors["access-control-allow-origin" as keyof typeof cors]) return json({ error: "origin not allowed" }, 403, cors);
        const b = await req.json() as Record<string, unknown>;
        const author = String(b.author ?? "").trim().slice(0, 60);
        const body = String(b.body ?? "").trim().slice(0, 1000);
        if (b.website) return json({ ok: true }, 200, cors); // honeypot: bots fill this, humans don't see it
        if (!b.site || !b.slug || !author || body.length < 2) return json({ error: "invalid comment" }, 400, cors);
        const ipHash = await visitorHash(req, opts.salt);
        const recent = await store.countRecentComments(ipHash, Date.now() - 3_600_000);
        if (recent >= (opts.commentsPerHour ?? 5)) return json({ error: "too many comments, try later" }, 429, cors);
        const c: Comment = {
          id: crypto.randomUUID(), site: String(b.site), slug: String(b.slug), author, body,
          createdAt: Date.now(), status: opts.commentStatus ?? "visible", ipHash,
        };
        await store.addComment(c);
        const { ipHash: _omit, ...pub } = c;
        return json(pub, 201, cors); // rendered as text by the widget; never innerHTML
      }

      if (route === "view" && req.method === "POST") {
        const b = await req.json() as Record<string, unknown>;
        if (!b.site || !b.path) return json({ error: "site and path required" }, 400, cors);
        // Bots and clients with no user-agent get the same quiet 204, but are never counted.
        if (isBot(req.headers.get("user-agent"))) return new Response(null, { status: 204, headers: cors });

        const site = String(b.site).slice(0, 60);
        const path = normalizePath(String(b.path));
        const visitor = await visitorHash(req, opts.salt);
        const now = Date.now();
        // Navigating between your own pages is not a "referrer" worth reporting.
        let referrer = b.referrer ? String(b.referrer).slice(0, 200) : undefined;
        try { if (referrer && origin && referrer === new URL(origin).hostname) referrer = undefined; } catch { /* bad origin header */ }
        if (!(await store.hasRecentView(site, path, visitor, now - DEDUPE_MS))) {
          await store.addView({ site, path, visitor, ...geo(req.headers), referrer, ts: now });
        }
        // Retention: occasionally purge old rows so no scheduled job is needed.
        if (Math.random() < (opts.cleanupChance ?? 0.02)) {
          try { await store.deleteViewsBefore(now - RETENTION_MS); } catch { /* never fail a view over cleanup */ }
        }
        return new Response(null, { status: 204, headers: cors });
      }

      if (!isAdmin) return json({ error: "unauthorized" }, 401, cors);

      if (route === "stats" && req.method === "GET") {
        const site = url.searchParams.get("site");
        if (!site) return json({ error: "site required" }, 400, cors);
        const days = Math.min(Number(url.searchParams.get("days") ?? opts.statsDays ?? 10), 90);
        // Load exactly the days the chart shows, from UTC midnight, so totals match the bars.
        return json(aggregate(await store.viewsSince(site, windowStart(days)), days), 200, cors);
      }

      if (route === "moderate" && req.method === "POST") {
        const b = await req.json() as { id: string; status: Comment["status"] };
        await store.setCommentStatus(b.id, b.status);
        return json({ ok: true }, 200, cors);
      }
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: "bad request" }, 400, cors);
    }
  };
}
