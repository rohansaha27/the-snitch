// Landing page: the pitch, the number to text (+ QR), and a live Wall of Shame polling /api/wall.
import { config } from "../../config";
import { query } from "../../db";
import { esc, layout, masthead } from "./layout";

export interface Wall {
  feed: { id: number; name: string; severity: number; text: string; at: string }[];
  mostWanted: { name: string; snitches: number }[];
}

// First names only: users.name is just a first name by construction.
export async function wallData(): Promise<Wall> {
  const [feed, mostWanted] = await Promise.all([
    query<{ id: number; name: string; severity: number; roast: string; created_at: Date }>(
      `SELECT o.id, u.name, o.severity, o.roast, o.created_at FROM offenses o JOIN users u ON u.id = o.user_id
       WHERE o.roast IS NOT NULL ORDER BY o.created_at DESC LIMIT 12`,
    ),
    query<{ name: string; snitches: string }>(
      `SELECT u.name, count(*) AS snitches FROM offenses o JOIN users u ON u.id = o.user_id
       WHERE o.roast IS NOT NULL AND o.created_at > now() - interval '7 days'
       GROUP BY u.id, u.name ORDER BY count(*) DESC LIMIT 5`,
    ),
  ]);
  return {
    feed: feed.map((f) => ({ id: f.id, name: f.name, severity: f.severity, text: f.roast, at: new Date(f.created_at).toISOString() })),
    mostWanted: mostWanted.map((m) => ({ name: m.name, snitches: Number(m.snitches) })),
  };
}

function prettyPhone(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length === 11 && d[0] === "1" ? `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}` : p;
}

