import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { apiUrl } from '../utils/apiBase.js';

// Shows which commit this bundle was built from, and warns when the running
// server is on a different one.
//
// The globals are injected at build time by vite.config.js. The typeof guards
// keep the component usable if it is ever rendered outside a Vite build (a test,
// or a stale bundle built before the define block existed).
const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
const SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'unknown';
const BRANCH = typeof __BUILD_BRANCH__ !== 'undefined' ? __BUILD_BRANCH__ : '';
const DIRTY = typeof __BUILD_DIRTY__ !== 'undefined' ? __BUILD_DIRTY__ : false;
const BUILT_AT = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';

function formatBuiltAt(iso) {
  if (!iso) return 'unknown';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString();
}

export default function VersionBadge({ compact = false }) {
  const [serverBuild, setServerBuild] = useState(null);

  // /api/health is unauthenticated, so this works on every screen including the
  // landing and login pages.
  useEffect(() => {
    let cancelled = false;

    fetch(apiUrl('/api/health'))
      .then(res => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.build) setServerBuild(data.build);
      })
      .catch(() => {
        // A health check failure is not this component's problem to report.
      });

    return () => { cancelled = true; };
  }, []);

  // Only meaningful once both sides are known and both resolved a real commit.
  const mismatch = Boolean(
    serverBuild
    && serverBuild.sha
    && serverBuild.sha !== 'unknown'
    && SHA !== 'unknown'
    && serverBuild.sha !== SHA
  );

  const tooltip = [
    `Version ${VERSION}`,
    `Bundle:  ${SHA}${DIRTY ? ' (uncommitted changes)' : ''}${BRANCH ? ` on ${BRANCH}` : ''}`,
    `Built:   ${formatBuiltAt(BUILT_AT)}`,
    serverBuild ? `Server:  ${serverBuild.sha}${serverBuild.branch ? ` on ${serverBuild.branch}` : ''}` : 'Server:  unreachable',
    mismatch
      ? '\nMismatch: the server is running a different commit than this page was built from. Run `npm run build` and hard-reload.'
      : '',
  ].filter(Boolean).join('\n');

  const color = mismatch ? '#f59e0b' : 'var(--text-dimmed)';

  return (
    <span
      title={tooltip}
      aria-label={tooltip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        fontSize: '0.68rem',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: '0.02em',
        color,
        border: `1px solid ${mismatch ? 'rgba(245,158,11,0.35)' : 'var(--border-color)'}`,
        background: mismatch ? 'rgba(245,158,11,0.08)' : 'transparent',
        padding: '2px 7px',
        borderRadius: '5px',
        whiteSpace: 'nowrap',
        cursor: 'help',
        userSelect: 'all',
      }}
    >
      {mismatch && <AlertTriangle size={10} style={{ flexShrink: 0 }} />}
      {compact ? SHA : `v${VERSION}·${SHA}`}
      {DIRTY && <span title="Built from a working tree with uncommitted changes">*</span>}
    </span>
  );
}
