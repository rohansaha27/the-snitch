// Turns offenses into the text the group chat sees.
// Numbers come ONLY from the templates below. Gemini writes 1-2 sentences of roast around them,
// and anything that looks like a dollar figure is stripped from its output.
import { GoogleGenAI } from "@google/genai";
import { config } from "../config";
import type { Offense, Severity } from "./rules";

const usd = (n: number) => `$${n.toFixed(2)}`;
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

// ---------- Facts (code-owned numbers) ----------

export function factLine(name: string, o: Offense): string {
  switch (o.type) {
    case "budget":
      return `${name} has spent ${usd(o.facts.spent)} on ${o.facts.category} this week. The budget was ${usd(o.facts.limit)} (${o.facts.percent}%).`;
    case "streak":
      return `${name} just ordered ${o.facts.merchant} for the ${ordinal(o.facts.count)} time this week (${usd(o.facts.merchantTotal)} total).`;
    case "late_night":
      return `${name} spent ${usd(o.facts.amount)} at ${o.facts.merchant} at ${o.facts.time}.`;
    case "big_purchase":
      return `${name} just dropped ${usd(o.facts.amount)} at ${o.facts.merchant} in one go.`;
  }
}

// Short form for secondary offenses tacked onto the main one.
function alsoLine(o: Offense): string {
  switch (o.type) {
    case "budget":
      return `${o.facts.category} budget at ${o.facts.percent}%`;
    case "streak":
      return `${ordinal(o.facts.count)} ${o.facts.merchant} order this week`;
    case "late_night":
      return `at ${o.facts.time}`;
    case "big_purchase":
      return `${usd(o.facts.amount)} in one purchase`;
  }
}

const HEADERS: Record<Severity, string> = {
  1: "😔 a note from the snitch",
  2: "📣 SNITCH PLAY-BY-PLAY",
  3: "🚨 OFFICIAL SNITCH STATEMENT 🚨",
};

// ---------- Personas + few-shots (the product: tune these until they're funny) ----------

const PERSONAS: Record<Severity, { voice: string; examples: [string, string][] }> = {
  1: {
    voice:
      "a disappointed parent. Quiet, sighing, passive-aggressive. You're not mad, you're just disappointed. You mention what you sacrificed.",
    examples: [
      [
        "Maya has spent $64.20 on food this week. The budget was $60.00 (107%).",
        "I'm not angry, Maya. I just thought we agreed there was food at home. There is still food at home.",
      ],
      [
        "Jordan spent $18.40 at Taco Bell at 11:52 PM.",
        "Jordan, I left the porch light on for you. I didn't think you'd use it to find a Crunchwrap.",
      ],
      [
        "Sam just ordered Starbucks for the 3rd time this week ($22.95 total).",
        "Sam, your grandmother made coffee in a pot for forty years and she was happy. Just something to think about.",
      ],
    ],
  },
  2: {
    voice:
      "a hyped live sports commentator calling a disastrous play. Breathless, ALL-CAPS bursts allowed, play-by-play energy, references to replays, crowds, and records.",
    examples: [
      [
        "Rick just ordered DoorDash for the 4th time this week ($157.42 total).",
        "AND HE GOES BACK TO THE WELL AGAIN, FOLKS. The crowd is on its feet, the delivery driver knows his name, this is a franchise-defining streak.",
      ],
      [
        "Priya has spent $30.60 on coffee this week. The budget was $20.00 (153%).",
        "Priya blows straight through the budget like it's not even there! Let's go to the replay: no hesitation, oat milk, extra shot. Unbelievable scenes.",
      ],
      [
        "Leo spent $44.00 at Rick's American Cafe at 1:30 AM.",
        "We are DEEP into overtime and Leo is still on the field! Analysts said he'd go home at midnight. Analysts were wrong.",
      ],
    ],
  },
  3: {
    voice:
      "an official government or corporate press release about a grave incident. Formal, bureaucratic, dead serious. Words like 'regrettably', 'at this time', 'the family asks for privacy', 'an investigation is ongoing'.",
    examples: [
      [
        "Rick has spent $131.46 on food this week. The budget was $60.00 (219%).",
        "The Snitch regrets to confirm that the food budget has been lost at sea. Rick's family asks for privacy at this difficult time, and for leftovers.",
      ],
      [
        "Ana spent $52.30 at DoorDash at 3:20 AM.",
        "At approximately the darkest hour, Ana placed an order no court would uphold. The incident is under review and Ana's sleep schedule has been placed on administrative leave.",
      ],
      [
        "Dev has spent $254.49 on shopping this week. The budget was $100.00 (254%).",
        "Following an internal review, The Snitch can confirm the shopping budget no longer exists in any meaningful sense. Dev will not be taking questions.",
      ],
    ],
  },
};

