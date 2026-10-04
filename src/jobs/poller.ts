// Polls Nessie for every user's purchases and processes ones nobody has seen yet
// (anything not made through the swipe page, e.g. a curl or the Nessie dashboard).
import { config } from "../config";
import { db, query } from "../db";
import { processPurchase } from "../engine/process";
import { nessie } from "../nessie/client";

let running = false;

export async function pollOnce(): Promise<void> {
  const users = await query<{ id: number; nessie_account_id: string }>(
    "SELECT id, nessie_account_id FROM users WHERE nessie_account_id IS NOT NULL",
  );
  for (const u of users) {
    const purchases = await nessie.getPurchases(u.nessie_account_id);
    if (!purchases.length) continue;
    const seen = new Set(
      (await query<{ nessie_purchase_id: string }>(
        "SELECT nessie_purchase_id FROM seen_purchases WHERE nessie_purchase_id = ANY($1)",
        [purchases.map((p) => p.id)],
      )).map((r) => r.nessie_purchase_id),
    );
    for (const p of purchases) {
      if (seen.has(p.id)) continue;
      console.log(`[poller] new purchase ${p.id} user=${u.id} $${p.amount}`);
      await processPurchase({
        userId: u.id,
        nessiePurchaseId: p.id,
        merchantId: p.merchantId,
        amount: p.amount,
        description: p.description,
        purchaseDate: p.purchaseDate,
      });
    }
  }
}

export function startPoller(): void {
  if (!db) {
    console.warn("[poller] DATABASE_URL not set, poller disabled");
    return;
  }
  setInterval(async () => {
    if (running) return; // a slow Nessie must not stack up ticks
    running = true;
    try {
      await pollOnce();
    } catch (err) {
      console.error("[poller] tick failed:", (err as Error).message);
    } finally {
      running = false;
    }
  }, config.pollIntervalMs);
  console.log(`[poller] every ${config.pollIntervalMs}ms`);
}
