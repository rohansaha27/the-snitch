import { Hono } from "hono";
import { config } from "../config";
import { dbStatus } from "../db";

export const app = new Hono();

app.get("/healthz", (c) =>
  c.json({
    ok: true,
    db: dbStatus,
    modes: {
      spectrum: config.spectrumProvider,
      nessie: config.nessieMode,
      llm: config.llmMode,
    },
  }),
);
