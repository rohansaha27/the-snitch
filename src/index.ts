import { startBot } from "./bot/spectrum";
import { config } from "./config";
import { migrate } from "./db";
import { app } from "./web/server";

await migrate();

Bun.serve({ port: config.port, fetch: app.fetch });

console.log(
  `[boot] listening on :${config.port} spectrum=${config.spectrumProvider} nessie=${config.nessieMode} llm=${config.llmMode}${config.demoMode ? " DEMO_MODE" : ""}`,
);

// After the server is up: the terminal provider takes over this TTY with its chat UI.
await startBot();
