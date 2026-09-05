// In-memory and Postgres team presence management for Omnireach workspaces.
// Tracks active socket connections, online/away/off statuses, activity logs,
// and broadcasts live updates to workspace rooms.

import { query, queryOne, isConfigured } from './db.js';
import { listWorkspaceMembers } from './data.js';

// Map<userId, Set<socketId>>
const userSockets = new Map();

// Map<userId, { status: 'online'|'away'|'off', lastActive: number, manual: boolean }>
const userPresence = new Map();

// In-memory fallback logs buffer
let inMemoryPresenceLogs = [];

/**
 * Log presence status transitions to Postgres (and in-memory buffer)
 */
export async function logPresenceTransition(workspaceId, userId, newStatus) {
  if (!workspaceId || !userId || !['online', 'away', 'off'].includes(newStatus)) return;

  const now = new Date();

  // In-memory update
  const openMem = inMemoryPresenceLogs.find(
    (l) => l.workspaceId === workspaceId && l.userId === userId && !l.endedAt
  );
  if (openMem) {
    if (openMem.status === newStatus) return; // Same status, no-op
    openMem.endedAt = now;
    openMem.durationSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(openMem.startedAt).getTime()) / 1000)
    );
  }

  inMemoryPresenceLogs.unshift({
    id: 'mem_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    workspaceId,
    userId,
    status: newStatus,
    startedAt: now,
    endedAt: null,
    durationSeconds: 0,
  });

  if (inMemoryPresenceLogs.length > 2000) {
    inMemoryPresenceLogs = inMemoryPresenceLogs.slice(0, 2000);
  }

  // Database update
  if (isConfigured()) {
    try {
      // Close open row
      await query(
        `UPDATE user_presence_logs 
         SET ended_at = now(),
             duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
         WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NULL AND status <> $3`,
        [workspaceId, userId, newStatus]
      );

      // Check if already open with same status
      const existingOpen = await queryOne(
        `SELECT id FROM user_presence_logs 
         WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NULL AND status = $3`,
        [workspaceId, userId, newStatus]
      );

      if (!existingOpen) {
        await query(
          `INSERT INTO user_presence_logs (workspace_id, user_id, status, started_at)
           VALUES ($1, $2, $3, now())`,
          [workspaceId, userId, newStatus]
        );
      }
    } catch (err) {
      console.warn('[Presence] Error logging transition to DB:', err.message);
    }
  }
}

/**
 * Called when a user connects a new socket.
 */
export function onUserConnected(workspaceId, userId, socketId, io) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  const wasEmpty = userSockets.get(userId).size === 0;
  userSockets.get(userId).add(socketId);

  const existing = userPresence.get(userId);
  if (!existing || existing.status === 'off' || wasEmpty) {
    userPresence.set(userId, {
      status: 'online',
      lastActive: Date.now(),
      manual: false,
    });
    logPresenceTransition(workspaceId, userId, 'online').catch(() => {});
  } else {
    userPresence.set(userId, {
      ...existing,
      lastActive: Date.now(),
    });
  }

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
      userPresence.set(userId, {
        status: 'off',
        lastActive: Date.now(),
        manual: false,
      });
      logPresenceTransition(workspaceId, userId, 'off').catch(() => {});
    }
  }

  if (io && workspaceId) {
    broadcastWorkspacePresence(io, workspaceId);
  }
}

/**
 * Set user status explicitly (online or away).
 * Offline status is strictly automatic when all sockets disconnect.
 */
export async function setUserPresence(workspaceId, userId, status, io) {
  const valid = ['online', 'away'];
  if (!valid.includes(status)) return;

  userPresence.set(userId, {
    status,
    lastActive: Date.now(),
    manual: true,
  });

  await logPresenceTransition(workspaceId, userId, status);

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

      const lastActive =
        presenceInfo?.lastActive || (member.lastLoginAt ? new Date(member.lastLoginAt).getTime() : null);

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
      online: membersWithPresence.filter((m) => m.status === 'online').length,
      away: membersWithPresence.filter((m) => m.status === 'away').length,
      off: membersWithPresence.filter((m) => m.status === 'off').length,
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

/**
 * Helper to resolve period date range boundaries
 */
function resolvePeriodRange(period = 'today', customStart, customEnd) {
  const now = new Date();
  let start = new Date();
  let end = new Date();

  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
    end = new Date();
  } else if (period === 'yesterday') {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
  } else if (period === '7days') {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    end = new Date();
  } else if (period === '30days') {
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    end = new Date();
  } else if (period === 'custom' && customStart) {
    start = new Date(customStart);
    end = customEnd ? new Date(customEnd) : new Date();
    if (isNaN(start.getTime())) {
      start = new Date();
      start.setHours(0, 0, 0, 0);
    }
  } else {
    start.setHours(0, 0, 0, 0);
    end = new Date();
  }

  return { start, end };
}

/**
 * Aggregates presence metrics across members of a workspace for a chosen period.
 */