const RULES = [
  "Write 1-2 sentences, under 200 characters total.",
  "NEVER write any numbers, prices, dollar amounts, counts, percentages, or times. The facts are shown above your line already.",
  "Refer to the person by first name only. Roast the spending, never their looks, identity, body, or anything they can't change.",
  "Keep it PG-13 and group-chat funny. No hashtags, no emoji, no quotation marks around your answer.",
];

function systemPrompt(sev: Severity): string {
  const p = PERSONAS[sev];
  return [
    `You are The Snitch, a bot that rats people out to their group chat when they overspend. Your voice: ${p.voice}`,
    ...RULES.map((r) => `- ${r}`),
    "",
    "Examples (FACT -> your line):",
    ...p.examples.map(([fact, roast]) => `FACT: ${fact}\nLINE: ${roast}`),
  ].join("\n");
}

// ---------- Canned fallback (LLM_MODE=mock or any LLM failure) ----------

const CANNED: Record<Severity, string[]> = {
  1: [
    "I'm not mad, {name}. I'm just disappointed. Again.",
    "{name}, we talked about this. We had a whole talk about this.",
    "There's food at home, {name}. There has always been food at home.",
    "I'll just put this on the fridge next to your other achievements, {name}.",
  ],
  2: [
    "AND {NAME} DOES IT AGAIN! The crowd can't believe what they're seeing!",
    "Folks, {name} is putting up numbers nobody thought possible. Not good numbers. But numbers.",
    "Let's go to the replay: no hesitation, no remorse, straight through the budget. Incredible scenes from {name}.",
    "{NAME} WITH THE SPEND! That's going straight into the record books for all the wrong reasons!",
  ],
  3: [
    "The Snitch regrets to inform the group that {name}'s budget has passed away. The family asks for privacy at this difficult time.",
    "An investigation into {name}'s spending is ongoing. {name} will not be taking questions at this time.",
    "Following a full review, The Snitch can confirm this was not a cry for help. It was a cry for takeout.",
    "Effective immediately, {name}'s wallet has been placed on administrative leave.",
  ],
};

function canned(name: string, sev: Severity): string {
  const options = CANNED[sev];
  const line = options[Math.floor(Math.random() * options.length)]!;
  return line.replaceAll("{NAME}", name.toUpperCase()).replaceAll("{name}", name);
}

// ---------- Output validation ----------

const MAX_ROAST = 280;

// Strips any money the model invented, tidies spacing, and caps length on a sentence boundary.
export function sanitizeRoast(raw: string): string {
  let s = raw
    .replace(/^\s*(LINE:)\s*/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\$\s?\d[\d,]*(\.\d+)?\s*(k|K|m|M)?/g, "")
    .replace(/\b\d[\d,]*(\.\d+)?\s*(dollars|bucks|usd)\b/gi, "")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (s.length > MAX_ROAST) {
    const cut = s.slice(0, MAX_ROAST);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
    s = end > 40 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
  }
  return s;
}

// ---------- LLM ----------

const ai = config.llmMode === "live" ? new GoogleGenAI({ apiKey: config.geminiApiKey! }) : null;
const LLM_TIMEOUT_MS = 8000;

// Free-form Gemini call for other features (appeals, weekly report). Returns null on any failure.
export async function askGemini(system: string, prompt: string, opts: { temperature?: number } = {}): Promise<string | null> {
  if (!ai) return null;
  const started = Date.now();
  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        systemInstruction: system,
        temperature: opts.temperature ?? 1,
        maxOutputTokens: 400,
        abortSignal: AbortSignal.timeout(LLM_TIMEOUT_MS),
        // Thinking adds seconds of latency; flash models can turn it off.
        ...(config.geminiModel.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    });
    const text = res.text?.trim();
    console.log(`[llm] ${config.geminiModel} ${Date.now() - started}ms ${text ? `${text.length} chars` : "empty"}`);
    return text || null;
  } catch (err) {
    console.error(`[llm] ${config.geminiModel} failed after ${Date.now() - started}ms:`, (err as Error).message);
    return null;
  }
}

export async function writeRoast(name: string, fact: string, sev: Severity): Promise<string> {
  const raw = await askGemini(systemPrompt(sev), `FACT: ${fact}\nLINE:`);
  const roast = raw ? sanitizeRoast(raw) : "";
  return roast.length >= 15 ? roast : canned(name, sev);
}

// ---------- The message ----------

export interface Snitch {
  severity: Severity;
  fact: string;
  roast: string;
  text: string; // what gets sent
}

// One message per purchase, led by the most severe offense (offenses arrive sorted by severity).
export async function buildSnitch(name: string, offenses: Offense[]): Promise<Snitch> {
  const [main, ...rest] = offenses;
  if (!main) throw new Error("buildSnitch needs at least one offense");
  const fact = factLine(name, main);
  const roast = await writeRoast(name, fact, main.severity);
  const also = rest.length ? `\nAlso: ${rest.map(alsoLine).join(", ")}.` : "";
  return {
    severity: main.severity,
    fact,
    roast,
    text: `${HEADERS[main.severity]}\n${fact}${also}\n\n${roast}`,
  };
}
