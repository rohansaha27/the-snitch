// processPurchase(): record -> rules -> roast -> send -> record offenses.
// Called by the swipe page (immediately) and the poller (for purchases made elsewhere).
import { sendToSpace } from "../bot/spectrum";
import { config } from "../config";
import { query } from "../db";
import { buildSnitch, type Snitch } from "./roast";
import { applyCooldowns, detectOffenses, type LastOffenses, type Offense, type PurchaseInput, type Severity, type TriggerType } from "./rules";

export interface IncomingPurchase {
  userId: number;
  nessiePurchaseId: string;
  merchantId: string;
  amount: number;
  description: string;
  purchaseDate: string; // YYYY-MM-DD from Nessie
  // Defaults to now. The swipe page's 2am toggle backdates it; only the late-night rule reads it.
  detectedAt?: Date;
}

export interface ProcessResult {
  status: "duplicate" | "clean" | "snitched";
  offenses: Offense[];
  snitch?: Snitch;
  spaceIds?: string[];
}

// Most recent offense per trigger type for a user, for applyCooldowns().
export async function loadLastOffenses(userId: number): Promise<LastOffenses> {
  const rows = await query<{ trigger_type: TriggerType; severity: number; created_at: Date }>(
    `SELECT DISTINCT ON (trigger_type) trigger_type, severity, created_at
     FROM offenses WHERE user_id = $1 ORDER BY trigger_type, created_at DESC`,
    [userId],
  );
  const last: LastOffenses = {};
  for (const r of rows) last[r.trigger_type] = { at: new Date(r.created_at), severity: r.severity as Severity };
  return last;
}

// Where a user's roasts go: every group watching them, else their DM.
export async function targetSpaces(userId: number): Promise<string[]> {
  const groups = await query<{ space_id: string }>("SELECT space_id FROM groups WHERE user_id = $1", [userId]);
  if (groups.length) return groups.map((g) => g.space_id);
  const [user] = await query<{ dm_space_id: string | null }>("SELECT dm_space_id FROM users WHERE id = $1", [userId]);
  return user?.dm_space_id ? [user.dm_space_id] : [];
}

// One purchase at a time per user, so rapid swipes can't both slip past a cooldown.
const userLocks = new Map<number, Promise<unknown>>();
function withUserLock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
  const prev = userLocks.get(userId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  userLocks.set(userId, next.catch(() => {}));
  return next;
}

export function processPurchase(p: IncomingPurchase): Promise<ProcessResult> {
  return withUserLock(p.userId, () => run(p));
}

async function run(p: IncomingPurchase): Promise<ProcessResult> {
  // Claim the purchase. If the swipe page and poller race, only one wins.
  const claimed = await query(
    `INSERT INTO seen_purchases (nessie_purchase_id, user_id) VALUES ($1, $2)
     ON CONFLICT (nessie_purchase_id) DO NOTHING RETURNING nessie_purchase_id`,
    [p.nessiePurchaseId, p.userId],
  );
  if (!claimed.length) return { status: "duplicate", offenses: [] };

  const now = new Date();
  const detectedAt = p.detectedAt ?? now;
  const [merchant] = await query<{ name: string; category: string }>(
    "SELECT name, category FROM merchants WHERE nessie_merchant_id = $1",
    [p.merchantId],
  );
  const merchantName = merchant?.name ?? (p.description || "Mystery Merchant");
  const category = merchant?.category ?? "misc";

  const [row] = await query<{ id: number }>(
    `INSERT INTO purchases (user_id, nessie_purchase_id, merchant_id, merchant_name, category, amount, description, purchase_date, detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (nessie_purchase_id) DO NOTHING RETURNING id`,
    [p.userId, p.nessiePurchaseId, p.merchantId, merchantName, category, p.amount, p.description, p.purchaseDate, detectedAt],
  );
  if (!row) return { status: "duplicate", offenses: [] };

  const [user] = await query<{ name: string }>("SELECT name FROM users WHERE id = $1", [p.userId]);
  const name = user?.name ?? "Someone";

  // Rules filter to this week themselves; 8 days covers any Monday boundary.
  const history = (
    await query<{ merchant_name: string; category: string; amount: string; detected_at: Date }>(
      `SELECT merchant_name, category, amount, detected_at FROM purchases
       WHERE user_id = $1 AND id <> $2 AND detected_at > now() - interval '8 days'`,
      [p.userId, row.id],
    )
  ).map((h): PurchaseInput => ({
    merchantName: h.merchant_name,
    category: h.category,
    amount: Number(h.amount),
    detectedAt: new Date(h.detected_at),
  }));
  const budgets = (
    await query<{ category: string; weekly_limit: string }>("SELECT category, weekly_limit FROM budgets WHERE user_id = $1", [p.userId])
  ).map((b) => ({ category: b.category, weeklyLimit: Number(b.weekly_limit) }));

  const purchase: PurchaseInput = { merchantName, category, amount: p.amount, detectedAt };
  const all = detectOffenses(purchase, history, budgets, now);
  const offenses = applyCooldowns(all, await loadLastOffenses(p.userId), now, config.cooldownMs);
  console.log(
    `[engine] user=${p.userId} ${merchantName} $${p.amount.toFixed(2)} -> ${offenses.map((o) => `${o.type}:${o.severity}`).join(",") || "clean"}${all.length > offenses.length ? ` (${all.length - offenses.length} on cooldown)` : ""}`,
  );
  if (!offenses.length) return { status: "clean", offenses };

  const snitch = await buildSnitch(name, offenses);
  const spaceIds = await targetSpaces(p.userId);
  if (!spaceIds.length) console.warn(`[engine] user=${p.userId} has no group or DM linked, roast not sent`);
  for (const spaceId of spaceIds) await sendToSpace(spaceId, snitch.text);

  // One row per offense so each trigger type gets its own cooldown; the roast is stored on the lead offense.
  for (const [i, o] of offenses.entries()) {
    await query(
      `INSERT INTO offenses (user_id, purchase_id, trigger_type, severity, facts, roast, space_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [p.userId, row.id, o.type, o.severity, JSON.stringify(o.facts), i === 0 ? snitch.text : null, spaceIds[0] ?? null, now],
    );
  }
  return { status: "snitched", offenses, snitch, spaceIds };
}
