import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handlerFromEnv } from "./config.ts";

const handle = await handlerFromEnv();
const port = Number(process.env.PORT ?? 8787);
const PUBLIC = join(import.meta.dirname, "..", "public");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript" };

createServer(async (nreq, nres) => {
  // Mirror Vercel: anything outside /api is served from public/ (e.g. /track.js, /dashboard).
  const path = new URL(nreq.url ?? "/", "http://x").pathname;
  if (!path.startsWith("/api")) {
    const rel = normalize(path.endsWith("/") ? path + "index.html" : path);
    const file = join(PUBLIC, rel.includes("..") ? "404" : (extname(rel) ? rel : rel + "/index.html"));
    try {
      const data = await readFile(file);
      nres.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
      nres.end(data);
    } catch { nres.writeHead(404); nres.end("not found"); }
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of nreq) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const req = new Request(`http://localhost:${port}${nreq.url}`, {
    method: nreq.method,
    headers: nreq.headers as Record<string, string>,
    body: nreq.method === "GET" || nreq.method === "HEAD" ? undefined : body,
  });
  const res = await handle(req);
  nres.writeHead(res.status, Object.fromEntries(res.headers));
  nres.end(Buffer.from(await res.arrayBuffer()));
}).listen(port, () => console.log(`engage dev API on http://localhost:${port}/api`));
