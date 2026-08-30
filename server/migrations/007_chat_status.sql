-- Where a conversation stands commercially: is this still a prospect, did it close,
-- or is it not a sales conversation at all.
--
-- chat_settings already exists per (user, session, chat) for the agent-hold flag, and
-- this is the same shape — one row per conversation an operator has acted on — so it
-- goes there rather than into a table of its own.
--
-- Deliberately a flat status rather than a pipeline of named stages. A configurable
-- stage list is a bigger feature (it needs its own table, ordering, per-workspace
-- customisation and a board view); this is the three states the chat menu actually
-- offers, and a stage table can migrate from it later by treating these as the first
-- three stages.
--
--   prospect    the default for any conversation once it is touched. An open lead.
--   closed_won  it converted.
--   dropped     explicitly removed from the prospect list. Not a lead, not a loss —
--               a supplier, a wrong number, a colleague.
--
-- NULL means untouched, which reads as "prospect" everywhere. Storing the default
-- explicitly would mean writing a row for every chat that has ever synced, and
-- chat_settings is deliberately proportional to what an operator has intervened in.

ALTER TABLE chat_settings
    ADD COLUMN IF NOT EXISTS status TEXT
        CHECK (status IS NULL OR status IN ('prospect', 'closed_won', 'dropped')),

    -- Who moved it and when, for the same reason paused_by exists: with a team
    -- sharing one account, "someone marked this won" is not useful on its own.
    ADD COLUMN IF NOT EXISTS status_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS status_by TEXT;

COMMENT ON COLUMN chat_settings.status IS
    'Commercial state of the conversation; NULL is equivalent to prospect';

-- The hot query is "show me the won deals in this session", for a pipeline count or a
-- filtered chat list. Indexed only where a status has actually been set.
CREATE INDEX IF NOT EXISTS chat_settings_status_idx
    ON chat_settings (user_id, session_id, status) WHERE status IS NOT NULL;
