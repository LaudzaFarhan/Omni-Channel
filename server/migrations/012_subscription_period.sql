-- Paid subscriptions expire.
--
-- Until now a paid plan was permanent: the webhook wrote users.plan_id and nothing ever
-- aged it out. The only expiry machinery in the product was the trial, which is why the
-- overlay copy already says "Subscription or Free Trial Expired" while nothing could
-- actually end a subscription.
--
-- Three columns, and the NULL semantics of each matter:
--
--   plans.duration_days       how long one purchase of this plan lasts. 30 by default,
--                             because that is the billing period being sold. 0 means
--                             perpetual, for a plan that should never lapse.
--   plans.unlimited_agents    this plan does not cap concurrent agents, so the UI shows an
--                             infinity indicator instead of a number.
--   users.subscription_ends_at  when THIS account's access ends. NULL means no limit.
--
-- That last default is the important one. Every existing customer gets NULL, so nobody who
-- has already paid is retroactively expired by deploying this — the period only starts
-- applying to purchases made from here on. A migration that expired existing accounts
-- would take paying customers offline the moment it ran.

ALTER TABLE plans
    -- 30 days is the period actually being sold. An admin can set 0 on a plan that should
    -- never lapse (an internal or lifetime plan) rather than needing a separate flag.
    ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 30
        CHECK (duration_days >= 0),

    -- An explicit flag rather than a magic number.
    --
    -- src/utils/plans.js states the house rule: there is deliberately no "unlimited"
    -- sentinel, because every limit is rendered directly and an Infinity would leak into
    -- the UI. So "unlimited" cannot be expressed by session_limit or included_agents,
    -- which are both NOT NULL integers. Treating a large value (999) as unlimited would
    -- be a sentinel by the back door, and it would break the moment somebody legitimately
    -- sold 999 agents. This says what it means, and the numeric columns keep working as
    -- the real ceiling for anything that has to do arithmetic.
    ADD COLUMN IF NOT EXISTS unlimited_agents BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN plans.duration_days IS
    'How many days one purchase of this plan grants; 0 means it never expires';
COMMENT ON COLUMN plans.unlimited_agents IS
    'Plan does not cap concurrent agents; the UI shows an infinity indicator';

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMPTZ;

COMMENT ON COLUMN users.subscription_ends_at IS
    'When this account''s paid access ends; NULL means no subscription limit';

-- The sweep this supports is "whose access has lapsed", which reads the date for accounts
-- that have one. Partial, so the index stays small: most rows are NULL.
CREATE INDEX IF NOT EXISTS users_subscription_ends_at_idx
    ON users (subscription_ends_at) WHERE subscription_ends_at IS NOT NULL;
