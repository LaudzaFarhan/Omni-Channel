// Quantity-based plan pricing.
//
// A plan has a base price covering `includedAgents` agents, and optionally a
// per-agent add-on price for going beyond that.
//
//   Starter: 300_000 base for 3 agents, +200_000 each, max 10
//   8 agents -> 300_000 + (8 - 3) * 200_000 = 1_300_000
//
// This module is the single definition of that arithmetic. The server recomputes
// the price on every checkout and never trusts a client-sent amount, but the
// customer has to be shown the same figure they will be charged — so both sides
// import this rather than each implementing the formula.

/** Agents this plan allows to be purchased, as [min, max]. max is null when unlimited. */
/**
 * True for a per-unit top-up rather than a plan.
 *
 * An add-on multiplies: N units cost N x basePrice and grant N x includedAgents,
 * added to whatever the customer's current plan already gives them. Buying one does
 * NOT change which plan they are on — that distinction is the whole reason the flag
 * exists, because selling an "extra agent" as a plan would move a Premium customer
 * onto it and take their message quota with it.
 */
export function isAddon(plan) {
  return Boolean(plan?.isAddon);
}

// A quantity control needs an upper bound even when the admin left max_agents blank,
// or the stepper runs forever. Only reached for add-ons; plans genuinely support
// "unlimited" via a null max.
const DEFAULT_ADDON_MAX = 20;

/**
 * The range of UNITS that can be bought.
 *
 * For a plan a unit is one agent and the floor is what the plan includes, so the
 * number is an absolute agent count. For an add-on a unit is one purchase of the
 * add-on and the floor is 1, so the number is a quantity. `clampAgents` and
 * `priceFor` both read this, so the two interpretations never mix.
 */
export function agentRange(plan) {
  if (!plan) return { min: 1, max: 1 };

  if (isAddon(plan)) {
    const max = plan.maxAgents === null || plan.maxAgents === undefined
      ? DEFAULT_ADDON_MAX
      : Math.max(1, Number(plan.maxAgents));
    return { min: 1, max };
  }

  const included = Math.max(1, Number(plan.includedAgents) || 1);
  const addonPrice = Number(plan.addonAgentPrice) || 0;

  // With no add-on price, the plan is fixed at what it includes.
  if (addonPrice <= 0) return { min: included, max: included };

  const max = plan.maxAgents === null || plan.maxAgents === undefined
    ? null
    : Math.max(included, Number(plan.maxAgents));

  return { min: included, max };
}

/** Clamp a requested unit count into what the plan or add-on permits. */
export function clampAgents(plan, requested) {
  const { min, max } = agentRange(plan);
  const value = Math.floor(Number(requested));
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (max !== null && value > max) return max;
  return value;
}

/**
 * How many agent slots a purchase actually grants.
 *
 * For a plan the unit count IS the agent count. For an add-on each unit grants
 * `includedAgents`, so three units of a 1-agent add-on grant three — and the webhook
 * ADDS that to the current total rather than replacing it.
 */
export function agentsGranted(plan, units) {
  const count = clampAgents(plan, units);
  if (!isAddon(plan)) return count;
  return count * Math.max(1, Number(plan?.includedAgents) || 1);
}

/**
 * Price for `agents` agents on `plan`, broken down so an invoice can show lines
 * and the UI can explain the total.
 */
export function priceFor(plan, agents) {
  if (!plan) {
    return { agents: 1, basePrice: 0, includedAgents: 1, extraAgents: 0, addonAgentPrice: 0, extraTotal: 0, total: 0 };
  }

  const included = Math.max(1, Number(plan.includedAgents) || 1);
  const basePrice = Math.max(0, Number(plan.basePrice ?? plan.price) || 0);
  const addonAgentPrice = Math.max(0, Number(plan.addonAgentPrice) || 0);

  // An add-on multiplies rather than splitting into base + surplus: every unit costs
  // the same, so the total is simply unit price x quantity.
  if (isAddon(plan)) {
    const units = clampAgents(plan, agents);
    return {
      isAddon: true,
      units,
      // Agent slots this purchase grants, which the webhook adds to the current total.
      agents: units * included,
      basePrice,
      unitPrice: basePrice,
      includedAgents: included,
      // No base/surplus split exists here; kept at zero so callers reading these
      // fields on a mixed list of plans and add-ons do not have to branch.
      extraAgents: 0,
      addonAgentPrice: 0,
      extraTotal: 0,
      total: basePrice * units,
    };
  }

  const count = clampAgents(plan, agents);
  const extraAgents = Math.max(0, count - included);
  const extraTotal = extraAgents * addonAgentPrice;

  return {
    isAddon: false,
    units: count,
    agents: count,
    basePrice,
    unitPrice: addonAgentPrice,
    includedAgents: included,
    extraAgents,
    addonAgentPrice,
    extraTotal,
    total: basePrice + extraTotal,
  };
}

/**
 * Invoice lines for a purchase. Mayar sums an items array, so a base line plus an
 * add-on line bills the whole thing as one payment while still itemising it.
 */
export function invoiceLines(plan, agents) {
  const p = priceFor(plan, agents);
  const lines = [];

  // One line with a real quantity, so the invoice reads "Add on Agent x3" rather than
  // hiding the multiplier inside a total.
  if (p.isAddon) {
    return [{
      description: `${plan.name}${p.includedAgents > 1 ? ` (${p.includedAgents} agents each)` : ''}`,
      quantity: p.units,
      rate: Math.max(1, p.unitPrice),
    }];
  }

  if (p.basePrice > 0) {
    lines.push({
      description: `${plan.name} — base (up to ${p.includedAgents} ${p.includedAgents === 1 ? 'agent' : 'agents'})`,
      quantity: 1,
      rate: p.basePrice,
    });
  }

  if (p.extraAgents > 0 && p.addonAgentPrice > 0) {
    lines.push({
      description: 'Additional agent',
      quantity: p.extraAgents,
      rate: p.addonAgentPrice,
    });
  }

  // A plan priced entirely per-agent would otherwise produce no lines, and Mayar
  // rejects an invoice whose total is not greater than zero.
  if (lines.length === 0) {
    lines.push({
      description: `${plan.name} — ${p.agents} ${p.agents === 1 ? 'agent' : 'agents'}`,
      quantity: 1,
      rate: Math.max(1, p.total),
    });
  }

  return lines;
}

export function formatIDR(value) {
  const n = Number(value) || 0;
  return `Rp ${n.toLocaleString('id-ID')}`;
}

/** "Rp 300.000 (base) + Rp 1.000.000 (5 extra)" — mirrors the landing page copy. */
export function priceBreakdownLabel(plan, agents) {
  const p = priceFor(plan, agents);
  if (p.isAddon) {
    return `${p.units} x ${formatIDR(p.unitPrice)} = ${formatIDR(p.total)}`;
  }
  if (p.extraAgents <= 0) return `${formatIDR(p.total)} (base)`;
  return `${formatIDR(p.basePrice)} (base) + ${formatIDR(p.extraTotal)} (${p.extraAgents} extra)`;
}
