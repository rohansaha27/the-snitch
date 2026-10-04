// Personal swipe panel: tap a merchant to "spend", watch the budget bars fill, read your roasts.
// The page renders from one JSON state blob (inline on load, then refreshed after taps and every few seconds).
import { query } from "../../db";
import { CATEGORY_EMOJI, isThisWeek } from "../../engine/rules";
import { esc, layout, masthead } from "./layout";

export type SwipeUser = { id: number; name: string; swipe_token: string; nessie_account_id: string | null };

export interface SwipeState {
  name: string;
  total: number;
  categories: { category: string; emoji: string; spent: number; limit: number | null }[];
  roasts: { id: number; text: string; severity: number; at: string }[];
  merchants: { id: number; name: string; emoji: string; amount: number; category: string }[];
}

export async function swipeState(user: SwipeUser): Promise<SwipeState> {
  const now = new Date();
  const [purchases, budgets, roasts, merchants] = await Promise.all([
    query<{ category: string; amount: string; detected_at: Date }>(
      "SELECT category, amount, detected_at FROM purchases WHERE user_id = $1 AND detected_at > now() - interval '8 days'",
      [user.id],
    ),
    query<{ category: string; weekly_limit: string }>("SELECT category, weekly_limit FROM budgets WHERE user_id = $1", [user.id]),
    query<{ id: number; roast: string; severity: number; created_at: Date }>(
      "SELECT id, roast, severity, created_at FROM offenses WHERE user_id = $1 AND roast IS NOT NULL ORDER BY created_at DESC LIMIT 5",
      [user.id],
    ),
    query<{ id: number; name: string; emoji: string | null; default_amount: string; category: string }>(
      "SELECT id, name, emoji, default_amount, category FROM merchants ORDER BY id",
    ),
  ]);

  const spent = new Map<string, number>();
  let total = 0;
  for (const p of purchases) {
    if (!isThisWeek(new Date(p.detected_at), now)) continue;
    spent.set(p.category, (spent.get(p.category) ?? 0) + Number(p.amount));
    total += Number(p.amount);
  }
  const limits = new Map(budgets.map((b) => [b.category, Number(b.weekly_limit)]));
  const categories = Object.keys(CATEGORY_EMOJI)
    .filter((c) => limits.has(c) || spent.has(c))
    .map((c) => ({ category: c, emoji: CATEGORY_EMOJI[c]!, spent: Math.round((spent.get(c) ?? 0) * 100) / 100, limit: limits.get(c) ?? null }));

  return {
    name: user.name,
    total: Math.round(total * 100) / 100,
    categories,
    roasts: roasts.map((r) => ({ id: r.id, text: r.roast, severity: r.severity, at: new Date(r.created_at).toISOString() })),
    merchants: merchants.map((m) => ({ id: m.id, name: m.name, emoji: m.emoji ?? "💳", amount: Number(m.default_amount), category: m.category })),
  };
}

