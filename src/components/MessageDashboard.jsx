import React, { useState, useEffect, useMemo } from 'react';
import ChatList from './ChatList.jsx';
import ChatWindow from './ChatWindow.jsx';
import StatsPanel from './StatsPanel.jsx';
import ChatFilterPills from './dashboard/ChatFilterPills.jsx';
import { loadAllTags, loadGlobalCustomTags, PRESET_TAGS } from '../utils/contactTags.js';
import { fetchChatStatuses } from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';

export default function MessageDashboard({
  chats,
  setChats,
  searchQuery,
  setSearchQuery,
  activeChatJid,
  setActiveChatJid,
  activeChat,
  messages,
  setMessages,
  userInfo,
  userProfile,
  user,
  onLogout,
  activeSessionId,
  // Saved contact names keyed by chat JID, so the chat list and the conversation
  // header agree with the contacts page. `savedContacts` carries the whole record
  // for the chat window's save/edit button.
  savedNames = {},
  savedContacts = {}
}) {
  // One filter at a time: { kind: 'all' | 'status' | 'tag', value }. A single selection
  // rather than independent toggles, because combining "Closed Won" with a tag produces
  // an empty list far more often than a useful one.
  const [filter, setFilter] = useState({ kind: 'all' });
  const [contactTags, setContactTags] = useState(loadAllTags());
  const [globalCustomTags, setGlobalCustomTags] = useState(loadGlobalCustomTags());

  // Commercial state per chat JID, from chat_settings. Absent means 'prospect'.
  const [chatStatuses, setChatStatuses] = useState({});

  // Listen to tag updates to keep counts reactive
  useEffect(() => {
    const handleTagsUpdated = () => {
      setContactTags(loadAllTags());
      setGlobalCustomTags(loadGlobalCustomTags());
    };
    window.addEventListener('contact-tags-updated', handleTagsUpdated);
    return () => window.removeEventListener('contact-tags-updated', handleTagsUpdated);
  }, []);

  // Statuses, plus live updates when anyone in the workspace moves a conversation.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const list = await fetchChatStatuses(activeSessionId);
        if (cancelled) return;
        const map = {};
        list.forEach(({ chatJid, status }) => { map[chatJid] = status; });
        setChatStatuses(map);
      } catch (err) {
        // A missing status map degrades to "everything is a prospect", which is the
        // default anyway, so this must not break the chat list.
        console.info('[Chats] Could not load statuses:', err.message);
      }
    };
    load();

    const handleStatus = (settings) => {
      if (!settings?.chatJid) return;
      setChatStatuses(prev => ({ ...prev, [settings.chatJid]: settings.status }));
    };

    let attached = null;
    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('chat-status-updated', handleStatus);
      attached = null;
      if (socket) {
        socket.on('chat-status-updated', handleStatus);
        attached = socket;
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (attached) attached.off('chat-status-updated', handleStatus);
    };
  }, [activeSessionId]);

  const statusOf = (jid) => chatStatuses[jid] || 'prospect';

  // Counts for the pills.
  const statusCounts = useMemo(() => {
    const counts = { prospect: 0, closed_won: 0, dropped: 0 };
    chats.forEach((chat) => {
      const s = statusOf(chat.id);
      if (counts[s] !== undefined) counts[s]++;
    });
    return counts;
  }, [chats, chatStatuses]);

  const tagCounts = useMemo(() => {
    const counts = {};
    [...PRESET_TAGS, ...globalCustomTags].forEach(tag => {
      counts[tag.label.toLowerCase()] = 0;
    });
    chats.forEach((chat) => {
      (contactTags[chat.id] || []).forEach((t) => {
        const key = t.label.toLowerCase();
        counts[key] = (counts[key] || 0) + 1;
      });
    });
    return counts;
  }, [chats, contactTags, globalCustomTags]);

  return (
    <>
      <div className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Filter pills. Replaced a grid of stat cards that ate ~110px before a single
            conversation was visible. */}
        <ChatFilterPills
          filter={filter}
          onChange={setFilter}
          totalCount={chats.length}
          statusCounts={statusCounts}
          tags={[...PRESET_TAGS, ...globalCustomTags]}
          tagCounts={tagCounts}
        />
        {/* Chats List Section */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <ChatList 
            chats={chats}
            setChats={setChats}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            activeChatJid={activeChatJid}
            setActiveChatJid={setActiveChatJid}
            userInfo={userInfo}
            selectedTagFilter={filter.kind === 'tag' ? filter.value : null}
            statusFilter={filter.kind === 'status' ? filter.value : null}
            chatStatuses={chatStatuses}
            savedNames={savedNames}
          />
        </div>
      </div>
      {activeChat ? (
        <ChatWindow 
          activeChat={activeChat} 
          messages={messages} 
          setMessages={setMessages} 
          userProfile={userProfile}
          user={user}
          activeSessionId={activeSessionId}
          userInfo={userInfo}
          savedNames={savedNames}
          savedContacts={savedContacts}
        />
      ) : (
        <div className="empty-chat-window" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-main)' }}>
          <div className="empty-chat-content" style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>WhatsApp CRM</h2>
            <p style={{ color: 'var(--text-dimmed)' }}>Select a chat to start messaging</p>
          </div>
        </div>
      )}
    </>
  );
}
