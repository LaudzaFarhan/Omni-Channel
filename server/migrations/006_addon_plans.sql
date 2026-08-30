-- Add-on products: things bought BY THE UNIT on top of a plan, not instead of one.
--
-- The catalogue only had plans, and buying anything from it did two things at once:
-- set users.plan_id and set users.purchased_agents. So an "Add on Agent" entry priced
-- at Rp 200.000 was unusable for its actual purpose — a Premium customer who bought
-- one would be moved OFF Premium and onto the add-on, losing the message quota they
-- were paying for.
--
-- An add-on differs from a plan in three ways:
--
--   1. Buying it does not change plan_id. It increments purchased_agents, so the
--      agents stack on top of whatever the current plan already includes.
--   2. It is repeatable. There is no "you are already on this plan" state, because
--      buying a second one is the whole point.
--   3. Its price is per unit and multiplies by quantity, where a plan's base price
--      covers included_agents and only the surplus is charged per agent.
--
-- The existing columns already carry everything else, so this is one flag:
--
--   base_price       the price of ONE unit
--   included_agents  agents granted per unit (usually 1)
--   max_agents       the most units the admin allows in a single purchase
--
-- addon_agent_price stays unused on an add-on row: there is no "base plus surplus"
-- split to express when every unit costs the same.

ALTER TABLE plans
    ADD COLUMN IF NOT EXISTS is_addon BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN plans.is_addon IS
    'TRUE = a per-unit top-up that adds agents to the current plan instead of replacing it';

-- Listing the buyable catalogue splits plans from add-ons, and both are read on every
-- visit to the subscription page.
CREATE INDEX IF NOT EXISTS plans_is_addon_idx
    ON plans (is_addon) WHERE NOT archived;
