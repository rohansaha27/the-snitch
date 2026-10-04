// Env parsing + mode flags. Everything defaults to mock so the app always boots.
// Bun loads .env automatically.

const env = process.env;

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  console.warn(`[config] ${name}=${raw} is not one of ${allowed.join("|")}, using ${fallback}`);
  return fallback;
}

function int(name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n > 0) return n;
  console.warn(`[config] ${name}=${raw} is not a positive integer, using ${fallback}`);
  return fallback;
}

function bool(name: string): boolean {
  const raw = env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function str(name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

// Live mode without its secrets falls back to mock instead of crashing.
function requireSecrets<T extends string>(mode: T, live: T, mock: T, label: string, secrets: Record<string, string | undefined>): T {
  if (mode !== live) return mode;
  const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length === 0) return mode;
  console.warn(`[config] ${label}=${live} but missing ${missing.join(", ")}, falling back to ${mock}`);
  return mock;
}

const port = int("PORT", 3000);

// SPECTRUM_* is what the Photon docs use; PHOTON_* kept as an alias.
const photonProjectId = str("SPECTRUM_PROJECT_ID") ?? str("PHOTON_PROJECT_ID");
const photonProjectSecret = str("SPECTRUM_PROJECT_SECRET") ?? str("PHOTON_PROJECT_SECRET");
const nessieApiKey = str("NESSIE_API_KEY");
const geminiApiKey = str("GEMINI_API_KEY");

const spectrumProvider = requireSecrets(
  oneOf("SPECTRUM_PROVIDER", ["terminal", "imessage"] as const, "terminal"),
  "imessage", "terminal", "SPECTRUM_PROVIDER",
  { SPECTRUM_PROJECT_ID: photonProjectId, SPECTRUM_PROJECT_SECRET: photonProjectSecret },
);
const nessieMode = requireSecrets(
  oneOf("NESSIE_MODE", ["mock", "live"] as const, "mock"),
  "live", "mock", "NESSIE_MODE",
  { NESSIE_API_KEY: nessieApiKey },
);
const llmMode = requireSecrets(
  oneOf("LLM_MODE", ["mock", "live"] as const, "mock"),
  "live", "mock", "LLM_MODE",
  { GEMINI_API_KEY: geminiApiKey },
);

const demoAdminSecret = str("DEMO_ADMIN_SECRET") ?? "changeme";
if (demoAdminSecret === "changeme") {
  console.warn("[config] DEMO_ADMIN_SECRET not set, using 'changeme'");
}

export const config = Object.freeze({
  port,
  publicUrl: (str("PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/$/, ""),
  databaseUrl: str("DATABASE_URL"),

  spectrumProvider,
  // The iMessage line people text, shown on the landing page (e.g. +15551234567).
  botPhone: str("BOT_PHONE"),
  photonProjectId,
  photonProjectSecret,

  nessieMode,
  nessieApiKey,
  // Plain http:// to Nessie times out on some networks; https works.
  nessieBaseUrl: (str("NESSIE_BASE_URL") ?? "https://api.nessieisreal.com").replace(/\/$/, ""),

  llmMode,
  geminiApiKey,
  geminiModel: str("GEMINI_MODEL") ?? "gemini-2.5-flash",

  pollIntervalMs: int("POLL_INTERVAL_MS", 5000),
  demoMode: bool("DEMO_MODE"),
  // Max one snitch per (user, trigger type) per window. DEMO_MODE shortens it for live demos.
  cooldownMs: bool("DEMO_MODE") ? 30_000 : 60 * 60_000,
  demoAdminSecret,
});

export type Config = typeof config;
