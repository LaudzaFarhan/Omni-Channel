-- Saved customer contacts: the operator's own address book.
--
-- Distinct from `store.contacts`, which is WhatsApp's address book as delivered
-- by Baileys. That lives in sessions/store_<uid>_<sessionId>.json, is recomputed
-- from WhatsApp data on every sync, and is deleted outright by store.clear() on
-- logout — so anything a human typed there would not survive. These rows are the
-- operator's own data and must outlive any WhatsApp session.
--
-- Scoped per USER, not per (user, session). A customer who connects three
-- WhatsApp numbers has one address book, not three: the contact is the person
-- they are selling to, independent of which of their own numbers reached them.
-- The link to a specific conversation is resolved at read time from the session's
-- LID map, so nothing session-shaped is stored here.

CREATE TABLE IF NOT EXISTS contacts (
    id         BIGSERIAL   PRIMARY KEY,
    user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Bare international digits, no '+', matching the form a WhatsApp JID uses
    -- (628123456789). Normalised by normalizePhone() in src/utils/phone.js before
    -- it ever reaches this column, so '0812...' and '+62 812...' collapse to one
    -- row rather than three.
    phone      TEXT        NOT NULL CHECK (phone ~ '^[0-9]{8,15}$'),

    name       TEXT        NOT NULL DEFAULT '',
    email      TEXT,
    company    TEXT,

    -- Free-form labels, e.g. ["new customer","follow up"]. An array rather than a
    -- join table because tags are read with the contact every single time and are
    -- never queried on their own.
    tags       JSONB       NOT NULL DEFAULT '[]'::jsonb,

    note       TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per number per operator. This is also the conflict target for a CSV
-- import, which is what makes re-importing an updated spreadsheet an update
-- rather than a pile of duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS contacts_user_phone_key
    ON contacts (user_id, phone);

-- Filtering the list by tag.
CREATE INDEX IF NOT EXISTS contacts_tags_idx
    ON contacts USING gin (tags);

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  contacts       IS 'Operator-owned address book; survives WhatsApp logout, unlike the Baileys contact store';
COMMENT ON COLUMN contacts.phone IS 'Bare international digits without +, as used by a WhatsApp JID';
COMMENT ON COLUMN contacts.tags  IS 'JSON array of free-form label strings';
