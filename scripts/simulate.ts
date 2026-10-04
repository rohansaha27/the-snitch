// Fires a scripted "terrible week" through the engine and prints every offense.
// No iMessage, no db, no Nessie: everything is in memory, so iterate on thresholds here.
// Usage: bun run simulate
import { config } from "../src/config";
import {
  applyCooldowns,
  detectOffenses,
  formatTime,
  type BudgetInput,
  type LastOffenses,
  type Offense,
  type PurchaseInput,
} from "../src/engine/rules";

const budgets: BudgetInput[] = [
  { category: "food", weeklyLimit: 60 },
  { category: "coffee", weeklyLimit: 20 },
  { category: "nightlife", weeklyLimit: 50 },
  { category: "shopping", weeklyLimit: 100 },
  { category: "transport", weeklyLimit: 40 },
];

const CATEGORY: Record<string, string> = {
  Chipotle: "food", DoorDash: "food", "Taco Bell": "food", Starbucks: "coffee",
  Uber: "transport", Amazon: "shopping", "Rick's American Cafe": "nightlife", Steam: "misc",
};

// Week of Mon 2026-09-28, Detroit time (EDT, UTC-4).
const week: [string, string, number][] = [
  ["2026-09-28T08:10", "Starbucks", 7.65],
  ["2026-09-28T12:30", "Chipotle", 14.85],
  ["2026-09-28T23:40", "DoorDash", 31.2],
  ["2026-09-29T08:05", "Starbucks", 7.65],
  ["2026-09-29T13:00", "Taco Bell", 11.49],
  ["2026-09-29T19:30", "DoorDash", 26.8],
  ["2026-09-30T08:00", "Starbucks", 7.65],
  ["2026-09-30T15:20", "Amazon", 89.99],
  ["2026-10-01T00:45", "DoorDash", 47.12],
  ["2026-10-01T08:10", "Starbucks", 7.65],
  ["2026-10-02T22:15", "Rick's American Cafe", 38],
  ["2026-10-03T01:30", "Rick's American Cafe", 44],
  ["2026-10-03T02:10", "Uber", 23.4],
  ["2026-10-03T14:00", "Amazon", 164.5],
  ["2026-10-04T03:20", "DoorDash", 52.3],
];

const usd = (n: number) => `$${n.toFixed(2)}`;

function describe(o: Offense): string {
  switch (o.type) {
    case "budget": {
      const f = o.facts;
      return `${f.category} budget: ${usd(f.spent)} of ${usd(f.limit)} (${f.percent}%, crossed ${f.threshold}%)`;
    }
    case "streak":
      return `${o.facts.merchant} order #${o.facts.count} this week (${usd(o.facts.merchantTotal)} total)`;
    case "late_night":
      return `${o.facts.merchant} ${usd(o.facts.amount)} at ${o.facts.time}`;
    case "big_purchase":
      return `${o.facts.merchant} ${usd(o.facts.amount)} (over ${usd(o.facts.threshold)})`;
  }
}

const history: PurchaseInput[] = [];
const last: LastOffenses = {};
let snitched = 0;
let suppressed = 0;

console.log(`Simulating a terrible week. cooldown=${config.cooldownMs / 1000}s\n`);

for (const [local, merchantName, amount] of week) {
  const detectedAt = new Date(`${local}:00-04:00`);
  const purchase: PurchaseInput = { merchantName, category: CATEGORY[merchantName] ?? "misc", amount, detectedAt };
  const all = detectOffenses(purchase, history, budgets, detectedAt);
  const fired = applyCooldowns(all, last, detectedAt, config.cooldownMs);

  const day = detectedAt.toLocaleDateString("en-US", { timeZone: "America/Detroit", weekday: "short" });
  console.log(`${day} ${formatTime(detectedAt).padStart(8)}  ${merchantName.padEnd(22)} ${usd(amount).padStart(8)}`);
  if (all.length === 0) console.log("    clean");
  for (const o of all) {
    const ok = fired.includes(o);
    console.log(`    ${ok ? "🚨" : "💤"} sev${o.severity} ${o.type.padEnd(12)} ${describe(o)}${ok ? "" : "  (cooldown)"}`);
    if (ok) {
      snitched++;
      last[o.type] = { at: detectedAt, severity: o.severity };
    } else {
      suppressed++;
    }
  }
  history.push(purchase);
}

const total = history.reduce((s, p) => s + p.amount, 0);
console.log(`\n${history.length} purchases, ${usd(total)} spent, ${snitched} snitches, ${suppressed} suppressed by cooldown`);
