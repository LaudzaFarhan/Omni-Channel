// In-memory team presence management for Omnireach workspaces.
// Tracks active socket connections, online/away/off statuses, and broadcasts
// live updates to workspace rooms.

import { listWorkspaceMembers } from './data.js';

// Map<userId, Set<socketId>>
const userSockets = new Map();

// Map<userId, { status: 'online'|'away'|'off', lastActive: number, manual: boolean }>
const userPresence = new Map();

/**
 * Called when a user connects a new socket.
 */
export function onUserConnected(workspaceId, userId, socketId, io) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId).add(socketId);

  const existing = userPresence.get(userId);
  if (!existing || existing.status === 'off') {
    // If not previously set or was offline, set to online
    userPresence.set(userId, {
      status: 'online',
      lastActive: Date.now(),
      manual: false,
    });
  } else {
    // Update last active
    userPresence.set(userId, {
      ...existing,
      lastActive: Date.now(),
    });
  }

  // Broadcast to workspace
  if (io && workspaceId) {
    broadcastWorkspacePresence(io, workspaceId);
  }
}

/**
 * Called when a user's socket disconnects.
 */
export function onUserDisconnected(workspaceId, userId, socketId, io) {
  const sockets = userSockets.get(userId);
  if (sockets) {
    sockets.delete(socketId);
    if (sockets.size === 0) {
      userSockets.delete(userId);
      const existing = userPresence.get(userId);
      userPresence.set(userId, {
        status: 'off',
        lastActive: Date.now(),
        manual: existing?.manual || false,
      });
    }
  }

  // Broadcast to workspace
  if (io && workspaceId) {
    broadcastWorkspacePresence(io, workspaceId);
  }
}

/**
 * Set user status explicitly (e.g. 'online', 'away', 'off').
 */
export async function setUserPresence(workspaceId, userId, status, io) {
  const valid = ['online', 'away', 'off'];
  if (!valid.includes(status)) return;

  userPresence.set(userId, {
    status,
    lastActive: Date.now(),
    manual: true,
  });

  if (io && workspaceId) {
    await broadcastWorkspacePresence(io, workspaceId);
  }
}

/**
 * Get team members for a workspace with their live presence status.
 */
export async function getWorkspaceTeamPresence(workspaceId) {
  try {
    const members = await listWorkspaceMembers(workspaceId);

    const membersWithPresence = members.map((member) => {
      const activeSockets = userSockets.get(member.uid);
      const isConnected = activeSockets && activeSockets.size > 0;
      const presenceInfo = userPresence.get(member.uid);

      let status = 'off';
      if (isConnected) {
        status = presenceInfo?.status || 'online';
      }

      const lastActive = presenceInfo?.lastActive || (member.lastLoginAt ? new Date(member.lastLoginAt).getTime() : null);

      return {
        uid: member.uid,
        email: member.email,
        name: member.name || member.email?.split('@')[0] || 'Team Member',
        isSupervisor: member.isSupervisor,
        status, // 'online' | 'away' | 'off'
        lastActive,
        lastLoginAt: member.lastLoginAt,
      };
    });

    const summary = {
      online: membersWithPresence.filter(m => m.status === 'online').length,
      away: membersWithPresence.filter(m => m.status === 'away').length,
      off: membersWithPresence.filter(m => m.status === 'off').length,
      total: membersWithPresence.length,
    };

    return {
      members: membersWithPresence,
      summary,
    };
  } catch (err) {
    console.error('[Presence] Failed to fetch workspace team presence:', err);
    return {
      members: [],
      summary: { online: 0, away: 0, off: 0, total: 0 },
    };
  }
}

/**
 * Broadcast presence update to all clients in the workspace.
 */
export async function broadcastWorkspacePresence(io, workspaceId) {
  if (!io || !workspaceId) return;
  try {
    const data = await getWorkspaceTeamPresence(workspaceId);
    io.to(workspaceId).emit('team-presence-update', data);
  } catch (err) {
    console.error('[Presence] Broadcast failed:', err);
  }
}
