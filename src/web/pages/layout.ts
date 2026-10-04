// Shared HTML shell + tabloid styles for every page.

export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function layout(title: string, body: string, head = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#111">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  :root { --ink: #111; --paper: #fffdf5; --red: #e10600; --yellow: #ffe600; --muted: #6b6b6b; --line: #111; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--paper); color: var(--ink); font-family: Inter, system-ui, sans-serif; -webkit-text-size-adjust: 100%; }
  body { padding: 0 16px 48px; max-width: 760px; margin: 0 auto; }
  .masthead { border-bottom: 6px double var(--line); padding: 14px 0 8px; display: flex; justify-content: space-between; align-items: end; gap: 12px; }
  .masthead .logo { font-family: Anton, Impact, sans-serif; font-size: clamp(40px, 12vw, 84px); line-height: .9; letter-spacing: .5px; text-transform: uppercase; }
  .masthead .logo span { color: var(--red); }
  .masthead .dateline { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; text-align: right; color: var(--muted); }
  .kicker { display: inline-block; background: var(--red); color: #fff; font-weight: 800; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding: 3px 8px; }
  h1, h2 { font-family: Anton, Impact, sans-serif; text-transform: uppercase; font-weight: 400; margin: 0; line-height: 1; }
  h2 { font-size: 28px; margin: 28px 0 10px; border-bottom: 3px solid var(--line); padding-bottom: 4px; }
  .muted { color: var(--muted); }
  .roast { border: 3px solid var(--line); background: #fff; padding: 12px 14px; margin: 10px 0; white-space: pre-wrap; font-size: 15px; line-height: 1.4; box-shadow: 4px 4px 0 var(--line); }
  .roast .who { font-family: Anton, Impact, sans-serif; text-transform: uppercase; font-size: 18px; display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
  .roast .when { font-family: Inter, sans-serif; font-size: 11px; color: var(--muted); text-transform: none; }
  .sev-3 { background: var(--yellow); }
  .sev-2 { background: #fff3c4; }
  .fresh { animation: pop .5s ease-out; }
  @keyframes pop { from { transform: scale(.96); background: var(--red); color: #fff; } }
  .toast { position: fixed; left: 50%; bottom: 24px; transform: translate(-50%, 160%); background: var(--ink); color: var(--yellow); font-family: Anton, Impact, sans-serif; text-transform: uppercase; font-size: 22px; padding: 14px 20px; border: 3px solid var(--yellow); transition: transform .25s; z-index: 10; max-width: calc(100vw - 32px); text-align: center; }
  .toast.show { transform: translate(-50%, 0); }
</style>
${head}
</head>
<body>
${body}
</body>
</html>`;
}

export function masthead(right: string): string {
  const date = new Date().toLocaleDateString("en-US", { timeZone: "America/Detroit", weekday: "long", month: "long", day: "numeric", year: "numeric" });
  return `<header class="masthead"><div class="logo">The <span>Snitch</span></div><div class="dateline">${esc(date)}<br>${right}</div></header>`;
}
