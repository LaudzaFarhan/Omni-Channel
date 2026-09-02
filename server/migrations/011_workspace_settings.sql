-- Migration 011: Workspace & General Settings
--
-- Persists workspace-level automation, SLA, business hours, and security settings.

CREATE TABLE IF NOT EXISTS workspace_settings (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    settings   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS workspace_settings_updated_at ON workspace_settings;
CREATE TRIGGER workspace_settings_updated_at BEFORE UPDATE ON workspace_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
