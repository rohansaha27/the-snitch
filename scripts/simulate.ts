// Fires a scripted "terrible week" through the engine and prints every offense.
// No iMessage, no db, no Nessie: everything is in memory, so iterate on thresholds here.
// Usage: bun run simulate
import { config } from "../src/config";
import { buildSnitch } from "../src/engine/roast";
import { MERCHANTS } from "../src/nessie/seed";
import { DEMO_BUDGETS, TERRIBLE_WEEK } from "./terrible-week";
import {
  addDays,
  applyCooldowns,
  detectOffenses,
  formatTime,
  localTime,
  type BudgetInput,
  type LastOffenses,
  type Offense,
  type PurchaseInput,
} from "../src/engine/rules";

const budgets: BudgetInput[] = Object.entries(DEMO_BUDGETS).map(([category, weeklyLimit]) => ({ category, weeklyLimit }));

const CATEGORY = Object.fromEntries(MERCHANTS.map((m) => [m.name, m.category])) as Record<string, string>;

// Week of Mon 2026-09-28, Detroit time.
const MONDAY = "2026-09-28";

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

console.log(`Simulating a terrible week. cooldown=${config.cooldownMs / 1000}s llm=${config.llmMode}\n`);

for (const [day, hm, merchantName, amount] of TERRIBLE_WEEK) {
  const detectedAt = localTime(addDays(MONDAY, day), hm);
  const purchase: PurchaseInput = { merchantName, category: CATEGORY[merchantName] ?? "misc", amount, detectedAt };
  const all = detectOffenses(purchase, history, budgets, detectedAt);
  const fired = applyCooldowns(all, last, detectedAt, config.cooldownMs);

  const weekday = detectedAt.toLocaleDateString("en-US", { timeZone: "America/Detroit", weekday: "short" });
  console.log(`${weekday} ${formatTime(detectedAt).padStart(8)}  ${merchantName.padEnd(22)} ${usd(amount).padStart(8)}`);
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
  // One message per purchase, exactly as the group chat would see it.
  if (fired.length) {
    const { text } = await buildSnitch("Rick", fired);
    console.log(`\n${text.replace(/^/gm, "      │ ")}\n`);
  }
  history.push(purchase);
}

const total = history.reduce((s, p) => s + p.amount, 0);
console.log(`\n${history.length} purchases, ${usd(total)} spent, ${snitched} snitches, ${suppressed} suppressed by cooldown`);
