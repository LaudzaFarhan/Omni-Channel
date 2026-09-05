-- Migration 014: System Announcement Verifications
--
-- Tracks users who have confirmed and verified system updates ("Sudah Verify").

CREATE TABLE IF NOT EXISTS system_announcement_verifications (
    id              SERIAL PRIMARY KEY,
    announcement_id TEXT NOT NULL DEFAULT 'current',
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    name            TEXT,
    verified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_agent      TEXT,
    CONSTRAINT unique_announcement_user UNIQUE (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_verifications_ann_id ON system_announcement_verifications(announcement_id);
