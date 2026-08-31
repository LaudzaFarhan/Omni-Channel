import React from 'react';

// The Omni Reach logo mark, used in the nav rails and the auth screen.
//
// Served from public/omnireach-logo.svg so the exact artwork can be swapped by
// replacing that one file (or dropping in a PNG and changing the src here) without
// touching every call site. Kept as a plain <img> rather than inlined SVG so it is
// cached once and shared.
export default function BrandMark({ size = 32, className = '', style = {} }) {
  return (
    <img
      src="/omnireach-logo.svg"
      alt="Omni Reach"
      width={size}
      height={size}
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
    />
  );
}
