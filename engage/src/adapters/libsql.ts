import type { Comment, PageView, Store } from "../types.ts";

/** Structural type so @libsql/client stays an optional peer dependency. */
interface Db {
  execute(q: string | { sql: string; args: unknown[] }): Promise<{ rows: Record<string, unknown>[] }>;
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS comments (
     id TEXT PRIMARY KEY, site TEXT NOT NULL, slug TEXT NOT NULL,
     author TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'visible', ip_hash TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_rate ON comments(ip_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_comments_page ON comments(site, slug, created_at)`,
  `CREATE TABLE IF NOT EXISTS views (
     site TEXT NOT NULL, path TEXT NOT NULL, visitor TEXT NOT NULL,
     country TEXT, city TEXT, referrer TEXT, ts INTEGER NOT NULL, network TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_views_site_ts ON views(site, ts)`,
];

/** Columns added after the first release. CREATE TABLE IF NOT EXISTS won't add them to an existing table. */
const MIGRATIONS = [{ table: "views", column: "network", ddl: `ALTER TABLE views ADD COLUMN network TEXT` }];

async function migrate(db: Db) {
  for (const m of MIGRATIONS) {
    const cols = (await db.execute(`PRAGMA table_info(${m.table})`)).rows.map((r) => String(r.name));
    if (cols.includes(m.column)) continue;
    // Two cold starts can race here; the loser gets "duplicate column", which is fine.
    try { await db.execute(m.ddl); } catch (e) {
      const again = (await db.execute(`PRAGMA table_info(${m.table})`)).rows.map((r) => String(r.name));
      if (!again.includes(m.column)) throw e;
    }
  }
}

const NETWORKS = new Set(["vpn", "datacenter", "timezone", "regular"]);

/** Works with Turso (hosted), a local SQLite file (file:dev.db) or Cloudflare-style libSQL. */
export async function libsqlStore(db: Db): Promise<Store> {
  for (const s of SCHEMA) await db.execute(s);
  await migrate(db);
  const q = (sql: string, args: unknown[]) => db.execute({ sql, args });
  return {
    async addComment(c) {
      await q(`INSERT INTO comments (id,site,slug,author,body,created_at,status,ip_hash) VALUES (?,?,?,?,?,?,?,?)`,
        [c.id, c.site, c.slug, c.author, c.body, c.createdAt, c.status, c.ipHash ?? null]);
    },
    async listComments(site, slug, limit) {
      const r = await q(
        `SELECT * FROM comments WHERE site=? AND slug=? AND status='visible' ORDER BY created_at DESC LIMIT ?`,
        [site, slug, limit]);
      return r.rows.map((x) => ({
        id: String(x.id), site: String(x.site), slug: String(x.slug), author: String(x.author),
        body: String(x.body), createdAt: Number(x.created_at), status: x.status as Comment["status"],
      }));
    },
    async setCommentStatus(id, status) { await q(`UPDATE comments SET status=? WHERE id=?`, [status, id]); },
    async countRecentComments(h, since) {
      const r = await q(`SELECT COUNT(*) AS n FROM comments WHERE ip_hash=? AND created_at>=?`, [h, since]);
      return Number(r.rows[0]?.n ?? 0);
    },
    async addView(v) {
      await q(`INSERT INTO views (site,path,visitor,country,city,referrer,ts,network) VALUES (?,?,?,?,?,?,?,?)`,
        [v.site, v.path, v.visitor, v.country ?? null, v.city ?? null, v.referrer ?? null, v.ts, v.network ?? null]);
    },
    async hasRecentView(site, path, visitor, since) {
      const r = await q(`SELECT 1 FROM views WHERE site=? AND path=? AND visitor=? AND ts>=? LIMIT 1`,
        [site, path, visitor, since]);
      return r.rows.length > 0;
    },
    async deleteViewsBefore(ts) { await q(`DELETE FROM views WHERE ts<?`, [ts]); },
    async viewsSince(site, since) {
      const r = await q(`SELECT * FROM views WHERE site=? AND ts>=?`, [site, since]);
      return r.rows.map((x) => ({
        site: String(x.site), path: String(x.path), visitor: String(x.visitor),
        country: (x.country as string) ?? undefined, city: (x.city as string) ?? undefined,
        referrer: (x.referrer as string) ?? undefined, ts: Number(x.ts),
        network: NETWORKS.has(String(x.network)) ? (x.network as PageView["network"]) : undefined,
      }));
    },
  };
}
