// Base URL for the backend (Express + Socket.IO + Baileys).
//
// - Local dev: leave VITE_API_URL unset. Vite's proxy forwards /api and
//   /socket.io to http://localhost:5000, so relative URLs just work.
// - Deployed frontend (e.g. Vercel): the Baileys backend must run on a
//   persistent host (it holds a long-lived WebSocket, so it cannot run on
//   serverless). Set VITE_API_URL to that host, e.g.
//   VITE_API_URL=https://my-wa-backend.example.com
//
// Trailing slashes and stray whitespace/newlines are stripped, because pasting
// values into a hosting dashboard often introduces them and that silently
// breaks every request.
const raw = (import.meta.env.VITE_API_URL || '').trim();

export const API_BASE = raw.replace(/\/+$/, '');

// Build a full URL for an API path such as '/api/chats?sessionId=default'.
export function apiUrl(path) {
  if (!path.startsWith('/')) path = '/' + path;
  return API_BASE ? `${API_BASE}${path}` : path;
}
