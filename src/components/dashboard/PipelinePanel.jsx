import React, { useMemo } from 'react';
import { Filter, ChevronRight, TrendingUp, Info, CheckCircle2, UserX, Users } from 'lucide-react';

const STAGES = [
  { key: 'prospect', label: 'New Leads', color: 'var(--primary)', icon: Users },
  { key: 'closed_won', label: 'Closed Won', color: 'var(--success)', icon: CheckCircle2 },
  { key: 'dropped', label: 'Bukan Prospek', color: 'var(--text-dimmed)', icon: UserX },
];

export default function PipelinePanel({ chats = [], chatStatuses = {}, onOpenInbox }) {
  const counts = useMemo(() => {
    const tally = { prospect: 0, closed_won: 0, dropped: 0 };
    chats.forEach((chat) => {
      if (!chat?.id) return;
      const status = chatStatuses[chat.id] || 'prospect';
      if (tally[status] !== undefined) tally[status]++;
    });
    return tally;
  }, [chats, chatStatuses]);

  const total = counts.prospect + counts.closed_won + counts.dropped;
  const winRate = total > 0 ? ((counts.closed_won / total) * 100).toFixed(1) : '0.0';

  return (
    <div className="dashboard-panel pipeline-panel">
      {/* Header */}
      <div className="dashboard-panel-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="panel-header-icon" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', border: '1px solid var(--primary-border)' }}>
            <TrendingUp size={16} />
          </div>
          <span>Pipeline Percakapan</span>
        </div>
        <span className="customer-count" title="Total percakapan dalam pipeline">{total.toLocaleString()}</span>
      </div>

      <div className="dashboard-panel-body pipeline-body">
        {total === 0 ? (
          <div className="dashboard-empty-state">
            <div className="dashboard-empty-icon"><Filter size={36} /></div>
            <p>Pipeline akan terisi setelah ada percakapan masuk</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', width: '100%' }}>
            {/* Multi-Segment Stacked Progress Bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: 'var(--text-dimmed)', fontWeight: '600' }}>
                <span>Distribusi Status Prospek</span>
                <span>Win Rate: <strong style={{ color: 'var(--success)' }}>{winRate}%</strong></span>
              </div>
              <div style={{ display: 'flex', height: '10px', borderRadius: '999px', overflow: 'hidden', background: 'var(--overlay-medium)', gap: '2px' }}>
                {STAGES.map(({ key, color }) => {
                  const count = counts[key];
                  const share = total > 0 ? (count / total) * 100 : 0;
                  if (share <= 0) return null;
                  return (
                    <div
                      key={key}
                      style={{
                        width: `${share}%`,
                        background: color,
                        transition: 'width 0.5s ease',
                      }}
                      title={`${counts[key]} (${share.toFixed(1)}%)`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Stages List */}
            <ul className="pipeline-list">
              {STAGES.map(({ key, label, color, icon: Icon }) => {
                const count = counts[key];
                const share = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <li key={key} className="pipeline-row">
                    <span className="pipeline-label">
                      <i className="pipeline-dot" style={{ background: color }} />
                      <span>{label}</span>
                    </span>
                    <span className="pipeline-track">
                      <span
                        className="pipeline-fill"
                        style={{ width: `${share}%`, background: color }}
                      />
                    </span>
                    <span className="pipeline-value">
                      {count.toLocaleString()}
                      <small>{share}%</small>
                    </span>
                  </li>
                );
              })}
            </ul>

            {/* Quick KPI Stats Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '4px' }}>
              <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--overlay-subtle)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)', fontWeight: '600' }}>New Leads Aktif</span>
                <span style={{ fontSize: '1.2rem', fontWeight: '800', color: 'var(--primary)' }}>{counts.prospect.toLocaleString()}</span>
              </div>
              <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.25)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: '600' }}>Deals Won</span>
                <span style={{ fontSize: '1.2rem', fontWeight: '800', color: 'var(--success)' }}>{counts.closed_won.toLocaleString()}</span>
              </div>
            </div>

            {/* Info note */}
            <div className="pipeline-note-box">
              <Info size={14} style={{ flexShrink: 0, marginTop: '1px', color: 'var(--text-dimmed)' }} />
              <p className="pipeline-note">
                Status komersial diubah langsung dari dalam chat percakapan dan tersinkronisasi untuk seluruh tim.
              </p>
            </div>
          </div>
        )}
      </div>

      {onOpenInbox && (
        <button type="button" className="convlog-seeall" onClick={onOpenInbox}>
          Buka Percakapan <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
}
