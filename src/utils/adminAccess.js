// Single source of truth for which email addresses may hold the admin role.
//
// This list was previously duplicated in three places (AuthScreens.jsx,
// App.jsx, and firestore.rules) and the copies disagreed: the client treated any
// address ending in "@admin.com" as admin, while the security rules only
// accepted two specific addresses. Registering e.g. foo@admin.com therefore
// built a profile with role:'admin' that the rules then rejected, so signup
// failed with an opaque permission error.
//
// The wildcard is gone. Keep this list in sync with isAdminEmail() in
// firestore.rules and ADMIN_EMAILS in the server environment — the rules are the
// real enforcement point, this is only used to decide what to write at signup.

const BUILT_IN_ADMIN_EMAILS = [
  'owner@admin.com',
  'adminthelab@gmail.com',
];

function parseList(raw) {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean);
}

// VITE_ADMIN_EMAILS accepts a comma-separated list. VITE_ADMIN_EMAIL is the
// older single-value form and is still honoured.
export function adminEmails() {
  const fromList = parseList(import.meta.env.VITE_ADMIN_EMAILS);
  const single = parseList(import.meta.env.VITE_ADMIN_EMAIL);
  return Array.from(new Set([...BUILT_IN_ADMIN_EMAILS, ...fromList, ...single]));
}

export function isAdminEmail(email) {
  if (!email) return false;
  return adminEmails().includes(String(email).trim().toLowerCase());
}
