import { startBot } from "./bot/spectrum";
import { config } from "./config";
import { migrate } from "./db";
import { startPoller } from "./jobs/poller";
import { startWeeklyJob } from "./jobs/weekly";
import { seedMerchants } from "./nessie/seed";
import { app } from "./web/server";

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