export async function getWorkspacePresenceMetrics(workspaceId, options = {}) {
  const { period = 'today', startDate, endDate } = options;
  const { start, end } = resolvePeriodRange(period, startDate, endDate);

  const members = await listWorkspaceMembers(workspaceId);
  const startTime = start.getTime();
  const endTime = end.getTime();
  const totalPeriodSeconds = Math.max(1, Math.floor((endTime - startTime) / 1000));

  let dbLogs = [];
  if (isConfigured()) {
    try {
      const { rows } = await query(
        `SELECT id, workspace_id, user_id, status, started_at, ended_at, duration_seconds
         FROM user_presence_logs
         WHERE workspace_id = $1
           AND (
             (started_at >= $2 AND started_at <= $3)
             OR (ended_at IS NULL AND started_at <= $3)
             OR (ended_at >= $2 AND started_at <= $3)
           )
         ORDER BY started_at DESC`,
        [workspaceId, start, end]
      );
      dbLogs = rows;
    } catch (err) {
      console.warn('[Presence] Error querying presence metrics from DB:', err.message);
      dbLogs = [];
    }
  }

  const logsToUse =
    dbLogs && dbLogs.length > 0
      ? dbLogs
      : inMemoryPresenceLogs.filter(
          (l) =>
            l.workspaceId === workspaceId &&
            ((new Date(l.startedAt).getTime() >= startTime && new Date(l.startedAt).getTime() <= endTime) ||
              (!l.endedAt && new Date(l.startedAt).getTime() <= endTime) ||
              (new Date(l.endedAt).getTime() >= startTime && new Date(l.startedAt).getTime() <= endTime))
        );

  const nowMs = Date.now();

  const membersMetrics = members.map((member) => {
    const activeSockets = userSockets.get(member.uid);
    const isConnected = activeSockets && activeSockets.size > 0;
    const presenceInfo = userPresence.get(member.uid);
    const liveStatus = isConnected ? presenceInfo?.status || 'online' : 'off';

    const userLogs = logsToUse.filter(
      (l) => (l.user_id || l.userId) === member.uid
    );

    let onlineSec = 0;
    let awaySec = 0;
    let offSec = 0;
    let sessionsCount = 0;

    userLogs.forEach((log) => {
      const logStart = new Date(log.started_at || log.startedAt).getTime();
      const rawEnd =
        log.ended_at || log.endedAt
          ? new Date(log.ended_at || log.endedAt).getTime()
          : Math.min(nowMs, endTime);
      const logEnd = Math.max(logStart, rawEnd);

      const effectiveStart = Math.max(logStart, startTime);
      const effectiveEnd = Math.min(logEnd, endTime);

      if (effectiveEnd > effectiveStart) {
        const dur = Math.floor((effectiveEnd - effectiveStart) / 1000);
        const st = log.status;
        if (st === 'online') {
          onlineSec += dur;
          sessionsCount++;
        } else if (st === 'away') {
          awaySec += dur;
        } else if (st === 'off') {
          offSec += dur;
        }
      }
    });

    // Baseline fallback if logs are brand new and user is currently connected
    if (onlineSec === 0 && awaySec === 0 && offSec === 0) {
      if (liveStatus === 'online') {
        onlineSec = Math.min(
          totalPeriodSeconds,
          Math.floor((nowMs - (presenceInfo?.lastActive || nowMs - 600000)) / 1000)
        );
        sessionsCount = 1;
      }
    }

    const accounted = onlineSec + awaySec + offSec;
    if (accounted < totalPeriodSeconds) {
      offSec += totalPeriodSeconds - accounted;
    }

    const totalActive = onlineSec + awaySec;
    const uptimePercent =
      totalPeriodSeconds > 0
        ? Math.min(100, Math.round((onlineSec / totalPeriodSeconds) * 1000) / 10)
        : 0;

    const formattedTimeline = userLogs.slice(0, 20).map((l) => ({
      id: l.id,
      status: l.status,
      startedAt: l.started_at || l.startedAt,
      endedAt: l.ended_at || l.endedAt || (isConnected ? null : new Date()),
      durationSeconds:
        l.duration_seconds ||
        l.durationSeconds ||
        Math.floor((nowMs - new Date(l.started_at || l.startedAt).getTime()) / 1000),
    }));

    return {
      uid: member.uid,
      name: member.name || member.email?.split('@')[0] || 'Team Member',
      email: member.email,
      role: member.isSupervisor ? 'Owner' : 'Agent',
      isSupervisor: member.isSupervisor,
      liveStatus,
      onlineSeconds: onlineSec,
      awaySeconds: awaySec,
      offlineSeconds: offSec,
      totalActiveSeconds: totalActive,
      uptimePercent,
      sessionsCount,
      lastLoginAt: member.lastLoginAt,
      lastActive: presenceInfo?.lastActive || member.lastLoginAt,
      timeline: formattedTimeline,
    };
  });

  membersMetrics.sort((a, b) => b.onlineSeconds - a.onlineSeconds);

  const totalTeamOnlineSec = membersMetrics.reduce((sum, m) => sum + m.onlineSeconds, 0);
  const totalTeamAwaySec = membersMetrics.reduce((sum, m) => sum + m.awaySeconds, 0);
  const totalTeamOfflineSec = membersMetrics.reduce((sum, m) => sum + m.offlineSeconds, 0);
  const avgOnlinePerMember =
    membersMetrics.length > 0 ? Math.round(totalTeamOnlineSec / membersMetrics.length) : 0;

  const onlineNowCount = membersMetrics.filter((m) => m.liveStatus === 'online').length;
  const awayNowCount = membersMetrics.filter((m) => m.liveStatus === 'away').length;
  const offNowCount = membersMetrics.filter((m) => m.liveStatus === 'off').length;

  return {
    period,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    totalPeriodSeconds,
    summary: {
      totalMembers: membersMetrics.length,
      onlineNowCount,
      awayNowCount,
      offNowCount,
      totalTeamOnlineSec,
      totalTeamAwaySec,
      totalTeamOfflineSec,
      avgOnlinePerMember,
      mostActiveMember: membersMetrics[0] || null,
    },
    members: membersMetrics,
  };
}
