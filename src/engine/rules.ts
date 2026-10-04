// Deterministic offense detection. Pure: no db, no clock, no network.
// Rules decide WHETHER to snitch and with what exact numbers; the LLM only decides how.

export type TriggerType = "budget" | "streak" | "late_night" | "big_purchase";
export type Severity = 1 | 2 | 3;

export interface PurchaseInput {
  merchantName: string;
  category: string;
  amount: number;
  detectedAt: Date;
}

export interface BudgetInput {
  category: string;
  weeklyLimit: number;
}

export type Offense =
  | { type: "budget"; severity: Severity; facts: { category: string; spent: number; limit: number; percent: number; threshold: number } }
  | { type: "streak"; severity: Severity; facts: { merchant: string; count: number; merchantTotal: number } }
  | { type: "late_night"; severity: Severity; facts: { merchant: string; amount: number; time: string } }
  | { type: "big_purchase"; severity: Severity; facts: { merchant: string; amount: number; threshold: number } };

// Last snitch per trigger type, for cooldowns.
export type LastOffenses = Partial<Record<TriggerType, { at: Date; severity: Severity }>>;

export const TZ = "America/Detroit";

// Budget thresholds as a fraction of the weekly limit -> severity.
export const BUDGET_THRESHOLDS: [number, Severity][] = [[1, 1], [1.5, 2], [2, 3]];
// Single purchase amount -> severity.
export const BIG_PURCHASE_THRESHOLDS: [number, Severity][] = [[75, 1], [150, 2], [300, 3]];
// Nth order at the same merchant this week -> severity.
export const STREAK_THRESHOLDS: [number, Severity][] = [[3, 1], [4, 2], [5, 3]];
// Local hour (11pm-4am) -> severity. The later it gets, the worse it looks.
export const LATE_NIGHT_HOURS: Record<number, Severity> = { 23: 1, 0: 1, 1: 2, 2: 2, 3: 3 };

const round2 = (n: number) => Math.round(n * 100) / 100;

// Highest severity whose threshold `value` meets, or null.
function tier(value: number, thresholds: [number, Severity][]): { threshold: number; severity: Severity } | null {
  let hit: { threshold: number; severity: Severity } | null = null;
  for (const [threshold, severity] of thresholds) if (value >= threshold) hit = { threshold, severity };
  return hit;
}

function localParts(d: Date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday!),
  };
}

// Local YYYY-MM-DD of the Monday that starts `now`'s week.
export function weekStart(now: Date): string {
  const { date, weekday } = localParts(now);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
}

export function isThisWeek(d: Date, now: Date): boolean {
  return localParts(d).date >= weekStart(now) && d.getTime() <= now.getTime();
}

export function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
}

// `history` is the user's earlier purchases (any range; filtered to this week here), not including `purchase`.
export function detectOffenses(
  purchase: PurchaseInput,
  history: PurchaseInput[],
  budgets: BudgetInput[],
  now: Date,
): Offense[] {
  const week = history.filter((p) => isThisWeek(p.detectedAt, now));
  const offenses: Offense[] = [];

  // Budget: only fires on the purchase that crosses a threshold, so each tier is snitched once.
  const budget = budgets.find((b) => b.category === purchase.category);
  if (budget && budget.weeklyLimit > 0) {
    const before = week.filter((p) => p.category === purchase.category).reduce((s, p) => s + p.amount, 0);
    const after = before + purchase.amount;
    const crossed = tier(after / budget.weeklyLimit, BUDGET_THRESHOLDS);
    if (crossed && before / budget.weeklyLimit < crossed.threshold) {
      offenses.push({
        type: "budget",
        severity: crossed.severity,
        facts: {
          category: purchase.category,
          spent: round2(after),
          limit: round2(budget.weeklyLimit),
          percent: Math.round((after / budget.weeklyLimit) * 100),
          threshold: Math.round(crossed.threshold * 100),
        },
      });
    }
  }

  // Streak: 3rd+ order at the same merchant this week.
  const sameMerchant = week.filter((p) => p.merchantName === purchase.merchantName);
  const count = sameMerchant.length + 1;
  const streak = tier(count, STREAK_THRESHOLDS);
  if (streak) {
    offenses.push({
      type: "streak",
      severity: streak.severity,
      facts: {
        merchant: purchase.merchantName,
        count,
        merchantTotal: round2(sameMerchant.reduce((s, p) => s + p.amount, 0) + purchase.amount),
      },
    });
  }

  // Late night: uses our own detected_at, since Nessie purchase_date has no time.
  const { hour } = localParts(purchase.detectedAt);
  const lateSeverity = LATE_NIGHT_HOURS[hour];
  if (lateSeverity) {
    offenses.push({
      type: "late_night",
      severity: lateSeverity,
      facts: { merchant: purchase.merchantName, amount: round2(purchase.amount), time: formatTime(purchase.detectedAt) },
    });
  }

  const big = tier(purchase.amount, BIG_PURCHASE_THRESHOLDS);
  if (big) {
    offenses.push({
      type: "big_purchase",
      severity: big.severity,
      facts: { merchant: purchase.merchantName, amount: round2(purchase.amount), threshold: big.threshold },
    });
  }

  return offenses.sort((a, b) => b.severity - a.severity);
}

// Drops offenses whose trigger type snitched within `cooldownMs`, unless this one is more severe
// (escalation always gets through).
export function applyCooldowns(offenses: Offense[], last: LastOffenses, now: Date, cooldownMs: number): Offense[] {
  return offenses.filter((o) => {
    const prev = last[o.type];
    if (!prev) return true;
    if (now.getTime() - prev.at.getTime() >= cooldownMs) return true;
    return o.severity > prev.severity;
  });
}
