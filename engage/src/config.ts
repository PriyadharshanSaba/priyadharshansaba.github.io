import { createClient } from "@libsql/client";
import { createHandler } from "./handler.ts";
import { libsqlStore } from "./adapters/libsql.ts";

const env = (k: string, fallback?: string) => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${k}`);
  return v;
};

/** Single place that turns env vars into a working handler (used by dev server and Vercel). */
export async function handlerFromEnv() {
  const db = createClient({ url: env("TURSO_URL", "file:dev.db"), authToken: process.env.TURSO_TOKEN });
  return createHandler({
    store: await libsqlStore(db),
    allowedOrigins: env("ALLOWED_ORIGINS", "http://localhost:8080").split(",").map((s) => s.trim()),
    adminToken: env("ADMIN_TOKEN", "dev-admin"),
    salt: env("SALT", "dev-salt"),
    commentStatus: process.env.COMMENT_STATUS === "pending" ? "pending" : "visible",
  });
}
