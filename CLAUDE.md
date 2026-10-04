# The Snitch

A hackathon prototype (MHacks 2026, solo, 24h). An iMessage bot that watches your (mock) bank account and rats you out to your group chat when you overspend. Cheeky tone, real fintech plumbing underneath.

## Priorities (read this first)

1. **Demo-first.** It must work reliably in front of judges. It does not need to be production-grade.
2. **Every external dependency has a mock.** Photon, Nessie, and the LLM can each be swapped for a local fake via env flags, so the app always boots.
3. **Simple over clever.** No auth system, no test suites, no abstraction layers beyond the mocks, no ORMs. Raw SQL is fine. Inline HTML templates are fine.
4. **Deployable as one process.** A single long-running Bun process serves the web pages, runs the iMessage message loop, the Nessie poller, and the weekly job. It must not rely on serverless.

## Stack

- Runtime: Bun + TypeScript
- iMessage: `spectrum-ts` (Photon) with the cloud iMessage provider; `terminal` provider for local dev
- Bank data: Capital One Nessie API (`https://api.nessieisreal.com`, `?key=` on every request; plain http times out)
- LLM: Gemini via `@google/genai`, model name from `GEMINI_MODEL` env
- DB: Postgres on Neon via `@neondatabase/serverless` (raw SQL, schema in `src/db/schema.sql`)
- Web: Hono, server-rendered HTML strings, vanilla JS with polling (no React, no build step)
- Deploy: Railway (Dockerfile), one service

## IMPORTANT: spectrum-ts is new

Do not guess the spectrum-ts API from memory. Before writing or changing any Photon code, fetch and read the relevant docs:

- https://photon.codes/docs/spectrum-ts/getting-started.md
- https://photon.codes/docs/spectrum-ts/providers/imessage
- https://photon.codes/docs/spectrum-ts/spaces-and-users.md
- https://photon.codes/docs/spectrum-ts/messages.md
- https://photon.codes/docs/spectrum-ts/content/attachments.md
- https://photon.codes/docs/spectrum-ts/reactions-and-replies.md
- Index of all pages: https://photon.codes/docs/agents/stable.md

Known patterns (verify against docs):
- `const app = await Spectrum({ projectId, projectSecret, providers: [...] })`
- `for await (const [space, message] of app.messages) { ... }`, text at `message.content.text` when `message.content.type === "text"`
- Proactive send: `const im = imessage(app); const s = await im.space.get(spaceId); await s.send("...")`
- DM by phone: `const u = await im.user("+1..."); const dm = await im.space.create(u)`
- Images: `space.send(attachment(buffer, { name, mimeType }))`

Only ONE running instance may be connected to the Photon line at a time. Local dev uses the terminal provider unless explicitly testing iMessage.

## Env flags

```
SPECTRUM_PROVIDER=terminal|imessage
NESSIE_MODE=mock|live
LLM_MODE=mock|live
POLL_INTERVAL_MS=5000          # set to 3000 for demo
DEMO_ADMIN_SECRET=...          # protects /admin/reset
PUBLIC_URL=https://...         # used in links the bot sends
```

All other secrets in `.env` (never commit). Keep `.env.example` updated whenever a new var is added.

## Layout

```
src/
  index.ts            boots web server, bot loop, poller, weekly job
  config.ts           env parsing + mode flags
  db/schema.sql, db/index.ts
  nessie/client.ts    live client
  nessie/mock.ts      in-memory fake with the same interface
  nessie/seed.ts      creates merchants (+ a demo customer/account)
  bot/spectrum.ts     provider setup, send helpers (sendToSpace)
  bot/commands.ts     command parsing + handlers
  engine/rules.ts     deterministic offense detection
  engine/roast.ts     LLM roast writer (+ mock canned roasts)
  engine/process.ts   processPurchase(): rules -> roast -> send -> record
  jobs/poller.ts      polls Nessie, calls processPurchase for unseen ids
  jobs/weekly.ts      Sunday report + on-demand `report`
  web/server.ts       Hono routes
  web/pages/*.ts      landing, wall of shame, swipe panel
scripts/simulate.ts   fires fake purchases through the engine, prints roasts (no iMessage needed)
```

## Core rules

- **Rules decide whether to snitch; the LLM only decides how.** `engine/rules.ts` is pure and deterministic. It returns offense objects with exact numbers.
- **The LLM never produces numbers.** Dollar amounts, counts and times are inserted by a template. The LLM writes one to two sentences of roast around them. Validate output length and strip any `$` figures the model invents.
- Triggers: weekly category budget crossed (100%, 150%, 200%), merchant streak (3rd+ order this week), late night (11pm–4am, using our own `detected_at`, since Nessie `purchase_date` is date-only), single purchase over threshold.
- Cooldown: max one snitch per (user, trigger type) per hour. Demo mode can lower this.
- Purchases from the swipe page are processed immediately (low latency for demos) AND recorded in `seen_purchases` so the poller skips them. The poller catches anything created elsewhere.
- Persona escalates with severity: 1 = disappointed parent, 2 = sports commentator, 3 = official press release.

## Bot commands (in DM or group)

- `snitch on me` — onboard: create user + Nessie account, store space id, reply with personal swipe link
- `watch <name>` — in a group: link this group to that user so roasts go here
- `budget <category> <amount>` — weekly cap
- `appeal <excuse>` — LLM judge grants or denies a pardon (mostly denies)
- `report` — weekly roast now
- `help`

## Web routes

- `GET /` — landing: pitch, bot phone number, "text `snitch on me`", live Wall of Shame (first names only)
- `GET /swipe/:token` — personal swipe panel: merchant buttons, spend vs budget bars, recent roasts
- `POST /swipe/:token` — create Nessie purchase, process immediately
- `GET /api/wall` — JSON feed for the landing page (polled every 2s)
- `POST /admin/reset` — wipe and reseed (requires `DEMO_ADMIN_SECRET`)
- `GET /healthz`

## Conventions

- Log every external call with a short tag: `[nessie]`, `[photon]`, `[llm]`.
- Never crash the process on an external failure. Log it, fall back to mock behavior or skip, keep running.
- After finishing a task, tell me exactly how to verify it manually (what to run, what to text, what I should see).