export function landingPage(wall: Wall): string {
  const phone = config.botPhone;
  // iOS reads &body= (this is an iMessage bot, so iPhones are the target).
  const smsLink = phone ? `sms:${phone}&body=${encodeURIComponent("snitch on me")}` : null;

  const body = `
${masthead("Late edition · Ann Arbor")}
<style>
  .lede { display: grid; gap: 18px; margin: 18px 0 8px; }
  @media (min-width: 640px) { .lede { grid-template-columns: 1.4fr 1fr; align-items: center; } }
  .lede h1 { font-size: clamp(46px, 13vw, 92px); }
  .lede h1 em { font-style: normal; color: var(--red); }
  .lede p { font-size: 18px; line-height: 1.45; margin: 12px 0 0; }
  .cta { border: 4px solid var(--line); background: var(--yellow); box-shadow: 6px 6px 0 var(--line); padding: 16px; text-align: center; }
  .cta .say { font-family: Anton, Impact, sans-serif; text-transform: uppercase; font-size: 22px; }
  .cta .phone { font-family: Anton, Impact, sans-serif; font-size: 34px; display: block; color: var(--ink); text-decoration: none; margin: 4px 0; }
  .cta code { background: var(--ink); color: var(--yellow); padding: 3px 8px; font-size: 18px; font-weight: 800; }
  .cta .btn { display: block; margin-top: 12px; background: var(--ink); color: #fff; text-decoration: none; font-weight: 800; padding: 14px; font-size: 17px; text-transform: uppercase; letter-spacing: .5px; }
  #qr { display: flex; justify-content: center; margin-top: 12px; }
  #qr img, #qr canvas { border: 8px solid #fff; width: 168px; height: 168px; }
  .steps { display: grid; gap: 10px; counter-reset: s; padding: 0; margin: 0; list-style: none; }
  @media (min-width: 640px) { .steps { grid-template-columns: repeat(3, 1fr); } }
  .steps li { border-top: 3px solid var(--line); padding-top: 8px; font-size: 15px; line-height: 1.4; }
  .steps li::before { counter-increment: s; content: counter(s); font-family: Anton, Impact, sans-serif; font-size: 34px; color: var(--red); display: block; }
  .cols { display: grid; gap: 0 24px; }
  @media (min-width: 640px) { .cols { grid-template-columns: 2fr 1fr; } }
  .wanted { list-style: none; padding: 0; margin: 0; }
  .wanted li { display: flex; justify-content: space-between; border-bottom: 2px dashed var(--line); padding: 10px 0; font-family: Anton, Impact, sans-serif; font-size: 22px; text-transform: uppercase; }
  .wanted li b { color: var(--red); font-weight: 400; }
  .live { display: inline-flex; align-items: center; gap: 6px; font-family: Inter, sans-serif; font-size: 12px; font-weight: 800; color: var(--red); vertical-align: middle; margin-left: 8px; }
  .live::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--red); animation: blink 1.2s infinite; }
  @keyframes blink { 50% { opacity: .2; } }
  footer { margin-top: 36px; font-size: 12px; color: var(--muted); border-top: 3px solid var(--line); padding-top: 10px; }
</style>

<section class="lede">
  <div>
    <span class="kicker">Exclusive</span>
    <h1>Overspend? <em>Your friends will know.</em></h1>
    <p>The Snitch watches your card and rats you out to your group chat the moment you blow your budget. Third DoorDash this week? 2am Taco Bell? The whole chat gets the press release.</p>
  </div>
  <div class="cta">
    ${
      phone
        ? `<div class="say">Text</div><a class="phone" href="${esc(smsLink)}">${esc(prettyPhone(phone))}</a><div class="say">and say <code>snitch on me</code></div>
           <a class="btn" href="${esc(smsLink)}">Turn myself in</a><div id="qr"></div>`
        : `<div class="say">Text the bot <code>snitch on me</code></div><p class="muted">Ask us for the number.</p>`
    }
  </div>
</section>

<h2>How it works</h2>
<ol class="steps">
  <li>Text <b>snitch on me</b>. You get a personal card link.</li>
  <li>Add the bot to your group chat and text <b>watch &lt;your name&gt;</b>. Set limits like <b>budget food 40</b>.</li>
  <li>Spend. The bot roasts you in the group, escalating from disappointed parent to official press release.</li>
</ol>

<div class="cols">
  <div>
    <h2>Wall of Shame <span class="live">LIVE</span></h2>
    <div id="feed"></div>
  </div>
  <div>
    <h2>Most Wanted</h2>
    <ol class="wanted" id="wanted"></ol>
  </div>
</div>

<footer>The Snitch · MHacks 2026 · Mock bank data via Capital One Nessie. No real money was judged in the making of this page. Probably.</footer>

${phone ? `<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>try { new QRCode(document.getElementById("qr"), { text: ${JSON.stringify(smsLink)}, width: 336, height: 336, correctLevel: QRCode.CorrectLevel.M }); } catch {}</script>` : ""}
<script>
let wall = ${JSON.stringify(wall).replace(/</g, "\\u003c")};
const seen = new Set(wall.feed.map((f) => f.id));
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ago = (iso) => { const s = (Date.now() - new Date(iso)) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + "m ago" : s < 86400 ? Math.floor(s / 3600) + "h ago" : Math.floor(s / 86400) + "d ago"; };

function render(freshIds = new Set()) {
  const feed = wall.feed.map((f) => {
    const d = el("div", "roast sev-" + f.severity + (freshIds.has(f.id) ? " fresh" : ""));
    const who = el("div", "who");
    who.append(el("span", null, f.name), el("span", "when", ago(f.at)));
    d.append(who, document.createTextNode(f.text));
    return d;
  });
  $("feed").replaceChildren(...(feed.length ? feed : [el("p", "muted", "Nobody's been caught yet. Yet.")]));
  const wanted = wall.mostWanted.map((m) => { const li = el("li"); li.append(el("span", null, m.name), el("b", null, m.snitches + "×")); return li; });
  $("wanted").replaceChildren(...(wanted.length ? wanted : [el("li", "muted", "—")]));
}

setInterval(async () => {
  try {
    const res = await fetch("/api/wall");
    if (!res.ok) return;
    wall = await res.json();
    const fresh = new Set(wall.feed.filter((f) => !seen.has(f.id)).map((f) => f.id));
    fresh.forEach((id) => seen.add(id));
    render(fresh);
  } catch {}
}, 2000);
render();
</script>`;
  return layout("The Snitch", body);
}
