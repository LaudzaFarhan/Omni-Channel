-- Per-conversation settings, currently just the "hold the agent" flag.
--
-- Holding a chat means automated replies are suppressed for that one
-- conversation while a human takes over. It is deliberately per (user, session,
-- chat) rather than per user: an operator steps into one customer's thread while
-- automation keeps handling everyone else.
--
-- A row exists only once a chat has been touched, so absence means "not held".
-- That keeps the table proportional to the number of conversations an operator
-- has actually intervened in rather than to every chat ever synced.

CREATE TABLE IF NOT EXISTS chat_settings (
    user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT        NOT NULL,
    chat_jid   TEXT        NOT NULL,

    bot_paused BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Who held it and when, so a thread left on hold overnight can be traced.
    paused_at  TIMESTAMPTZ,
    paused_by  TEXT,

    -- Free-text reason an operator can leave for colleagues.
    note       TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (user_id, session_id, chat_jid)
);

-- The hot query is "which chats in this session are on hold", used to badge the
-- chat list, so index the paused rows only.
CREATE INDEX IF NOT EXISTS chat_settings_paused_idx
    ON chat_settings (user_id, session_id) WHERE bot_paused;

DROP TRIGGER IF EXISTS chat_settings_updated_at ON chat_settings;
CREATE TRIGGER chat_settings_updated_at BEFORE UPDATE ON chat_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
