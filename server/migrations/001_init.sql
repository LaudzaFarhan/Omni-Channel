-- Initial schema: replaces Firebase Auth + Firestore.
--
-- Mirrors the Firestore document model so the client's expectations are
-- unchanged, with two deliberate differences:
--
--   1. Limit overrides are NULLable columns rather than absent fields. NULL
--      means "inherit from the plan", which is exactly what a missing Firestore
--      field meant. See resolveEffectiveLimits() in src/utils/plans.js.
--
--   2. users.id is TEXT, not a generated UUID. Existing accounts keep their
--      Firebase UID, because Baileys names its credential directories
--      sessions/auth_info_${uid}_${sessionId}. Generating fresh ids would orphan
--      every connected WhatsApp device and force all customers to re-scan.

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
    id            TEXT PRIMARY KEY,
    name          TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    price         BIGINT      NOT NULL DEFAULT 0 CHECK (price >= 0),
    currency      TEXT        NOT NULL DEFAULT 'IDR',
    message_limit INTEGER     NOT NULL DEFAULT 500 CHECK (message_limit >= 0),
    session_limit INTEGER     NOT NULL DEFAULT 1   CHECK (session_limit >= 1),
    trial_days    INTEGER     NOT NULL DEFAULT 0   CHECK (trial_days >= 0),
    features      JSONB       NOT NULL DEFAULT '[]'::jsonb,
    is_default    BOOLEAN     NOT NULL DEFAULT FALSE,
    archived      BOOLEAN     NOT NULL DEFAULT FALSE,
    sort_order    INTEGER     NOT NULL DEFAULT 100,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- At most one signup default. Enforced by the database rather than by the
-- admin UI's batch write, which could otherwise race.
CREATE UNIQUE INDEX IF NOT EXISTS plans_single_default
    ON plans ((is_default)) WHERE is_default;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT        NOT NULL,
    password_hash TEXT,
    name          TEXT        NOT NULL DEFAULT '',
    role          TEXT        NOT NULL DEFAULT 'customer'
                              CHECK (role IN ('customer', 'admin')),
    is_approved   BOOLEAN     NOT NULL DEFAULT FALSE,

    plan_id       TEXT        REFERENCES plans(id) ON DELETE SET NULL,

    -- NULL = inherit from the plan. A number here is an explicit admin override.
    message_limit INTEGER     CHECK (message_limit IS NULL OR message_limit >= 0),
    session_limit INTEGER     CHECK (session_limit IS NULL OR session_limit >= 1),

    messages_sent INTEGER     NOT NULL DEFAULT 0 CHECK (messages_sent >= 0),
    trial_expired BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Set for accounts imported from Firebase: their scrypt hashes cannot be
    -- verified here, so they must set a new password before signing in.
    must_reset_password BOOLEAN NOT NULL DEFAULT FALSE,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- Case-insensitive uniqueness without requiring the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));
CREATE INDEX IF NOT EXISTS users_plan_id_idx  ON users (plan_id);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC);

-- ---------------------------------------------------------------------------
-- refresh_tokens
-- ---------------------------------------------------------------------------
-- Refresh tokens are opaque random strings. Only their SHA-256 hash is stored,
-- so a database leak cannot be replayed as a login. They rotate on every use.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id         BIGSERIAL PRIMARY KEY,
    user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT        NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    user_agent TEXT,
    ip         TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_id_idx ON refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expires_at_idx ON refresh_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
-- Replaces both the Firestore `transactions` collection and the file-backed
-- sessions/transactions.json store.
CREATE TABLE IF NOT EXISTS transactions (
    id          TEXT PRIMARY KEY,
    user_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
    email       TEXT,
    item        TEXT,
    type        TEXT,
    amount      BIGINT      NOT NULL DEFAULT 0,
    currency    TEXT        NOT NULL DEFAULT 'IDR',
    status      TEXT        NOT NULL DEFAULT 'PENDING',
    payment_url TEXT,
    raw         JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON transactions (user_id);
CREATE INDEX IF NOT EXISTS transactions_created_at_idx ON transactions (created_at DESC);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
-- The Firestore setup kept no record of admin actions at all.
CREATE TABLE IF NOT EXISTS audit_log (
    id             BIGSERIAL PRIMARY KEY,
    actor_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
    actor_email    TEXT,
    action         TEXT NOT NULL,
    target_user_id TEXT,
    detail         JSONB,
    ip             TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_target_idx ON audit_log (target_user_id);

-- ---------------------------------------------------------------------------
-- keep updated_at honest
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS plans_updated_at ON plans;
CREATE TRIGGER plans_updated_at BEFORE UPDATE ON plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS transactions_updated_at ON transactions;
CREATE TRIGGER transactions_updated_at BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- seed the default plan catalogue
-- ---------------------------------------------------------------------------
-- Matches FALLBACK_PLANS in src/utils/plans.js. ON CONFLICT DO NOTHING keeps
-- this safe to re-run and never overwrites limits an admin has since edited.
INSERT INTO plans (id, name, description, price, currency, message_limit, session_limit, trial_days, features, is_default, sort_order)
VALUES
    ('free', 'Free',
     'Trial access with a single device and a capped message quota.',
     0, 'IDR', 500, 1, 7,
     '["1 WhatsApp device", "500 outbound messages", "7-day trial window"]'::jsonb,
     TRUE, 0),
    ('premium', 'Premium',
     'Paid tier with multiple devices and a high message quota.',
     299000, 'IDR', 50000, 5, 0,
     '["5 WhatsApp devices", "50,000 outbound messages", "Full chat history", "Priority support"]'::jsonb,
     FALSE, 1)
ON CONFLICT (id) DO NOTHING;
