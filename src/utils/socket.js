import { io } from 'socket.io-client';
import { API_BASE } from './apiBase.js';

let socket = null;

// Components that attach their own listeners (the admin console, the
// subscription view) can mount before App.jsx has called connectSocket, so
// reading getSocket() once in an effect would silently miss the connection.
// Subscribing instead means they are handed the socket whenever it appears, and
// null when it goes away.
let readyListeners = [];

function notifyReady() {
  readyListeners.forEach((listener) => {
    try {
      listener(socket);
    } catch (err) {
      console.error('[Socket] Ready listener failed:', err);
    }
  });
}

export function getSocket() {
  return socket;
}

// Calls the listener immediately with the current socket (possibly null), then
// again on every connect and disconnect. Returns an unsubscribe function.
export function subscribeSocket(listener) {
  readyListeners.push(listener);
  listener(socket);
  return () => {
    readyListeners = readyListeners.filter(l => l !== listener);
  };
}

export function connectSocket(token) {
  if (socket) {
    socket.disconnect();
  }

  const options = {
    auth: {
      token: token
    },
    autoConnect: true
  };

  // With no API_BASE, connect to the page's own origin (Vite proxies /socket.io
  // to the backend in dev). Otherwise connect directly to the backend host.
  socket = API_BASE ? io(API_BASE, options) : io(options);

  notifyReady();
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    notifyReady();
  }
}
