import React, { useState, useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { currentTheme, toggleTheme, subscribeTheme } from '../utils/theme.js';

// Light/dark switch. Subscribes to the theme rather than owning it, so every
// instance stays in sync with the others and with the OS-preference listener.
//
// `className` lets the host nav style it (the customer TopBar uses its own
// icon-button class); when absent, a self-contained style is applied so the admin
// console does not need extra CSS.
export default function ThemeToggle({ className = '', title }) {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => subscribeTheme(setTheme), []);

  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode';

  const fallbackStyle = className ? undefined : {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '34px',
    height: '34px',
    background: 'transparent',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'color 0.2s, border-color 0.2s',
  };

  return (
    <button
      type="button"
      className={className}
      style={fallbackStyle}
      onClick={() => toggleTheme()}
      title={title || label}
      aria-label={label}
      aria-pressed={isDark}
    >
      {isDark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
