import { io } from 'socket.io-client';
import { API_BASE } from './apiBase.js';

let socket = null;

export function getSocket() {
  return socket;
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

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
