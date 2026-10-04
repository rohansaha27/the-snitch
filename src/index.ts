import { startBot, stopBot } from "./bot/spectrum";
import { config } from "./config";
import { db, migrate } from "./db";
import { startPoller } from "./jobs/poller";
import { startWeeklyJob } from "./jobs/weekly";
import { seedMerchants } from "./nessie/seed";
import { app } from "./web/server";

// Last-resort safety net for the demo: log and keep serving instead of dying.
process.on("unhandledRejection", (err) => console.error("[boot] unhandled rejection:", err));
process.on("uncaughtException", (err) => console.error("[boot] uncaught exception:", err));

await migrate();
await seedMerchants();

Bun.serve({ port: config.port, fetch: app.fetch });

console.log(
  `[boot] listening on :${config.port} spectrum=${config.spectrumProvider} nessie=${config.nessieMode} llm=${config.llmMode}${config.demoMode ? " DEMO_MODE" : ""}`,
);

// After the server is up: the terminal provider takes over this TTY with its chat UI.
await startBot();
startPoller();
startWeeklyJob();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    console.log(`[boot] ${signal}, shutting down`);
    await stopBot();
    await db?.end().catch(() => {});
    process.exit(0);
  });
}
