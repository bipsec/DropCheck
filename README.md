# Academic Companion

> A year-long academic advisor for one student, remembered across every visit, grounded in a real university catalog.

Single-page chat UI. The advisor is powered by the **Claude Agent SDK** with **three MCP servers**:

- `rules-engine` — deterministic degree math (prereq checks, degree progress, drop-impact cascade, term-by-term planning). Pure logic; no LLM ever does the math itself.
- `profile-memory` — per-student persistent state (courses taken, waivers, transfers, advising notes). Read at the start of most turns; written whenever the student reveals something new.
- `university-catalog` — wraps [api.purdue.io/odata](https://api.purdue.io/odata). Cache-through to Supabase `course_cache`. Structured `{error, detail}` on any Purdue.io failure so the advisor degrades honestly to archetype-level reasoning.

## Two deployables, one repo

The app is an npm workspace split into a frontend and an API, and the split is not stylistic — it's forced:

**The Claude Agent SDK does not run in-process.** It spawns a native `claude` CLI subprocess resolved from a platform-specific optional dependency (`@anthropic-ai/claude-agent-sdk-linux-x64` and friends). That binary is **~300 MB**, versus Vercel's **250 MB** uncompressed function limit — it busts the cap on its own, before Next.js, React, or Supabase. It also writes session transcripts to `CLAUDE_CONFIG_DIR`, and a Vercel function's filesystem is read-only.

So:

| Workspace | Deploys to | Owns |
|---|---|---|
| `apps/web` | **Vercel** | Next.js pages + components. No API routes, no Supabase, no Anthropic, no secrets. Builds fully static. |
| `apps/api` | **Render** | Hono server: the Agent SDK, the three MCP servers, Supabase service-role access, migrations, smoke scripts. |
| `packages/shared` | — | The wire contract both sides typecheck against (`Track`/`FinalDiagram`/`FinalPlot` payloads + the SSE event union). Raw TypeScript, no build step, so there is no `dist/` to drift. |

The browser talks to the API cross-origin with `credentials: "include"`, and the API replies with a `SameSite=None; Secure; Partitioned` session cookie plus an exact-origin CORS allowlist.

## Layout

```
DropCheck/
├── apps/web/                     → Vercel
│   ├── app/                      #   App Router: /, /chat  (no app/api/**)
│   ├── components/               #   ChatView, ChatMessage, TrackView, PrereqDiagram,
│   │                             #     CreditPlot, CourseCard, CreditProgressBar, …
│   ├── lib/api-config.ts         #   API_BASE + apiUrl() — where the backend lives
│   ├── lib/api-chat.ts           #   Client-side SSE stream parser
│   ├── lib/session-bootstrap.tsx #   Mints the session cookie on mount
│   └── tests/                    #   4 jsdom render suites (31 tests)
├── apps/api/                     → Render
│   ├── src/server.ts             #   Hono app: CORS + routes + serve()
│   ├── src/routes/               #   chat.ts (SSE), session.ts, health.ts
│   ├── src/lib/                  #   sse.ts (headers/heartbeat), gate.ts (turn cap)
│   ├── lib/server/mcp/           #   Three MCP servers (in-process createSdkMcpServer)
│   ├── lib/server/agent/         #   session.ts, systemPrompt.ts, allowedTools.ts
│   ├── lib/server/services/      #   rulesEngine, trackBuilder, purdueClient,
│   │                             #     courseCache, profileStore, sessionStore, …
│   ├── lib/server/schemas/       #   Zod schemas (track, studentRecord, studentProfile)
│   ├── lib/server/data/programs  #   Archetype fixtures (cs_bs / business_bs / math_bs / psych_bs)
│   ├── db/                       #   schema.sql + per-phase migrations
│   ├── scripts/                  #   tsx-run scripts: probe / ingest / smoke
│   └── tests/                    #   15 node suites
├── packages/shared/src/          #   api-types.ts (viz payloads) + chat-events.ts (SSE union)
├── Dockerfile, .dockerignore     #   the apps/api image (root: npm workspace context)
├── render.yaml                   #   Render Blueprint for the API service
└── temp/                         #   data_API.py — reference Python impl of the Purdue client
```

## Quickstart

Requires Node 22+, npm, a Supabase project (Postgres), and an Anthropic key.

```sh
npm install                                   # links all three workspaces
cp apps/api/.env.example apps/api/.env.local  # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
                                              #   ANTHROPIC_API_KEY, SESSION_SECRET
cp apps/web/.env.example apps/web/.env.local  # NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
```

Apply the database schema — paste in order via the Supabase SQL editor:

1. [apps/api/db/schema.sql](apps/api/db/schema.sql) — full baseline (idempotent on re-apply)
2. [apps/api/db/phase2_migration.sql](apps/api/db/phase2_migration.sql), then `phase3`, then `phase4`
3. If migrating from an older DropCheck v1 deploy: [apps/api/db/phase0_teardown.sql](apps/api/db/phase0_teardown.sql) drops dead tables

Optionally prefetch the Purdue CS catalog:

```sh
npm run script:ingest-purdue-cs -w @dropcheck/api
```

Start both processes — **two terminals**, since they're two services:

```sh
npm run dev:api     # terminal 1 → :8080
npm run dev:web     # terminal 2 → :3000
```

Open `http://localhost:3000/chat`. In dev both apps are on `localhost`, so they're same-site and the cookie stays `SameSite=Lax`.

## API

Served by `apps/api` at `$NEXT_PUBLIC_API_BASE_URL`:

- `GET /api/health` — `{ok, uptime, turns_in_flight}`. Deliberately checks nothing external, so a Supabase or Anthropic outage can't make Render recycle a healthy container. Never gated, so a busy server still passes its health check.
- `POST /api/session` — mints or resolves the anonymous student session; returns `student_id` + `session_id` and sets `dropcheck_sid`.
- `POST /api/chat` — accepts `{prompt: string}`, streams SSE. Events (typed in [packages/shared/src/chat-events.ts](packages/shared/src/chat-events.ts)):
  - `assistant_text` — `{text}` per assistant content block
  - `tool_use` — `{tool_use_id, tool_name, input}` when the agent invokes an MCP tool
  - `tool_result` — `{tool_use_id, is_error, content}` when the tool returns
  - `run_result` — `{subtype, is_error, num_turns}` at end of turn
  - `error` — `{error, detail}` on any hard failure
  - `done` — `{session_id?}` terminates the stream

Failures are returned *inside* the SSE contract (`text/event-stream` even on a 401/400/503), so the client parser never has to branch on content-type.

Two things the stream does that aren't events:

- **A `: ping` comment frame every 15 s** ([src/lib/sse.ts](apps/api/src/lib/sse.ts)). A turn can go a minute between tool results with nothing on the wire, and any proxy in the path is entitled to reap an idle connection. The client's parser skips comment frames, so this is invisible to the UI.
- **A concurrency cap** ([src/lib/gate.ts](apps/api/src/lib/gate.ts)). Past `MAX_CONCURRENT_TURNS` (code default 1; `2` in [render.yaml](render.yaml)), `/api/chat` answers `503` with `error: "server_busy"` instead of accepting a turn it can't afford — see *Deployment* below for why this is app-level.

## Deployment

Do these in order. The database has to exist before the API's first real turn, and the API's URL is what the frontend build needs.

### 1. Database → Supabase

Apply the migrations to the **production** project (same order as *Quickstart*). `record_advising_note` fails without `advising_notes`, and that's a mid-conversation failure rather than a startup one, so it's easy to miss.

### 2. API → Render

Verify the image locally first. This is what catches Linux-only failures, and it's also how the instance size was chosen — the failure mode in production is an OOM kill (exit 137), not a build error:

```sh
docker build -t dropcheck-api .                              # from the repo root
docker run -d --name api -p 8080:8080 --memory 2g --env-file apps/api/.env.local dropcheck-api
curl localhost:8080/api/health
# after driving a real chat turn — high-water mark, no sampling needed:
docker exec api sh -c 'cat /sys/fs/cgroup/memory.peak'
```

**Measured**: one real turn (7 SDK turns, 6 MCP tool calls, ~55 s) peaks at **546 MiB** — roughly 200 MiB of Node plus the 309 MB `claude` subprocess. That's why [render.yaml](render.yaml) pins `plan: standard` (2 GB, ~$25/mo): Render's `free` and `starter` tiers are both 512 MB, and at that limit the container pins to the ceiling and stays alive only by evicting page cache, which means re-reading the 309 MB binary from disk on every spawn. The image itself is ~560 MB.

The [Dockerfile](Dockerfile) lives at the repo root because the build context needs `packages/shared` plus the root lockfile (npm workspace), and Docker only reads `.dockerignore` from the context root. The build hard-fails if the native `claude` binary didn't install, because otherwise that surfaces as a 500 on the first user's first message. **Never add `--omit=optional` to `npm ci`** — the ~300 MB binary *is* an optional dependency.

Then, in Render: **New → Blueprint → this repo**. It reads [render.yaml](render.yaml), creates the service, and prompts for the four secrets marked `sync: false` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `WEB_ORIGIN`). `SESSION_SECRET` is `generateValue: true`, so Render mints it and it never exists in a file or a shell history. Every later push to the default branch redeploys.

