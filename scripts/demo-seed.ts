// Creates the demo user (default "Rick") with a pre-loaded terrible week so `report`, the swipe page
// rap sheet and the Wall of Shame have material immediately. Re-runnable: replaces the previous demo user.
// Sends nothing to iMessage. Usage: bun run demo-seed
//
// Optional env:
//   DEMO_NAME            first name (default Rick)
//   DEMO_PHONE           your phone, e.g. +15551234567, so budget/appeal/report from your phone act as Rick
//   DEMO_GROUP_SPACE_ID  the group chat's space id (from the [photon] in space=... log) so roasts land there
import { config } from "../src/config";
import { db, migrate, query } from "../src/db";
import { buildSnitch } from "../src/engine/roast";
import {
  addDays,
  applyCooldowns,
  detectOffenses,
  localTime,
  weekStart,
  type LastOffenses,
  type PurchaseInput,
} from "../src/engine/rules";
import { nessie } from "../src/nessie/client";
import { seedMerchants } from "../src/nessie/seed";
import { DEMO_BUDGETS, TERRIBLE_WEEK } from "./terrible-week";

const name = process.env.DEMO_NAME?.trim() || "Rick";
const phone = process.env.DEMO_PHONE?.trim() || null;
const groupSpaceId = process.env.DEMO_GROUP_SPACE_ID?.trim() || null;

if (!db) {
  console.error("DATABASE_URL is not set; demo-seed needs the database.");
  process.exit(1);
}

await migrate();
const merchants = await seedMerchants();
const byName = new Map(merchants.map((m) => [m.name, m]));

// Replace any previous demo user (cascades to purchases, offenses, groups, budgets...).
const removed = await query("DELETE FROM users WHERE lower(name) = lower($1) OR ($2::text IS NOT NULL AND phone = $2) RETURNING id", [name, phone]);
if (removed.length) console.log(`removed ${removed.length} previous demo user(s)`);

const customer = await nessie.createCustomer(name, "Snitch");
const account = await nessie.createAccount(customer.id, `${name}'s card`);
const token = Buffer.from(crypto.getRandomValues(new Uint8Array(6))).toString("base64url");
const dmSpaceId = config.spectrumProvider === "imessage" ? (phone ? `any;-;${phone}` : null) : "terminal";

const [user] = await query<{ id: number }>(
  `INSERT INTO users (name, phone, dm_space_id, nessie_customer_id, nessie_account_id, swipe_token)
   VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
  [name, phone, dmSpaceId, customer.id, account.id, token],
);
const userId = user!.id;

for (const [category, limit] of Object.entries(DEMO_BUDGETS)) {
  await query("INSERT INTO budgets (user_id, category, weekly_limit) VALUES ($1, $2, $3)", [userId, category, limit]);
}

if (groupSpaceId) {
  await query(
    `INSERT INTO groups (space_id, name, user_id) VALUES ($1, $2, $3)
     ON CONFLICT (space_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
    [groupSpaceId, "Demo group", userId],
  );
}

// Replay the week up to now. Times in the future are skipped, so this is fullest on a Sunday.
const now = new Date();
const cutoff = now.getTime() - 5 * 60_000;
const monday = weekStart(now);
const budgets = Object.entries(DEMO_BUDGETS).map(([category, weeklyLimit]) => ({ category, weeklyLimit }));
const history: PurchaseInput[] = [];
const last: LastOffenses = {};
let inserted = 0;
let roasted = 0;

for (const [day, hm, merchantName, amount] of TERRIBLE_WEEK) {
  const at = localTime(addDays(monday, day), hm);
  if (at.getTime() > cutoff) continue;
  const m = byName.get(merchantName);
  const category = m?.category ?? "misc";
  const purchaseId = `demo-${userId}-${inserted}`;

  const [row] = await query<{ id: number }>(
    `INSERT INTO purchases (user_id, nessie_purchase_id, merchant_id, merchant_name, category, amount, description, purchase_date, detected_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [userId, purchaseId, m?.nessie_merchant_id ?? null, merchantName, category, amount, merchantName, addDays(monday, day), at],
  );
  await query("INSERT INTO seen_purchases (nessie_purchase_id, user_id) VALUES ($1, $2)", [purchaseId, userId]);
  inserted++;

  const purchase: PurchaseInput = { merchantName, category, amount, detectedAt: at };
  // Cooldowns use the demo's own timeline, and offenses are dated in the past so they never block live taps.
  const offenses = applyCooldowns(detectOffenses(purchase, history, budgets, at), last, at, config.cooldownMs);
  history.push(purchase);
  if (!offenses.length) continue;

  const snitch = await buildSnitch(name, offenses);
  for (const [i, o] of offenses.entries()) {
    last[o.type] = { at, severity: o.severity };
    await query(
      `INSERT INTO offenses (user_id, purchase_id, trigger_type, severity, facts, roast, space_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, row!.id, o.type, o.severity, JSON.stringify(o.facts), i === 0 ? snitch.text : null, groupSpaceId ?? dmSpaceId, at],
    );
  }
  roasted++;
}

const total = history.reduce((s, p) => s + p.amount, 0);
console.log(`
${name} is ready: ${inserted} purchases ($${total.toFixed(2)}), ${roasted} roasts on the record.
  swipe page: ${config.publicUrl}/swipe/${token}
  phone:      ${phone ?? "(none: set DEMO_PHONE so your texts act as " + name + ")"}
  group:      ${groupSpaceId ?? "(none: set DEMO_GROUP_SPACE_ID, or text 'watch " + name + "' in the group)"}
  budgets:    ${Object.entries(DEMO_BUDGETS).map(([c, l]) => `${c} $${l}`).join(", ")}
`);
await db.end();
