-- Team seats: several people signing in to ONE account.
--
-- Until now a `users` row was simultaneously a person and a tenant. An agent slot
-- meant a concurrent browser connection, so buying three agents bought three tabs
-- rather than three colleagues. A supervisor now invites email addresses, and
-- those people sign in with their own credentials but work inside the
-- supervisor's account: the same WhatsApp sessions, chats, contacts and message
-- quota.
--
-- The mechanism is one nullable self-reference. A row with owner_user_id IS NULL
-- is a supervisor and owns a workspace; a row with it set is a member of that
-- workspace. Everything server-side then scopes on a derived
--
--     workspaceId = owner_user_id ?? id
--
-- rather than on the caller's own id. Two things fall out of that choice:
--
--   * No data migration. Existing accounts get NULL, so their workspace id is
--     their own id, which is exactly what every existing row and every
--     sessions/auth_info_<uid>_<sessionId> directory is already keyed by. Nothing
--     has to be rewritten and no device has to be re-paired.
--   * A member id never enters a filesystem path, because paths are built from
--     the workspace id. That keeps restoreSessionsOnBoot's "split on the first
--     underscore" parse valid.
--
-- Deliberately ONE level deep: a member cannot have members. There is no clean
-- CHECK for that (it needs a lookup on another row), so it is enforced in
-- routes-team.js, which refuses to invite unless the caller is a supervisor.

ALTER TABLE users
    -- CASCADE, not SET NULL. A member has no meaning without its workspace, and
    -- SET NULL would silently promote them into an empty tenant of their own
    -- while the supervisor's session directories were orphaned.
    ADD COLUMN IF NOT EXISTS owner_user_id TEXT
        REFERENCES users(id) ON DELETE CASCADE;

-- Every members query filters on this, and the seat check runs on every invite.
CREATE INDEX IF NOT EXISTS users_owner_user_id_idx
    ON users (owner_user_id) WHERE owner_user_id IS NOT NULL;

COMMENT ON COLUMN users.owner_user_id IS
    'NULL = supervisor owning a workspace; set = member of that supervisor''s workspace';


-- Pending invitations.
--
-- The project has no mail capability (no SMTP config, no mail dependency), and
-- adding one is not a prerequisite for this feature: the supervisor copies a
-- one-time link and sends it however they already talk to their staff — which,
-- for a WhatsApp product, is usually WhatsApp.
--
-- The member's `users` row is created at INVITE time with password_hash NULL, so
-- the address is reserved, the seat is accounted for, and the members list is a
-- single query. This table only carries the token that lets them set that first
-- password.
--
-- Why a token rather than the supervisor choosing an initial password: the
-- supervisor never learns the member's credential. It also fixes a pre-existing
-- dead end — must_reset_password made login return 403 with no endpoint able to
-- clear the flag, so such an account was simply locked out.
CREATE TABLE IF NOT EXISTS team_invites (
    id            BIGSERIAL   PRIMARY KEY,

    -- The invited member's own row. CASCADE so revoking a member disposes of any
    -- outstanding token in the same statement.
    user_id       TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Denormalised from users.owner_user_id so a supervisor's pending invites can
    -- be listed without a join, and so an invite cannot be re-pointed at another
    -- workspace by updating the user row.
    workspace_id  TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    email         TEXT        NOT NULL,

    -- SHA-256 of a 32-byte random token, the same reasoning as refresh_tokens:
    -- 256 bits of entropy has nothing to brute force, so the hash only needs to
    -- be fast and indexable, and a database leak cannot be replayed as a login.
    token_hash    TEXT        NOT NULL,

    expires_at    TIMESTAMPTZ NOT NULL,
    accepted_at   TIMESTAMPTZ,

    -- Who sent it. Kept even after the inviter is gone, hence SET NULL.
    invited_by    TEXT        REFERENCES users(id) ON DELETE SET NULL,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The accept path looks an invite up by token and nothing else.
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_token_hash_key
    ON team_invites (token_hash);

-- Listing a workspace's outstanding invites, and resending.
CREATE INDEX IF NOT EXISTS team_invites_workspace_idx
    ON team_invites (workspace_id) WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS team_invites_user_idx
    ON team_invites (user_id);

COMMENT ON TABLE team_invites IS
    'One-time tokens letting an invited member set their first password; no email is sent, the supervisor shares the link';
