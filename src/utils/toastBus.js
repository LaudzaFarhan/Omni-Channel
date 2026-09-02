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

export function showToast(arg1, arg2) {
  let toast;
  if (typeof arg1 === 'string') {
    toast = {
      id: `toast_${Date.now()}_${nextId++}`,
      type: arg2 || 'info',
      title: arg2 === 'error' ? 'Error' : (arg2 === 'success' ? 'Success' : null),
      message: arg1,
      duration: 3500,
    };
  } else if (arg1 && typeof arg1 === 'object') {
    toast = {
      id: `toast_${Date.now()}_${nextId++}`,
      type: arg1.type || 'info',
      title: arg1.title,
      message: arg1.message,
      duration: arg1.duration || 4500,
      onClick: arg1.onClick,
      chatJid: arg1.chatJid,
    };
  } else {
    return null;
  }
  listeners.forEach(listener => listener(toast));
  return toast.id;
}
