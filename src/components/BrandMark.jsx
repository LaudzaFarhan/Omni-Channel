import React from 'react';

// One source for the Omni Reach mark. The public asset can be replaced later with the
// final artwork without changing any navbar, auth screen, or favicon call site.
export default function BrandMark({
  size = 32,
  className = '',
  style = {},
  alt = 'Omni Reach',
  decorative = false,
}) {
  return (
    <img
      src="/omnireach-logo.svg"
      alt={decorative ? '' : alt}
      aria-hidden={decorative ? true : undefined}
      width={size}
      height={size}
      draggable="false"
      className={`brand-mark ${className}`.trim()}
      style={{ display: 'block', flexShrink: 0, ...style }}
    />
  );
}

// Compact horizontal lockup for every navbar. Keeping the typography here (through
// shared classes) prevents the landing, admin, and dashboard navs from drifting into
// three different versions of the same brand again.
export function BrandLockup({
  markSize = 32,
  showName = true,
  className = '',
  style = {},
}) {
  return (
    <span
      className={`brand-lockup ${className}`.trim()}
      style={style}
      role="img"
      aria-label="Omni Reach"
    >
      <BrandMark size={markSize} decorative />
      {showName && <span className="brand-wordmark" aria-hidden="true">OMNI REACH</span>}
    </span>
  );
}
