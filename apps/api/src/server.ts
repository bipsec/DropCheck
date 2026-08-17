// Hono entrypoint for the Academic Companion API.
//
// This process owns everything the browser can't: the Claude Agent SDK
// (which spawns a ~300 MB native `claude` subprocess), the three
// in-process MCP servers, and the Supabase service-role key. The Next.js
// app on Vercel is a pure frontend that talks to this over CORS.
//
// Handlers take a standard `Request` and return a standard `Response`,
// so `c.req.raw` passes straight through — the same signatures the
// Next.js route handlers used.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getSettings } from "@/lib/server/config";
import { handleChat } from "./routes/chat";
import { handleHealth } from "./routes/health";
import { handleSession } from "./routes/session";

export function createApp(): Hono {
  const { web_origins } = getSettings();
  const app = new Hono();

  // Credentialed CORS. The session cookie means we must echo back an
  // exact origin — a browser rejects `Access-Control-Allow-Origin: *`
  // whenever `Allow-Credentials: true` is present, so an allowlist is
  // the only workable shape here, not merely the safer one.
  app.use(
    "/api/*",
    cors({
      origin: (origin) => (web_origins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["content-type"],
      maxAge: 86400,
    }),
  );

  app.get("/api/health", () => handleHealth());
  app.post("/api/session", (c) => handleSession(c.req.raw));
  app.post("/api/chat", (c) => handleChat(c.req.raw));

  return app;
}

// Only start listening when run directly — `server.test.ts` imports
// `createApp()` and drives it via `app.request()` with no socket.
if (process.env.VITEST === undefined) {
  const app = createApp();
  const port = Number(process.env.PORT ?? 8080);
  const { web_origins } = getSettings();
  if (web_origins.length === 0) {
    console.warn(
      "[server] WEB_ORIGIN is unset — every cross-origin browser request " +
        "will be blocked by CORS.",
    );
  }
  serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
    console.log(`[server] listening on :${info.port}`);
    console.log(`[server] allowed origins: ${web_origins.join(", ") || "(none)"}`);
  });
}
