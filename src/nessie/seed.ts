// Creates the demo merchants in Nessie and saves their ids to the db.
// Runs on boot (only fills gaps) and via `bun run seed` (pass --force to recreate everything).
import { config } from "../config";
import { db, migrate, query } from "../db";
import { nessie } from "./client";
import { isMockId } from "./mock";

export const MERCHANTS = [
  { name: "Chipotle", category: "food", emoji: "🌯", defaultAmount: 14.85 },
  { name: "DoorDash", category: "food", emoji: "🛵", defaultAmount: 47.12 },
  { name: "Taco Bell", category: "food", emoji: "🌮", defaultAmount: 11.49 },
  { name: "Starbucks", category: "coffee", emoji: "☕", defaultAmount: 7.65 },
  { name: "Uber", category: "transport", emoji: "🚗", defaultAmount: 23.4 },
  { name: "Amazon", category: "shopping", emoji: "📦", defaultAmount: 89.99 },
  { name: "Rick's American Cafe", category: "nightlife", emoji: "🍻", defaultAmount: 38 },
  { name: "Steam", category: "misc", emoji: "🎮", defaultAmount: 59.99 },
] as const;

export type MerchantRow = {
  id: number;
  name: string;
  category: string;
  emoji: string | null;
  default_amount: string;
  nessie_merchant_id: string;
  source: string;
};

// Creates any merchant that is missing from the db or was created under a different NESSIE_MODE.
// Never throws.
export async function seedMerchants(force = false): Promise<MerchantRow[]> {
  if (!db) {
    console.warn("[seed] DATABASE_URL not set, skipping merchant seed");
    return [];
  }
  try {
    const existing = await query<MerchantRow>("SELECT * FROM merchants");
    const byName = new Map(existing.map((m) => [m.name, m]));
    let created = 0;
    for (const m of MERCHANTS) {
      const row = byName.get(m.name);
      if (!force && row && row.source === config.nessieMode) continue;
      const nm = await nessie.createMerchant(m.name, m.category);
      await query(
        `INSERT INTO merchants (name, category, emoji, default_amount, nessie_merchant_id, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE SET category = EXCLUDED.category, emoji = EXCLUDED.emoji,
           default_amount = EXCLUDED.default_amount, nessie_merchant_id = EXCLUDED.nessie_merchant_id,
           source = EXCLUDED.source`,
        [m.name, m.category, m.emoji, m.defaultAmount, nm.id, isMockId(nm.id) ? "mock" : config.nessieMode],
      );
      created++;
    }
    if (created) console.log(`[seed] created ${created} merchant(s) in nessie=${config.nessieMode}`);
    return await query<MerchantRow>("SELECT * FROM merchants ORDER BY id");
  } catch (err) {
    console.error("[seed] merchant seed failed:", (err as Error).message);
    return [];
  }
}

if (import.meta.main) {
  await migrate();
  const rows = await seedMerchants(process.argv.includes("--force"));
  for (const r of rows) {
    console.log(`  ${r.emoji ?? " "} ${r.name.padEnd(22)} ${r.category.padEnd(10)} $${r.default_amount.padStart(6)}  ${r.nessie_merchant_id} (${r.source})`);
  }
  const live = rows.find((r) => r.source === "live");
  if (live) {
    console.log(`\nCheck one in Nessie:\n  curl "${config.nessieBaseUrl}/merchants/${live.nessie_merchant_id}?key=$NESSIE_API_KEY"`);
  }
  await db?.end();
}
