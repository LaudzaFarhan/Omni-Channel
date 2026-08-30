-- Quantity-based pricing: a base price covering N agents, plus a per-agent add-on.
--
-- An "agent" is an access slot: one more device/person that can be signed into the
-- account at the same time. This is what users.session_limit has always actually
-- enforced (the socket handler counts concurrent connections against it), even
-- though the UI labelled it "WhatsApp devices".
--
-- Starter, as priced on the landing page:
--   base_price        = 300000   (covers up to 3 agents)
--   included_agents   = 3
--   addon_agent_price = 200000
--   max_agents        = 10
-- 8 agents => 300000 + (8 - 3) * 200000 = 1_300_000

ALTER TABLE plans
    -- Covers `included_agents` agents. Kept alongside the existing `price` column
    -- so nothing that still reads `price` breaks; base_price is seeded from it.
    ADD COLUMN IF NOT EXISTS base_price        BIGINT  NOT NULL DEFAULT 0
        CHECK (base_price >= 0),
    ADD COLUMN IF NOT EXISTS included_agents   INTEGER NOT NULL DEFAULT 1
        CHECK (included_agents >= 1),
    -- 0 means extra agents cannot be bought on this plan.
    ADD COLUMN IF NOT EXISTS addon_agent_price BIGINT  NOT NULL DEFAULT 0
        CHECK (addon_agent_price >= 0),
    -- NULL means unlimited.
    ADD COLUMN IF NOT EXISTS max_agents        INTEGER
        CHECK (max_agents IS NULL OR max_agents >= 1);

-- Existing plans: the flat price becomes the base, covering the agents the plan
-- already granted. No behaviour change until an admin sets an add-on price.
UPDATE plans
   SET base_price      = price,
       included_agents = GREATEST(1, session_limit)
 WHERE base_price = 0 AND price > 0;

UPDATE plans
   SET included_agents = GREATEST(1, session_limit)
 WHERE included_agents = 1 AND session_limit > 1;

-- How many agents the customer actually paid for.
--
-- Distinct from session_limit, which stays as the ADMIN OVERRIDE. Precedence when
-- resolving the effective limit is:
--   session_limit (admin granted it manually)
--   > purchased_agents (the customer bought it)
--   > plans.included_agents (what the plan comes with)
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS purchased_agents INTEGER
        CHECK (purchased_agents IS NULL OR purchased_agents >= 1);

-- Record what a transaction was for, so an invoice can be reconciled later and
-- the webhook knows how many agents to grant.
ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS plan_id  TEXT,
    ADD COLUMN IF NOT EXISTS agents   INTEGER
        CHECK (agents IS NULL OR agents >= 1);

COMMENT ON COLUMN plans.base_price        IS 'Price covering included_agents agents';
COMMENT ON COLUMN plans.included_agents   IS 'Agents (concurrent access slots) covered by base_price';
COMMENT ON COLUMN plans.addon_agent_price IS 'Price per agent beyond included_agents; 0 disables add-ons';
COMMENT ON COLUMN plans.max_agents        IS 'Maximum purchasable agents; NULL means unlimited';
COMMENT ON COLUMN users.purchased_agents  IS 'Agents the customer paid for; NULL inherits the plan';
