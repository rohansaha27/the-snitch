// processPurchase(): rules -> roast -> send -> record. (Phase 4 fills in the pipeline.)
import { query } from "../db";
import type { LastOffenses, Severity, TriggerType } from "./rules";

// Most recent offense per trigger type for a user, for applyCooldowns().
export async function loadLastOffenses(userId: number): Promise<LastOffenses> {
  const rows = await query<{ trigger_type: TriggerType; severity: number; created_at: Date }>(
    `SELECT DISTINCT ON (trigger_type) trigger_type, severity, created_at
     FROM offenses WHERE user_id = $1 ORDER BY trigger_type, created_at DESC`,
    [userId],
  );
  const last: LastOffenses = {};
  for (const r of rows) last[r.trigger_type] = { at: new Date(r.created_at), severity: r.severity as Severity };
  return last;
}
