# Build plan: prompts to paste into Claude Code

Run `/clear` between phases. CLAUDE.md carries the context. Commit after every phase that works (`git commit` is your undo button at 4am).

Before phase 0, do these by hand:
- [ ] Photon: account at app.photon.codes, project ID + secret, ask the booth for a hackathon iMessage line
- [ ] Nessie: API key from api.nessieisreal.com (MLH/Capital One booth if you need help)
- [ ] Gemini: API key from Google AI Studio
- [ ] Neon: create a project, copy the pooled connection string
- [ ] Railway account, and claim your .tech domain (MLH)
- [ ] Open Notability Pro and start a page for ideation (you need 2 screenshots for that prize)

---

## Phase 0 — Scaffold (use plan mode: Shift+Tab twice)

```
Read CLAUDE.md. Scaffold the project: bun init, install hono, spectrum-ts,
@neondatabase/serverless, @google/genai. Create the folder layout from CLAUDE.md
with stub files, config.ts that parses all env flags with sensible defaults
(everything defaults to mock), .env.example, src/db/schema.sql with tables for
users, groups, budgets, purchases (with detected_at), seen_purchases, offenses,
appeals, and a db/index.ts with a migrate() that runs schema.sql on boot.
index.ts should boot the Hono server with /healthz and nothing else yet.
Show me the plan first.
```

Verify: `bun run src/index.ts`, then `curl localhost:3000/healthz`.

## Phase 1 — Echo bot

```
Fetch and read the spectrum-ts getting-started, imessage provider, and
spaces-and-users docs listed in CLAUDE.md before writing code. Implement
bot/spectrum.ts: start the provider from SPECTRUM_PROVIDER, run the message loop,
echo text messages back, and export sendToSpace(spaceId, text) and
sendImage(spaceId, buffer). Log each incoming message with its space id.
Wire it into index.ts so the web server and bot run in the same process.
```

Verify: terminal provider echoes. Then set `SPECTRUM_PROVIDER=imessage`, text the line from your phone, and create a group chat with it plus one friend. **Don't move on until a real group chat works.**

## Phase 2 — Nessie

```
Implement nessie/client.ts (live) and nessie/mock.ts (in-memory, same interface):
createCustomer, createAccount, createMerchant, listMerchants, getPurchases(accountId),
createPurchase(accountId, merchantId, amount, description). Export one `nessie`
object chosen by NESSIE_MODE. Live client: 8s timeout, on failure log and fall back
to mock for that call. Then nessie/seed.ts: create ~8 merchants with categories
(food: Chipotle, DoorDash, Taco Bell; coffee: Starbucks; transport: Uber;
shopping: Amazon; nightlife: a bar; misc: Steam) and save their ids to the db.
Add `bun run seed`.
```

Verify: `NESSIE_MODE=live bun run seed`, then check the merchants exist with a GET.

## Phase 3 — Rules engine + simulator

```
Implement engine/rules.ts per CLAUDE.md: a pure function
detectOffenses(purchase, history, budgets, now) returning offense objects with
exact numbers and a severity 1-3. Include cooldown checks against the offenses
table. Then scripts/simulate.ts: creates a fake user, sets budgets, fires a
scripted "terrible week" of ~15 purchases through the engine, and prints each
offense. No iMessage, no LLM yet.
```

Verify: `bun run simulate` prints a sensible escalation. Tweak thresholds here, where iteration is fast.

## Phase 4 — Roasts

```
Implement engine/roast.ts: given an offense, build the factual line from a
template (numbers inserted by code), then ask Gemini for 1-2 sentences of roast
in the persona for that severity. Pass only the template facts to the model.
Strip any dollar figures from model output, cap at 280 chars, fall back to a
canned roast on error or when LLM_MODE=mock. Write 3 strong few-shot examples
per persona. Then engine/process.ts: processPurchase() runs rules -> roast ->
sendToSpace for the user's linked group (or DM) -> records the offense.
Hook the simulator to print the roasts.
```

Verify: `LLM_MODE=live bun run simulate`. Read every roast. Rewrite the few-shot examples until they are actually funny. This is the product; spend real time here.

## Phase 5 — Commands + poller + onboarding

```
Implement bot/commands.ts with every command in CLAUDE.md. `snitch on me` creates
the user, a Nessie customer + credit card account, a random swipe token, saves the
space id, and replies with PUBLIC_URL/swipe/<token> plus a one-line how-to.
`watch <name>` links a group. `appeal` uses Gemini as a judge that denies ~80%
of appeals with a ruling. Implement jobs/poller.ts (every POLL_INTERVAL_MS, for
each user, fetch purchases, process unseen ones) and jobs/weekly.ts (`report`
now, plus Sundays 6pm America/Detroit).
```

Verify: from your phone, `snitch on me`, `budget food 40`, then create purchases with curl and watch the roasts arrive.

## Phase 6 — Web

```
Build the web pages per CLAUDE.md. Swipe page: mobile-first, big merchant
buttons with preset amounts, spend-vs-budget bars per category, last 5 roasts,
tap -> POST -> processed immediately -> toast "the snitch has been notified".
Landing: one-line pitch, the bot's number as an sms: link with the body
"snitch on me", a QR code for that link, and a live Wall of Shame polling
/api/wall every 2s (first names only). Bold, slightly unhinged design: think
tabloid front page. Add /admin/reset.
```

Verify on your actual phone, not just desktop.

## Phase 7 — Deploy

```
Add a Dockerfile (oven/bun base) and railway.json with a healthcheck on
/healthz. Make sure the app reads PORT from env and runs migrations on boot.
List every env var I need to set in Railway.
```

Then by hand: push to GitHub, create the Railway service, set the env vars, add a custom domain and point your .tech CNAME at it. **Stop your local instance before the deployed one starts**, since only one process may hold the Photon line.

Verify: from a friend's phone, scan the QR on the landing page and go through the full flow cold.

## Phase 8 — Demo hardening

```
Add a demo seed: `bun run demo-seed` creates user "Rick" with a pre-loaded
terrible week (so `report` has material immediately) and links my group chat.
Add DEMO_MODE=1 that shortens cooldowns to 30s. Review the whole codebase for
anything that could crash the process on an external failure and wrap it.
```

Then by hand:
- [ ] Record a 60-90s backup video of the full flow (Wi-Fi will fail at some point)
- [ ] Write the Devpost entry: tag Nessie, Photon/Spectrum, Gemini, .tech, Notability; add Notability screenshots
- [ ] Rehearse the pitch: hand a judge your phone, they tap DoorDash $47, the group chat turns on you
- [ ] `/admin/reset` + `demo-seed` right before judging

## If you're behind schedule, cut in this order

1. Weekly job on a timer (keep `report` on demand)
2. Images/charts
3. Wall of Shame on the landing page (keep the QR + swipe page)
4. Appeals
Never cut: real group chat, swipe page, good roasts.
