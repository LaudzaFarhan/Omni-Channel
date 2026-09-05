-- Migration 015: User Presence & Activity Logs
--
-- Tracks historical online, away, and offline intervals for team members
-- so supervisors can monitor time spent in each state across customizable periods.

CREATE TABLE IF NOT EXISTS user_presence_logs (
    id               BIGSERIAL PRIMARY KEY,
    workspace_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status           TEXT NOT NULL CHECK (status IN ('online', 'away', 'off')),
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at         TIMESTAMPTZ,
    duration_seconds INTEGER DEFAULT 0,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_presence_logs_user_range 
    ON user_presence_logs (workspace_id, user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_presence_logs_workspace_range 
    ON user_presence_logs (workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_presence_logs_open 
    ON user_presence_logs (workspace_id, user_id) WHERE ended_at IS NULL;