export function swipePage(token: string, state: SwipeState): string {
  const body = `
${masthead(`Exhibit A: ${esc(state.name)}'s card`)}
<style>
  .hero { margin: 16px 0 6px; display: flex; justify-content: space-between; align-items: end; gap: 12px; }
  .hero h1 { font-size: clamp(34px, 9vw, 54px); }
  .total { font-family: Anton, Impact, sans-serif; font-size: 34px; color: var(--red); white-space: nowrap; }
  .total small { display: block; font-family: Inter, sans-serif; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; text-align: right; }
  .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  @media (min-width: 560px) { .grid { grid-template-columns: repeat(4, 1fr); } }
  .m { appearance: none; border: 3px solid var(--line); background: #fff; box-shadow: 4px 4px 0 var(--line); padding: 14px 8px 12px; min-height: 112px; font: inherit; color: inherit; cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
  .m:active { transform: translate(3px, 3px); box-shadow: 1px 1px 0 var(--line); }
  .m[disabled] { opacity: .5; }
  .m .e { font-size: 34px; line-height: 1; }
  .m .n { font-weight: 800; font-size: 14px; text-align: center; }
  .m .a { font-family: Anton, Impact, sans-serif; font-size: 20px; color: var(--red); }
  .late { display: flex; align-items: center; gap: 10px; margin: 14px 0 0; font-weight: 600; font-size: 14px; user-select: none; }
  .late input { width: 22px; height: 22px; accent-color: var(--red); }
  .bar { margin: 10px 0; }
  .bar .row { display: flex; justify-content: space-between; font-weight: 600; font-size: 14px; margin-bottom: 4px; gap: 8px; }
  .bar .track { height: 18px; border: 3px solid var(--line); background: #fff; position: relative; overflow: hidden; }
  .bar .fill { height: 100%; background: var(--ink); transition: width .4s; }
  .bar.over .fill { background: var(--red); }
  .bar.over .row b { color: var(--red); }
</style>

<section class="hero">
  <div><span class="kicker">Under surveillance</span><h1>${esc(state.name)}'s card</h1></div>
  <div class="total" id="total"></div>
</section>
<p class="muted">Tap a merchant to "buy" it. The Snitch sees everything.</p>

<div class="grid" id="merchants"></div>
<label class="late"><input type="checkbox" id="late"> 🌙 Pretend it's 2am</label>

<h2>This week vs. budget</h2>
<div id="bars"></div>

<h2>Your rap sheet</h2>
<div id="roasts"></div>

<div class="toast" id="toast"></div>

<script>
const TOKEN = ${JSON.stringify(token)};
let state = ${JSON.stringify(state).replace(/</g, "\\u003c")};
let lastRoastId = state.roasts[0]?.id ?? 0;
const $ = (id) => document.getElementById(id);
const usd = (n) => "$" + n.toFixed(2);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago"; };

function render(freshId) {
  $("total").replaceChildren(document.createTextNode(usd(state.total)), el("small", null, "spent this week"));

  if (!$("merchants").children.length) {
    for (const m of state.merchants) {
      const b = el("button", "m");
      b.append(el("span", "e", m.emoji), el("span", "n", m.name), el("span", "a", usd(m.amount)));
      b.onclick = () => swipe(m, b);
      $("merchants").append(b);
    }
  }

  const bars = state.categories.map((c) => {
    const pct = c.limit ? (c.spent / c.limit) * 100 : 0;
    const d = el("div", "bar" + (c.limit && c.spent > c.limit ? " over" : ""));
    const row = el("div", "row");
    row.append(el("span", null, c.emoji + " " + c.category), el("b", null, c.limit ? usd(c.spent) + " / " + usd(c.limit) + " (" + Math.round(pct) + "%)" : usd(c.spent) + " · no budget"));
    const track = el("div", "track"), fill = el("div", "fill");
    fill.style.width = (c.limit ? Math.min(pct, 100) : 0) + "%";
    track.append(fill);
    d.append(row, track);
    return d;
  });
  $("bars").replaceChildren(...(bars.length ? bars : [el("p", "muted", "No budgets yet. Text the bot: budget food 40")]));

  const roasts = state.roasts.map((r) => {
    const d = el("div", "roast sev-" + r.severity + (r.id === freshId ? " fresh" : ""));
    const who = el("div", "who");
    who.append(el("span", null, ["", "Noted", "Called out", "Official statement"][r.severity]), el("span", "when", ago(r.at)));
    d.append(who, document.createTextNode(r.text));
    return d;
  });
  $("roasts").replaceChildren(...(roasts.length ? roasts : [el("p", "muted", "Clean record. Suspicious.")]));
}

let toastTimer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2600);
}

function apply(next) {
  state = next;
  const top = state.roasts[0]?.id ?? 0;
  const fresh = top > lastRoastId ? top : undefined;
  lastRoastId = Math.max(lastRoastId, top);
  render(fresh);
}

async function swipe(m, btn) {
  btn.disabled = true;
  try {
    const res = await fetch(location.pathname, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId: m.id, lateNight: $("late").checked }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "failed");
    if (navigator.vibrate) navigator.vibrate(data.status === "snitched" ? [60, 40, 120] : 30);
    toast(data.status === "snitched" ? "🐀 The snitch has been notified" : usd(m.amount) + " at " + m.name + ". Clean… for now");
    apply(data.state);
  } catch (e) {
    toast("Card declined (by the server). Try again");
  } finally {
    btn.disabled = false;
  }
}

// Catch purchases the poller processed (made outside this page).
setInterval(async () => {
  try {
    const res = await fetch(location.pathname + "/state");
    if (res.ok) apply(await res.json());
  } catch {}
}, 4000);

render();
</script>`;
  return layout(`${state.name}'s card · The Snitch`, body);
}
