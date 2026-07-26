import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { apiUrl } from './apiBase.js';

// Env values pasted into a hosting dashboard frequently pick up a trailing
// newline or space. Firebase then sends that raw into the request URL (it shows
// up as %0D%0A) and every auth call fails with HTTP 400, so trim defensively.
const env = (key) => {
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : value;
};

const firebaseConfig = {
  apiKey: env('VITE_FIREBASE_API_KEY'),
  authDomain: env('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: env('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: env('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: env('VITE_FIREBASE_APP_ID'),
  measurementId: env('VITE_FIREBASE_MEASUREMENT_ID'),
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Helper to perform authenticated HTTP requests against the backend.
export async function fetchWithAuth(url, options = {}) {
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const token = await currentUser.getIdToken();
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${token}`
      };
    } catch (err) {
      console.error('[Firebase] Failed to get Auth JID Token:', err);
    }
  }

  const res = await fetch(apiUrl(url), options);

  // A static host (or a catch-all rewrite) answers unknown /api routes with the
  // SPA's index.html. Parsing that as JSON throws the confusing
  // "Unexpected token '<'" error, so surface the real problem instead.
  const contentType = res.headers.get('content-type') || '';
  if (res.ok && contentType.includes('text/html')) {
    throw new Error(
      `Backend not reachable: ${apiUrl(url)} returned HTML instead of JSON. ` +
      `Set VITE_API_URL to your backend server URL (the WhatsApp backend cannot run on serverless hosting).`
    );
  }

  return res;
}

export default app;
