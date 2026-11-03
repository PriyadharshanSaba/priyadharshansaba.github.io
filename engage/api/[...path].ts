import { handlerFromEnv } from "../src/config.ts";

// Vercel Functions: web-standard Request -> Response.
const ready = handlerFromEnv();
const handle = async (req: Request) => (await ready)(req);

export const GET = handle;
export const POST = handle;
export const OPTIONS = handle;
