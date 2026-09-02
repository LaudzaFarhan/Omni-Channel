-- Migration 010: API Keys and Customer Webhooks
--
-- Enables customer-side developer integration:
--   1. api_keys: scoped, hashed tokens for calling the WhatsApp UAPI externally.
--   2. webhook_configs: per-workspace destination URL, secret, and event subscriptions.
--   3. webhook_logs: delivery logs, latency, and status inspector.

CREATE TABLE IF NOT EXISTS api_keys (
    id           TEXT PRIMARY KEY,
    user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT        NOT NULL DEFAULT 'API Key',
    key_prefix   TEXT        NOT NULL,
    key_hash     TEXT        NOT NULL UNIQUE,
    scopes       JSONB       NOT NULL DEFAULT '["messages:send", "messages:read", "contacts:sync", "sessions:read", "agent:hold"]'::jsonb,
    last_used_at TIMESTAMPTZ,
    expires_at   TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_keys_user_id_idx ON api_keys (user_id);
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx ON api_keys (key_hash) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- webhook_configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_configs (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    webhook_url TEXT        NOT NULL DEFAULT '',
    secret      TEXT        NOT NULL DEFAULT '',
    events      JSONB       NOT NULL DEFAULT '["message.received", "message.status", "session.status", "agent.hold", "agent.resume"]'::jsonb,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- webhook_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_logs (
    id              BIGSERIAL PRIMARY KEY,
    user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type      TEXT        NOT NULL,
    url             TEXT        NOT NULL,
    payload         JSONB       NOT NULL,
    response_status INTEGER,
    response_body   TEXT,
    latency_ms      INTEGER     NOT NULL DEFAULT 0,
    status          TEXT        NOT NULL DEFAULT 'SUCCESS'
                                CHECK (status IN ('SUCCESS', 'FAILED', 'TIMEOUT')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_logs_user_id_idx ON webhook_logs (user_id, created_at DESC);

-- Triggers for updated_at
DROP TRIGGER IF EXISTS api_keys_updated_at ON api_keys;
CREATE TRIGGER api_keys_updated_at BEFORE UPDATE ON api_keys
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS webhook_configs_updated_at ON webhook_configs;
CREATE TRIGGER webhook_configs_updated_at BEFORE UPDATE ON webhook_configs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
