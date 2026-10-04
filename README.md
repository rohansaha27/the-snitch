# The Snitch

An iMessage bot that watches your (mock) bank account and rats you out to your group chat when you overspend. MHacks 2026.

- **iMessage** via Photon `spectrum-ts`
- **Bank data** via Capital One Nessie
- **Roasts** via Gemini. The rules decide *whether* to snitch and supply every number; the LLM only writes the joke.
- One Bun process runs the web pages, the bot, the Nessie poller and the Sunday report.

## Run locally

```bash
bun install
cp .env.example .env     # everything defaults to mock, so this boots with no keys
bun run dev              # web on :3000; the terminal provider opens a chat UI in this terminal
```

In the terminal chat, try `snitch on me`, then `budget food 40`, then open the swipe link it replies with.

| Script | What it does |
| - | - |
| `bun run dev` | App with hot reload |
| `bun run seed` | Create the 8 demo merchants in Nessie (`--force` to recreate) |
| `bun run simulate` | Fire a scripted terrible week through the engine and print every roast, no iMessage or db needed |
| `bun run demo-seed` | Create demo user Rick with a pre-loaded week (see `.env.example` for `DEMO_*`) |

## Modes

`SPECTRUM_PROVIDER=terminal|imessage`, `NESSIE_MODE=mock|live`, `LLM_MODE=mock|live`. A live mode with missing keys falls back to mock at boot. A live Nessie or Gemini call that fails falls back to mock for that call.

## Demo checklist

1. `curl -X POST "$PUBLIC_URL/admin/reset" -H "x-admin-secret: $DEMO_ADMIN_SECRET"`
2. `bun run demo-seed` with `DEMO_PHONE` and `DEMO_GROUP_SPACE_ID` set
3. Open Rick's swipe link on a phone, hand it to a judge, tap DoorDash, watch the group chat
4. Daytime demo? Tick "Pretend it's 2am" for the late-night roast

## Deploy (Railway)

Dockerfile + `railway.json` (healthcheck `/healthz`, one replica, no deploy overlap). Only one process may hold the Photon line, so stop any local `imessage` instance before the deployed one starts.
