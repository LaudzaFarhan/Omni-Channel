// How data is addressed: composite store keys and Socket.IO room names.
//
// These two functions existed only inside server/index.js, so three other call
// sites had rebuilt the composite key by hand as `${uid}_${sessionId}`. That was
// harmless while one user was one tenant, but team seats make it a data-leak
// shape: the hand-built version takes whatever id the caller passes, and if that
// is a member's own id rather than their workspace's, the member silently gets an
// empty parallel store instead of their team's chats.
//
// Both are here so there is one definition to get right.

/**
 * Key for one WhatsApp connection: its entry in activeSessions, its Baileys
 * credential directory (sessions/auth_info_<key>) and its chat store file
 * (sessions/store_<key>.json).
 *
 * `ownerId` is always the WORKSPACE owner's user id — `req.workspaceId`, i.e.
 * `owner_user_id ?? id`. Never the id of whichever team member happens to be
 * making the request; a member id in a path would also break
 * restoreSessionsOnBoot, which recovers the owner id by splitting the directory
 * name on its first underscore.
 */
export function sessionKey(ownerId, sessionId) {
  return `${ownerId}_${sessionId || 'default'}`;
}

/**
 * Room carrying events about one PERSON rather than one account: their own
 * profile row, and anything else a colleague sharing the workspace must not see.
 *
 * The workspace id is itself used directly as a room name for account-wide events
 * (WhatsApp status, new messages, quota, holds, contacts). The `user:` prefix
 * keeps the two namespaces from ever colliding.
 */
export function userRoom(userId) {
  return `user:${userId}`;
}
