import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, LogOut, AlertCircle, Info, X } from 'lucide-react';
import { subscribeToasts } from '../utils/toastBus.js';

const ICONS = {
  success: CheckCircle2,
  logout: LogOut,
  error: AlertCircle,
  info: Info,
};

// A single toast: animates in, then slides out just before it is removed so the
// exit is visible rather than the element vanishing abruptly.
function Toast({ toast, onDismiss }) {
  const [leaving, setLeaving] = useState(false);
  const duration = toast.duration ?? 3200;

  useEffect(() => {
    // Start the exit animation shortly before the toast is actually removed.
    const exitTimer = setTimeout(() => setLeaving(true), Math.max(0, duration - 280));
    const removeTimer = setTimeout(() => onDismiss(toast.id), duration);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, duration, onDismiss]);

  const handleDismiss = () => {
    setLeaving(true);
    setTimeout(() => onDismiss(toast.id), 260);
  };

  const Icon = ICONS[toast.type] || ICONS.info;

  return (
    <div
      className={`toast toast-${toast.type || 'info'} ${leaving ? 'toast-leaving' : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="toast-icon" aria-hidden="true">
        <Icon size={18} />
      </span>

      <div className="toast-content">
        {toast.title && <div className="toast-title">{toast.title}</div>}
        {toast.message && <div className="toast-message">{toast.message}</div>}
      </div>

      <button
        type="button"
        className="toast-close"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

// Stacked container, fixed to the top-right of the viewport.
export function ToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map(toast => (
        <Toast key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// Global host: subscribes to the toast bus and renders into document.body so it
// stays visible regardless of which screen the app is currently rendering.
export default function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    return subscribeToasts((toast) => {
      // Cap the stack so rapid events can't fill the screen.
      setToasts(prev => [...prev, toast].slice(-3));
    });
  }, []);

  const handleDismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return createPortal(
    <ToastContainer toasts={toasts} onDismiss={handleDismiss} />,
    document.body
  );
}
