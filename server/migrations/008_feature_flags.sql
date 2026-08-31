-- Admin-controlled feature rollout.
--
-- Two tables rather than one, because they answer different questions and have different
-- lifetimes: feature_flags is the rollout state for everyone, feature_access is the small
-- set of deliberate exceptions. Folding the exceptions into a JSONB column on the flag row
-- would make "which features does this account have" a scan plus a JSON search, and it
-- would lose the per-grant audit columns.
--
-- Neither table is seeded. An absent flag row means released (see DEFAULT_STATUS in
-- server/features.js), so an empty schema is the current behaviour and deploying this
-- migration changes nothing until an admin actually turns something off.
--
-- The feature keys are NOT a foreign key to anything. The catalogue lives in code, where
-- it can carry labels, surfaces and the locked flag, and a key must be storable before an
-- admin has ever configured it. Same reasoning as audit_log.target_user_id, which is
-- deliberately unconstrained so history survives.

CREATE TABLE IF NOT EXISTS feature_flags (
    key        TEXT PRIMARY KEY,

    -- released    visible and usable
    -- coming_soon visible, not usable, labelled as coming
    -- hidden      absent for the customer
    status     TEXT        NOT NULL DEFAULT 'released'
                           CHECK (status IN ('released', 'coming_soon', 'hidden')),

    -- Shown to the admin only. Why this is held back, so the next person to look does not
    -- have to guess.
    note       TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- SET NULL, not CASCADE: the rollout state must outlive the admin who set it,
    -- matching audit_log.actor_user_id.
    updated_by TEXT        REFERENCES users(id) ON DELETE SET NULL
);

COMMENT ON TABLE feature_flags IS
    'Global rollout state per feature key; a missing row means released';

-- ---------------------------------------------------------------------------
-- per-account exceptions
-- ---------------------------------------------------------------------------
-- Keyed on the account that owns the workspace. Plans, quota and seats are all resolved
-- against the workspace, so resolving features per member instead would let one agent see
-- a different product from the colleague sitting next to them.
CREATE TABLE IF NOT EXISTS feature_access (
    user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_key TEXT        NOT NULL,

    -- allow  early access, even while the feature is coming_soon or hidden
    -- deny   withdrawn from this account, even once released
    access      TEXT        NOT NULL CHECK (access IN ('allow', 'deny')),

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by  TEXT        REFERENCES users(id) ON DELETE SET NULL,

    -- One decision per account per feature. The natural key, so a repeated grant updates
    -- rather than duplicating.
    PRIMARY KEY (user_id, feature_key)
);

COMMENT ON TABLE feature_access IS
    'Per-account overrides that beat the global feature_flags status';

-- The hot read is "every override for this account", which the primary key already serves.
-- This one covers the admin console's other direction: who has an exception for this
-- feature.
CREATE INDEX IF NOT EXISTS feature_access_feature_idx
    ON feature_access (feature_key);

-- set_updated_at() is defined in 001_init.sql.
DROP TRIGGER IF EXISTS feature_flags_updated_at ON feature_flags;
CREATE TRIGGER feature_flags_updated_at BEFORE UPDATE ON feature_flags
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS feature_access_updated_at ON feature_access;
CREATE TRIGGER feature_access_updated_at BEFORE UPDATE ON feature_access
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
