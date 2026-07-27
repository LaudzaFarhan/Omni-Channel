import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
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

// Firebase restores a persisted session asynchronously, so auth.currentUser is
// null for the first moments after a page load. Requests fired in that window
// would go out with no Authorization header and get a 401. Resolve once the SDK
// has reported its initial state so callers can await it.
let authReadyPromise = null;
function waitForAuthReady() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve) => {
      const unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          resolve(user);
        },
        () => {
          unsubscribe();
          resolve(null);
        }
      );
    });
  }

  return authReadyPromise;
}

// Helper to perform authenticated HTTP requests against the backend.
export async function fetchWithAuth(url, options = {}) {
  // Wait for Firebase to restore its session before reading currentUser,
  // otherwise early calls are sent unauthenticated and rejected with 401.
  const currentUser = auth.currentUser || await waitForAuthReady();

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

  let res = await fetch(apiUrl(url), options);

  // A 401 can also mean the cached ID token expired (they last one hour).
  // Force-refresh once and retry before surfacing the failure.
  if (res.status === 401 && currentUser) {
    try {
      const freshToken = await currentUser.getIdToken(true);
      options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${freshToken}`
      };
      res = await fetch(apiUrl(url), options);
    } catch (err) {
      console.error('[Firebase] Token refresh failed:', err);
    }
  }

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