Nothing needs a CLI, and no env var has to be guessed: the service URL is `https://<name>.onrender.com`, derived from the name in `render.yaml`, so `WEB_ORIGIN` here and `NEXT_PUBLIC_API_BASE_URL` on Vercel can be set correctly in either order.

**`MAX_CONCURRENT_TURNS` is the one setting that protects the service.** Every chat turn spawns a `claude` subprocess with a multi-hundred-MB resident set, and one Render instance accepts unlimited concurrent requests — there is no platform-level concurrency flag to cap it with (Cloud Run's `--concurrency` has no Render equivalent). So the cap lives in [src/lib/gate.ts](apps/api/src/lib/gate.ts) and the excess is refused with a `503 server_busy`. It's set to `2` from the same measurement as the plan (~200 MiB floor + ~350 MiB per turn ≈ 900 MiB of 2 GB); raise it only together with the instance size.

### 3. Frontend → Vercel

- Project **Root Directory = `apps/web`**. Vercel detects the npm workspace and installs from the repo root.
- Env var `NEXT_PUBLIC_API_BASE_URL=https://<service>.onrender.com` for Production *and* Preview. It's inlined at build time, so changing it needs a redeploy, not a restart.
- No `vercel.json` — with `app/api/**` gone there's no function config left to set.

### Verifying the deployed pair

1. `curl https://<service>.onrender.com/api/health` → `{"ok":true,…}`.
2. In the app: DevTools → Application → Cookies shows `dropcheck_sid` with `SameSite=None`, `Secure`, `Partitioned`. Reload — the session survives.
3. Network shows `/api/chat` as `text/event-stream` with events arriving **incrementally**, not all at once on completion.
4. Render → **Logs** shows `[chat] tool_error …` warnings when a tool fails (the server-side diagnostic surface); **Metrics** shows memory staying under the plan's ceiling during a turn.

### Known limits

- **Safari.** ITP blocks third-party cookies outright. `Partitioned` (CHIPS) keeps Chrome working past third-party-cookie deprecation but does nothing for Safari, so Safari users may not hold a session until the frontend and API share a registrable domain (or a bearer-token fallback lands).
- **No rate limiting.** Every Render web service is public, and the browser calls this one directly — so `/api/chat` is an open endpoint that spends Anthropic credits. The concurrency gate caps *simultaneous* turns, not total spend. A per-student daily turn cap in Supabase is the cheapest real mitigation.
- **Two turns at a time.** Past `MAX_CONCURRENT_TURNS`, a third student gets `server_busy` rather than a slow answer. Fine for a demo, not for a class — and raising the number without raising memory just converts a clean 503 into an OOM kill that drops every conversation on the instance. Real capacity means a bigger plan plus autoscaling.
- **This costs money.** `plan: standard` is ~$25/mo, and the measurement above is why: 512 MB genuinely doesn't fit. The same workload sits inside Cloud Run's free tier, so Render is buying operational simplicity (no `gcloud`, no Secret Manager, no Artifact Registry, a predictable URL) with real dollars.
- **Cold starts.** `standard` doesn't spin down, so this mostly applies to deploys: a new instance pulls a ~560 MB image before it serves. On `free`/`starter` the service also sleeps after ~15 minutes idle.
- **Build minutes.** A build here takes roughly 5–10 minutes, so `autoDeploy: true` on a busy branch is what would consume the monthly allowance first.

## Scripts

Run against `@dropcheck/api`:

```sh
npm run script:probe-rules -w @dropcheck/api          # invoke each rules-engine tool with a canned input
npm run script:ingest-purdue-cs -w @dropcheck/api     # batch-fetch Purdue CS courses into course_cache
npm run script:probe-agent -w @dropcheck/api          # single "hi" turn against real Anthropic
npm run script:smoke-fallback -w @dropcheck/api       # mock catalog offline → verifies honest degradation
npm run script:smoke-e2e -w @dropcheck/api            # 4-turn conversation w/ session-resume across turns
```

Every smoke hits real infra (Supabase / Anthropic / Purdue.io) and prints per-turn observations.

## Test + typecheck + lint

```sh
npm run typecheck   # all three workspaces
npm run test        # 155 tests: 124 node (apps/api) + 31 jsdom (apps/web)
npm run lint
```

The suites are split along the same boundary as the deployables: `apps/api` runs pure node with no React plugin, `apps/web` runs jsdom render tests only.

## Architecture highlights

- **Grounded, never invented.** Every credit / prereq / term claim the advisor makes traces to a specific tool call. The system prompt (see [apps/api/lib/server/agent/systemPrompt.ts](apps/api/lib/server/agent/systemPrompt.ts)) forbids stating any of these from memory.
- **Prereq mismatch is honest.** Purdue.io only exposes prerequisites in free-text descriptions. The catalog's regex scrape lands with `prerequisites_confidence: "low_unstructured_hint"` and the advisor must caveat before treating any hint as authoritative.
- **Graceful degradation.** When the catalog returns `{error, detail}` the advisor stops retrying that tool for the turn, tells the student plainly, and falls back to archetype programs (four hand-authored `ProgramRequirements` fixtures) + student-asserted courses.
- **Session continuity.** The SDK's `session_id` emitted on turn 1 is persisted alongside the anonymous cookie. Every subsequent turn passes `options.resume` so the advisor picks up the accumulated conversation context and profile — this is what makes it feel year-long.
- **Chat-first with embedded viz.** When `build_track` / `impact_of_dropping` / `compute_degree_progress` / `get_course` return, the chat renders the payload inline as an SVG diagram / chart / card. Raw JSON one click away for auditing.
- **Secrets live in exactly one process.** The frontend bundle holds only `NEXT_PUBLIC_API_BASE_URL`; the service-role key and Anthropic key never leave the Render container.
