import { createServer } from "node:http";
import { handlerFromEnv } from "./config.ts";

const handle = await handlerFromEnv();
const port = Number(process.env.PORT ?? 8787);

createServer(async (nreq, nres) => {
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
