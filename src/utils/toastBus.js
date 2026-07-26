// Tiny pub/sub for toasts.
//
// App.jsx has several early returns (landing, login, session-blocked), so a
// container rendered inside its JSX would disappear on some screens. Publishing
// to this bus lets a single host mounted at the app root display toasts from
// anywhere, including right after a sign-out navigates away.

let listeners = [];
let nextId = 0;

export function subscribeToasts(listener) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter(l => l !== listener);
  };
}

export function showToast({ type = 'info', title, message, duration } = {}) {
  const toast = {
    id: `toast_${Date.now()}_${nextId++}`,
    type,
    title,
    message,
    duration,
  };
  listeners.forEach(listener => listener(toast));
  return toast.id;
}
