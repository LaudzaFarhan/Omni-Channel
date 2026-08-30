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
export function agentRange(plan) {
  if (!plan) return { min: 1, max: 1 };

  const included = Math.max(1, Number(plan.includedAgents) || 1);
  const addonPrice = Number(plan.addonAgentPrice) || 0;

  // With no add-on price, the plan is fixed at what it includes.
  if (addonPrice <= 0) return { min: included, max: included };

  const max = plan.maxAgents === null || plan.maxAgents === undefined
    ? null
    : Math.max(included, Number(plan.maxAgents));

  return { min: included, max };
}

/** Clamp a requested agent count into what the plan permits. */
export function clampAgents(plan, requested) {
  const { min, max } = agentRange(plan);
  const value = Math.floor(Number(requested));
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (max !== null && value > max) return max;
  return value;
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

  const count = clampAgents(plan, agents);
  const extraAgents = Math.max(0, count - included);
  const extraTotal = extraAgents * addonAgentPrice;

  return {
    agents: count,
    basePrice,
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
  if (p.extraAgents <= 0) return `${formatIDR(p.total)} (base)`;
  return `${formatIDR(p.basePrice)} (base) + ${formatIDR(p.extraTotal)} (${p.extraAgents} extra)`;
}
