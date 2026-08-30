import React, { useState } from 'react';
import { CreditCard, Check, Minus, Plus, Users } from 'lucide-react';
import { agentRange, priceFor, clampAgents, formatIDR, priceBreakdownLabel } from '../utils/pricing.js';

// Purchasable plans, rendered from the catalogue.
//
// This replaces two hardcoded buttons that always bought 'premium'. Any plan an
// admin created was invisible to customers, so the catalogue had no effect on what
// could actually be bought — new plans simply could not be purchased.
//
// The agent selector is here too: plans with a per-agent add-on price let the
// customer choose a count, and the total is computed with the same function the
// server bills with, so the figure shown is the figure charged.
export default function PlanPicker({ plans = [], userProfile, onCheckout, buying }) {
  // Chosen agent count per plan, defaulting to what each plan includes.
  const [agentsByPlan, setAgentsByPlan] = useState({});

  const currentPlanId = userProfile?.planId || userProfile?.tier;
  const currentAgents = userProfile?.purchasedAgents ?? null;

  // Free plans are not purchasable, and archived ones are withdrawn from sale.
  const purchasable = plans
    .filter(p => !p.archived)
    .filter(p => (p.basePrice ?? p.price ?? 0) > 0 || (p.addonAgentPrice ?? 0) > 0);

  if (purchasable.length === 0) {
    return (
      <div className="card glass" style={{ textAlign: 'center', padding: '32px', color: 'var(--text-dimmed)' }}>
        No paid plans are available at the moment.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
      {purchasable.map((plan) => {
        const range = agentRange(plan);
        const selected = clampAgents(plan, agentsByPlan[plan.id] ?? range.min);
        const pricing = priceFor(plan, selected);
        const adjustable = range.max === null || range.max > range.min;

        const isCurrent = currentPlanId === plan.id
          && (currentAgents === null ? selected === range.min : currentAgents === selected);

        const setAgents = (next) =>
          setAgentsByPlan(prev => ({ ...prev, [plan.id]: clampAgents(plan, next) }));

        return (
          <div
            key={plan.id}
            className="card glass"
            style={{
              display: 'flex', flexDirection: 'column', gap: '16px',
              border: isCurrent ? '2px solid var(--primary)' : '1px solid var(--border-color)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem' }}>{plan.name}</h3>
                {isCurrent && (
                  <span style={{
                    fontSize: '0.68rem', fontWeight: '700', textTransform: 'uppercase',
                    padding: '2px 8px', borderRadius: '4px', color: 'var(--primary)',
                    background: 'rgba(0,168,132,0.12)', border: '1px solid rgba(0,168,132,0.25)',
                  }}>
                    Current
                  </span>
                )}
              </div>
              {plan.description && (
                <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                  {plan.description}
                </p>
              )}
            </div>

            {/* Price, recomputed as the agent count changes */}
            <div>
              <div style={{ fontSize: '1.7rem', fontWeight: '700', color: 'var(--primary)', lineHeight: 1.1 }}>
                {formatIDR(pricing.total)}
                <span style={{ fontSize: '0.85rem', color: 'var(--text-dimmed)', fontWeight: '500' }}> /bulan</span>
              </div>
              {pricing.extraAgents > 0 && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  {priceBreakdownLabel(plan, selected)}
                </div>
              )}
            </div>

            {/* Agent selector, only where the plan actually sells add-ons */}
            {adjustable ? (
              <div style={{ padding: '14px', borderRadius: '10px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <Users size={14} /> Agents
                  </span>
                  <strong style={{ fontSize: '0.95rem' }}>{selected}</strong>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <button
                    onClick={() => setAgents(selected - 1)}
                    disabled={selected <= range.min}
                    aria-label="One fewer agent"
                    style={{
                      background: 'transparent', border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)', borderRadius: '6px', width: '28px', height: '28px',
                      cursor: selected <= range.min ? 'not-allowed' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      opacity: selected <= range.min ? 0.4 : 1,
                    }}
                  >
                    <Minus size={14} />
                  </button>

                  <input
                    type="range"
                    min={range.min}
                    max={range.max ?? range.min + 20}
                    value={selected}
                    onChange={(e) => setAgents(Number(e.target.value))}
                    aria-label={`Agents for ${plan.name}`}
                    style={{ flex: 1, accentColor: 'var(--primary)' }}
                  />

                  <button
                    onClick={() => setAgents(selected + 1)}
                    disabled={range.max !== null && selected >= range.max}
                    aria-label="One more agent"
                    style={{
                      background: 'transparent', border: '1px solid var(--border-color)',
                      color: 'var(--text-muted)', borderRadius: '6px', width: '28px', height: '28px',
                      cursor: (range.max !== null && selected >= range.max) ? 'not-allowed' : 'pointer',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      opacity: (range.max !== null && selected >= range.max) ? 0.4 : 1,
                    }}
                  >
                    <Plus size={14} />
                  </button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-dimmed)', marginTop: '6px' }}>
                  <span>{range.min}</span>
                  <span>{range.max === null ? 'unlimited' : range.max}</span>
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)', marginTop: '8px' }}>
                  {formatIDR(plan.basePrice)} covers {plan.includedAgents}, then {formatIDR(plan.addonAgentPrice)} each
                </div>
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)' }}>
                {plan.includedAgents} {plan.includedAgents === 1 ? 'agent' : 'agents'} included
              </div>
            )}

            {plan.features?.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
                {plan.features.map((f, i) => (
                  <li key={i} style={{ fontSize: '0.84rem', color: 'var(--text-muted)', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <Check size={14} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '3px' }} />
                    {f}
                  </li>
                ))}
              </ul>
            )}

            <button
              className="upgrade-btn"
              onClick={() => onCheckout(plan.id, selected)}
              disabled={buying || isCurrent}
              style={{
                marginTop: 'auto', width: '100%',
                display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                opacity: isCurrent ? 0.6 : 1, cursor: isCurrent ? 'default' : 'pointer',
              }}
            >
              <CreditCard size={16} />
              {isCurrent ? 'Current plan' : `Get ${plan.name} — ${formatIDR(pricing.total)}`}
            </button>
          </div>
        );
      })}
    </div>
  );
}
