// Weekly report: on demand via `report`, and automatically Sundays 6pm America/Detroit.
import { sendToSpace } from "../bot/spectrum";
import { query } from "../db";
import { targetSpaces } from "../engine/process";
import { askGemini, sanitizeRoast } from "../engine/roast";
import { CATEGORY_EMOJI, isThisWeek, TZ, weekStart } from "../engine/rules";

const usd = (n: number) => `$${n.toFixed(2)}`;

const CANNED = [
  "In a week defined by bold choices, none were financially sound. The Snitch will continue to monitor the situation.",
  "Sources close to the wallet describe the week as 'a lot.' The wallet has declined to comment further.",
  "Historians will study this week. Not kindly, but they will study it.",
];

const SYSTEM = [
  "You are The Snitch, writing the closing line of a weekly tabloid exposé about a friend's spending, read aloud in their group chat.",
  "Write 2 sentences, under 240 characters. Dramatic tabloid voice. Roast the habits shown in the facts.",
  "NEVER write any numbers, prices, dollar amounts, counts, percentages, or times.",
  "First name only. Roast the spending, never the person's looks or identity. PG-13. No hashtags, no emoji.",
].join("\n");

export async function buildWeeklyReport(userId: number, now = new Date()): Promise<string> {
  const [user] = await query<{ name: string }>("SELECT name FROM users WHERE id = $1", [userId]);
  const name = user?.name ?? "Someone";

  const purchases = (
    await query<{ merchant_name: string; category: string; amount: string; detected_at: Date }>(
      `SELECT merchant_name, category, amount, detected_at FROM purchases
       WHERE user_id = $1 AND detected_at > now() - interval '8 days'`,
      [userId],
    )
  )
    .map((p) => ({ merchant: p.merchant_name, category: p.category, amount: Number(p.amount), at: new Date(p.detected_at) }))
    .filter((p) => isThisWeek(p.at, now));

  if (!purchases.length) {
    return `📰 THE WEEKLY SNITCH: ${name}\nNo purchases this week. Either ${name} has changed, or ${name} found a card we don't know about.`;
  }

  const budgets = new Map(
    (await query<{ category: string; weekly_limit: string }>("SELECT category, weekly_limit FROM budgets WHERE user_id = $1", [userId]))
      .map((b) => [b.category, Number(b.weekly_limit)]),
  );
  const [snitches] = await query<{ n: string }>(
    "SELECT count(DISTINCT purchase_id) AS n FROM offenses WHERE user_id = $1 AND created_at > now() - interval '8 days' AND created_at >= $2::date",
    [userId, weekStart(now)],
  );

  const total = purchases.reduce((s, p) => s + p.amount, 0);
  const byCategory = new Map<string, number>();
  const byMerchant = new Map<string, { n: number; total: number }>();
  for (const p of purchases) {
    byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + p.amount);
    const m = byMerchant.get(p.merchant) ?? { n: 0, total: 0 };
    byMerchant.set(p.merchant, { n: m.n + 1, total: m.total + p.amount });
  }
  const lateNight = purchases.filter((p) => {
    const h = Number(p.at.toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }));
    return h >= 23 || h < 4;
  }).length;
  const [topMerchant, top] = [...byMerchant.entries()].sort((a, b) => b[1].n - a[1].n || b[1].total - a[1].total)[0]!;

  const categoryLines = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, spent]) => {
      const limit = budgets.get(cat);
      const budget = limit ? ` / ${usd(limit)} (${Math.round((spent / limit) * 100)}%)${spent > limit ? " ❌" : ""}` : "";
      return `${CATEGORY_EMOJI[cat] ?? "💸"} ${cat} ${usd(spent)}${budget}`;
    });

  const facts = [
    `${name} spent ${usd(total)} across ${purchases.length} purchases this week.`,
    ...categoryLines,
    `Most visited: ${topMerchant} (${top.n}×, ${usd(top.total)})`,
    `Late-night purchases: ${lateNight}`,
    `Times snitched: ${Number(snitches?.n ?? 0)}`,
  ];

  const raw = await askGemini(SYSTEM, `FACTS:\n${facts.join("\n")}\nCLOSING LINE:`);
  const closing = raw ? sanitizeRoast(raw) : "";
  return `📰 THE WEEKLY SNITCH: ${name}\n${facts.join("\n")}\n\n${closing.length >= 15 ? closing : CANNED[Math.floor(Math.random() * CANNED.length)]}`;
}

async function sendScheduledReports(now: Date): Promise<void> {
  const week = weekStart(now);
  const users = await query<{ id: number }>(
    `SELECT u.id FROM users u WHERE NOT EXISTS
       (SELECT 1 FROM weekly_reports w WHERE w.user_id = u.id AND w.week_start = $1)`,
    [week],
  );
  for (const u of users) {
    // Claim first so a crash mid-send can't double-post on restart.
    await query("INSERT INTO weekly_reports (user_id, week_start) VALUES ($1, $2) ON CONFLICT DO NOTHING", [u.id, week]);
    const spaces = await targetSpaces(u.id);
    if (!spaces.length) continue;
    const text = await buildWeeklyReport(u.id, now);
    for (const s of spaces) await sendToSpace(s, text);
    console.log(`[weekly] sent report user=${u.id}`);
  }
}

// Checks every minute; fires during Sunday 6pm local.
export function startWeeklyJob(): void {
  const tick = async () => {
    const now = new Date();
    const local = now.toLocaleString("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", hourCycle: "h23" });
    if (!/^Sun\b/.test(local) || !/\b18$/.test(local)) return;
    try {
      await sendScheduledReports(now);
    } catch (err) {
      console.error("[weekly] scheduled report failed:", (err as Error).message);
    }
  };
  setInterval(tick, 60_000);
  console.log("[weekly] scheduled for Sundays 6pm America/Detroit");
}
