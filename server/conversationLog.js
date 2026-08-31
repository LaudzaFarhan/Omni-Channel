import { MESSAGES_PER_CHAT } from './store.js';

// Conversation log aggregation.
//
// Pure on purpose: it takes the two maps it needs and returns the response body, with no
// store, request or socket involved. That is what makes it checkable against a real
// store snapshot without standing up the server, a database and a WhatsApp session.
//
// It replaced a per-agent grouping that was redundant in two ways once more than one
// person answered anything:
//
//   * The agent was the outer level, so a customer two teammates had both replied to
//     appeared once under each of them, and there was no single place to read one
//     customer's history.
//   * Agents were keyed `uid || name:<name>`, and messages stamped by the first version
//     of the attribution feature carry a name with no uid — so one teammate rendered as
//     two identical-looking rows.
//
// Here the conversation is the subject and the agents are a detail inside it, and
// name-only stamps are resolved to a uid first so a person is counted once.

const toMs = (message) => {
  const seconds = Number(message?.messageTimestamp);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
};

/**
 * Learn name -> uid across the whole store.
 *
 * Without this, a teammate whose early messages carry only a name splits into two
 * agents. Built from every chat before any grouping happens, because the message that
 * proves the mapping may live in a different conversation than the one being grouped.
 */
function buildUidByName(messagesByJid) {
  const uidByName = new Map();
  for (const messages of Object.values(messagesByJid)) {
    for (const message of messages || []) {
      if (!message?.key?.fromMe) continue;
      if (message.agentUid && message.agentName && !uidByName.has(message.agentName)) {
        uidByName.set(message.agentName, message.agentUid);
      }
    }
  }
  return uidByName;
}

/**
 * One entry per conversation, newest activity first, plus team totals.
 *
 * Two honesty constraints shape the result. Only the last MESSAGES_PER_CHAT messages per
 * chat are retained, and only messages sent after attribution shipped carry an agent
 * name. So `initiatedBy` is 'unknown' rather than a guess whenever the window is full —
 * the oldest message still held is then not the one that opened the conversation — and
 * `unattributedOutgoing` reports our own messages that cannot be tied to anyone.
 */
export function buildConversationLog({ messages: messagesByJid = {}, chats = {} } = {}) {
  const uidByName = buildUidByName(messagesByJid);

  const conversations = [];
  const rosterByKey = new Map();
  let unattributedOutgoing = 0;

  for (const [jid, messages] of Object.entries(messagesByJid)) {
    if (!messages || messages.length === 0) continue;

    const chat = chats[jid] || {};
    const agentsByKey = new Map();

    let incoming = 0;
    let outgoing = 0;
    let firstTs = null;
    let lastTs = null;
    let firstCustomerTs = null;
    let firstReplyTs = null;
    let openedByCustomer = null;
    let chatUnattributed = 0;

    // The store keeps each chat sorted oldest-first, so the first entry is the oldest
    // message retained and the first inbound one is the earliest customer message in the
    // window. Timestamps are still compared rather than assumed, because a history sync
    // can deliver out of order.
    for (const message of messages) {
      const fromMe = !!message?.key?.fromMe;
      const ms = toMs(message);

      if (openedByCustomer === null) openedByCustomer = !fromMe;
      if (ms !== null) {
        if (firstTs === null || ms < firstTs) firstTs = ms;
        if (lastTs === null || ms > lastTs) lastTs = ms;
      }

      if (!fromMe) {
        incoming++;
        if (ms !== null && firstCustomerTs === null) firstCustomerTs = ms;
        continue;
      }

      outgoing++;

      // The team's first answer to the customer's opening message. Guarded on the
      // customer having spoken first, so a conversation we opened ourselves cannot
      // report a negative response time.
      if (ms !== null && firstCustomerTs !== null && firstReplyTs === null && ms >= firstCustomerTs) {
        firstReplyTs = ms;
      }

      const name = message.agentName || null;
      const uid = message.agentUid || (name ? uidByName.get(name) || null : null);

      // Ours but unattributable: sent from the phone, by a bot, or before attribution
      // existed. Counted rather than dropped, so the client can say the picture is
      // partial instead of quietly under-reporting the team.
      if (!name && !uid) {
        chatUnattributed++;
        unattributedOutgoing++;
        continue;
      }

      const key = uid || `name:${name}`;

      let agent = agentsByKey.get(key);
      if (!agent) {
        agent = { uid, name: name || 'Agen', count: 0, lastTs: null };
        agentsByKey.set(key, agent);
      }
      // Keep the most recently seen name, since it can be edited over time.
      if (name) agent.name = name;
      agent.count++;
      if (ms !== null && (agent.lastTs === null || ms > agent.lastTs)) agent.lastTs = ms;

      let roster = rosterByKey.get(key);
      if (!roster) {
        roster = { uid, name: name || 'Agen', messages: 0, conversations: 0, lastTs: null };
        rosterByKey.set(key, roster);
      }
      if (name) roster.name = name;
      roster.messages++;
      if (ms !== null && (roster.lastTs === null || ms > roster.lastTs)) roster.lastTs = ms;
      // This agent's first message in THIS chat, so the counter is distinct conversations
      // rather than messages.
      if (agent.count === 1) roster.conversations++;
    }

    const windowFull = messages.length >= MESSAGES_PER_CHAT;

    conversations.push({
      jid,
      // Fallback label for a chat that has aged out of the client's own list. The client
      // still prefers its own resolution, which knows about saved contact names.
      name: chat.name || null,
      phoneNumber: chat.phoneNumber || null,
      isGroup: jid.endsWith('@g.us'),

      initiatedBy: windowFull ? 'unknown' : (openedByCustomer ? 'customer' : 'us'),
      windowFull,

      firstTs,
      firstCustomerTs,
      firstReplyTs,
      responseMs: firstCustomerTs !== null && firstReplyTs !== null
        ? firstReplyTs - firstCustomerTs
        : null,
      lastTs,

      lastMessage: chat.lastMessage || null,
      lastFromMe: !!chat.lastMessageFromMe,
      unreadCount: Number(chat.unreadCount) || 0,

      incoming,
      outgoing,
      total: incoming + outgoing,
      unattributedOutgoing: chatUnattributed,
      // Most active answerer first, so the row names whoever owns it in practice.
      agents: [...agentsByKey.values()].sort((a, b) => b.count - a.count),
    });
  }

  // Most recent activity first: this is a log, so recency is the useful order.
  conversations.sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0));

  // Headline numbers describe customers only. A group is not a customer, and mixing the
  // two produced counts that disagreed with the rows on screen.
  const customers = conversations.filter(c => !c.isGroup);

  return {
    conversations,
    agents: [...rosterByKey.values()].sort((a, b) => (b.lastTs || 0) - (a.lastTs || 0)),
    totals: {
      conversations: conversations.length,
      customers: customers.length,
      customerInitiated: customers.filter(c => c.initiatedBy === 'customer').length,
      // The customer wrote and nobody has answered in the retained window. The one number
      // here that asks for action.
      awaitingReply: customers.filter(c => c.incoming > 0 && c.outgoing === 0).length,
      incoming: conversations.reduce((sum, c) => sum + c.incoming, 0),
      outgoing: conversations.reduce((sum, c) => sum + c.outgoing, 0),
      unattributedOutgoing,
    },
    retainedPerChat: MESSAGES_PER_CHAT,
  };
}
