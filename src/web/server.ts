import { Hono } from "hono";
import { config } from "../config";
import { db, dbStatus, query } from "../db";
import { processPurchase } from "../engine/process";
import { localTime, TZ } from "../engine/rules";
import { nessie } from "../nessie/client";
import { seedMerchants } from "../nessie/seed";
import { landingPage, wallData } from "./pages/landing";
import { layout, masthead } from "./pages/layout";
import { swipePage, swipeState, type SwipeUser } from "./pages/swipe";

export const app = new Hono();

app.onError((err, c) => {
  console.error(`[web] ${c.req.method} ${c.req.path} failed:`, err.message);
  return c.req.path.startsWith("/api") || c.req.method !== "GET"
    ? c.json({ error: "something broke" }, 500)
    : c.html(layout("Error · The Snitch", `${masthead("")}<h2>Stop the presses</h2><p>Something broke. Refresh in a sec.</p>`), 500);
});

app.get("/healthz", (c) =>
  c.json({
    ok: true,
    db: dbStatus,
    modes: {
      spectrum: config.spectrumProvider,
      nessie: config.nessieMode,
      llm: config.llmMode,
    },
  }),
);

const emptyWall = { feed: [], mostWanted: [] };

app.get("/", async (c) => c.html(landingPage(db ? await wallData() : emptyWall)));

app.get("/api/wall", async (c) => c.json(db ? await wallData() : emptyWall));

async function userByToken(token: string): Promise<SwipeUser | undefined> {
  if (!db) return undefined;
  const [u] = await query<SwipeUser>("SELECT id, name, swipe_token, nessie_account_id FROM users WHERE swipe_token = $1", [token]);
  return u;
}

const notFound = () =>
  layout("Not found · The Snitch", `${masthead("")}<h2>No such card</h2><p>This link isn't on file. Text the bot <b>snitch on me</b> to get yours.</p>`);

app.get("/swipe/:token", async (c) => {
  const user = await userByToken(c.req.param("token"));
  if (!user) return c.html(notFound(), 404);
  return c.html(swipePage(user.swipe_token, await swipeState(user)));
});

app.get("/swipe/:token/state", async (c) => {
  const user = await userByToken(c.req.param("token"));
  if (!user) return c.json({ error: "not found" }, 404);
  return c.json(await swipeState(user));
});

// "Today at 2:MM AM" Detroit time, for the swipe page's late-night toggle. Already late? Just use now.
function fakeLateNight(now = new Date()): Date {
  const hour = Number(now.toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }));
  if (hour >= 23 || hour < 4) return now;
  return localTime(now.toLocaleDateString("en-CA", { timeZone: TZ }), `02:${String(now.getMinutes()).padStart(2, "0")}`);
}

app.post("/swipe/:token", async (c) => {
  const user = await userByToken(c.req.param("token"));
  if (!user) return c.json({ error: "not found" }, 404);
  const body = await c.req.json<{ merchantId?: number; lateNight?: boolean }>().catch(() => ({}) as { merchantId?: number; lateNight?: boolean });
  const merchantId = Number(body.merchantId);
  if (!Number.isInteger(merchantId)) return c.json({ error: "unknown merchant" }, 400);
  const [merchant] = await query<{ name: string; default_amount: string; nessie_merchant_id: string }>(
    "SELECT name, default_amount, nessie_merchant_id FROM merchants WHERE id = $1",
    [merchantId],
  );
  if (!merchant) return c.json({ error: "unknown merchant" }, 400);

  const amount = Number(merchant.default_amount);
  // Nessie down or the account was a mock fallback? createPurchase falls back to the mock, so this always returns.
  const purchase = await nessie.createPurchase(user.nessie_account_id ?? "no-account", merchant.nessie_merchant_id, amount, merchant.name);
  const result = await processPurchase({
    userId: user.id,
    nessiePurchaseId: purchase.id,
    merchantId: merchant.nessie_merchant_id,
    amount,
    description: merchant.name,
    purchaseDate: purchase.purchaseDate,
    detectedAt: body.lateNight ? fakeLateNight() : undefined,
  });
  console.log(`[web] swipe user=${user.id} ${merchant.name} -> ${result.status}`);
  return c.json({ status: result.status, text: result.snitch?.text ?? null, state: await swipeState(user) });
});

// Wipes all user data and reseeds merchants. Secret via x-admin-secret header or ?secret=.
app.post("/admin/reset", async (c) => {
  const secret = c.req.header("x-admin-secret") ?? c.req.query("secret");
  if (secret !== config.demoAdminSecret) return c.json({ error: "forbidden" }, 403);
  if (!db) return c.json({ error: "no database" }, 503);
  await query("TRUNCATE users, groups, budgets, purchases, seen_purchases, offenses, appeals, weekly_reports RESTART IDENTITY CASCADE");
  const merchants = await seedMerchants(true);
  console.log("[admin] reset complete");
  return c.json({ ok: true, merchants: merchants.length });
});
