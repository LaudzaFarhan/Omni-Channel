-- Migration 013: System Announcements / Broadcasts
--
-- Stores system-wide broadcast notifications (such as mandatory update alerts,
-- hard-refresh instructions, and maintenance banners).

CREATE TABLE IF NOT EXISTS system_announcements (
    id            TEXT PRIMARY KEY DEFAULT 'current',
    active        BOOLEAN NOT NULL DEFAULT TRUE,
    title         TEXT NOT NULL,
    message       TEXT NOT NULL,
    force_relogin BOOLEAN NOT NULL DEFAULT TRUE,
    version       TEXT,
    created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS system_announcements_updated_at ON system_announcements;
CREATE TRIGGER system_announcements_updated_at BEFORE UPDATE ON system_announcements
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
