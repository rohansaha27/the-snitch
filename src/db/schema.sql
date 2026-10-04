-- Runs on every boot via migrate(). Must stay idempotent.

CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  phone               TEXT,
  dm_space_id         TEXT,
  nessie_customer_id  TEXT,
  nessie_account_id   TEXT,
  swipe_token         TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Merchants seeded into Nessie (`bun run seed`). source = which NESSIE_MODE created the id.
CREATE TABLE IF NOT EXISTS merchants (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  category            TEXT NOT NULL,
  emoji               TEXT,
  default_amount      NUMERIC(10, 2) NOT NULL,
  nessie_merchant_id  TEXT NOT NULL,
  source              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A group chat linked to the user it snitches on (`watch <name>`).
CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  space_id    TEXT NOT NULL UNIQUE,
  name        TEXT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS budgets (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  weekly_limit  NUMERIC(10, 2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, category)
);

-- detected_at is our own timestamp; Nessie purchase_date is date-only.
CREATE TABLE IF NOT EXISTS purchases (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nessie_purchase_id  TEXT UNIQUE,
  merchant_id         TEXT,
  merchant_name       TEXT,
  category            TEXT,
  amount              NUMERIC(10, 2) NOT NULL,
  description         TEXT,
  purchase_date       DATE,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchases_user_detected_idx ON purchases (user_id, detected_at);

-- Nessie purchase ids already processed (swipe page or poller), so nothing is snitched twice.
CREATE TABLE IF NOT EXISTS seen_purchases (
  nessie_purchase_id  TEXT PRIMARY KEY,
  user_id             INTEGER REFERENCES users(id) ON DELETE CASCADE,
  seen_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS offenses (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purchase_id   INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
  trigger_type  TEXT NOT NULL,
  severity      SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 3),
  facts         JSONB NOT NULL DEFAULT '{}'::jsonb,
  roast         TEXT,
  space_id      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Cooldown lookups: latest offense per (user, trigger type).
CREATE INDEX IF NOT EXISTS offenses_cooldown_idx ON offenses (user_id, trigger_type, created_at);

CREATE TABLE IF NOT EXISTS appeals (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offense_id  INTEGER REFERENCES offenses(id) ON DELETE SET NULL,
  excuse      TEXT NOT NULL,
  granted     BOOLEAN NOT NULL DEFAULT false,
  ruling      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One Sunday report per user per week, so restarts don't double-send.
CREATE TABLE IF NOT EXISTS weekly_reports (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS users_phone_idx ON users (phone);
