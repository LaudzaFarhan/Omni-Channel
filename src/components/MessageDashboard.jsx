import React, { useState, useEffect, useMemo, useRef } from 'react';
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

  // Fullscreen lives here rather than in ChatWindow because the element that expands has
  // to hold the chat list too — switching conversations while expanded is the whole point,
  // and the list is a sibling of ChatWindow, not a child. The button stays in the
  // conversation header; only the state moved.
  //
  // `nativeFullscreen` is written only by the fullscreenchange listener, never by the
  // toggle. Esc and F11 leave fullscreen without going through the button, so a
  // hand-tracked flag would leave the icon showing the wrong state.
  //
  // `fallbackFullscreen` handles the Fullscreen API being absent or refused (an iframe
  // without allow="fullscreen", or a permissions policy), so the button is never dead.
  const fullscreenRef = useRef(null);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = useState(false);
  const isFullscreen = nativeFullscreen || fallbackFullscreen;

  const toggleFullscreen = () => {
    if (isFullscreen) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (nativeFullscreen && exit) Promise.resolve(exit.call(document)).catch(() => {});
      setFallbackFullscreen(false);
      return;
    }
    const el = fullscreenRef.current;
    const request = el && (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
    if (!request) {
      setFallbackFullscreen(true);
      return;
    }
    // On success the listener below sets the state, not this call.
    Promise.resolve(request.call(el)).catch(() => setFallbackFullscreen(true));
  };

  useEffect(() => {
    const sync = () => {
      const el = document.fullscreenElement || document.webkitFullscreenElement || null;
      setNativeFullscreen(!!el && el === fullscreenRef.current);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  // Only the fallback needs an Escape handler; native fullscreen exits on its own.
  useEffect(() => {
    if (!fallbackFullscreen) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setFallbackFullscreen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fallbackFullscreen]);

  // Switching tabs unmounts this, which must not strand the app under a fixed overlay.
  useEffect(() => () => {
    if (document.fullscreenElement === fullscreenRef.current) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(document)).catch(() => {});
    }
  }, []);

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
    // This wrapper exists to be the fullscreen element. It replaces a fragment, so it has
    // to reproduce the row layout the two panels previously got from App's flex container.
    <div
      ref={fullscreenRef}
      className={`chat-fullscreen-root ${fallbackFullscreen ? 'chat-fullscreen-fallback' : ''}`}
      style={{ display: 'flex', flex: 1, height: '100%', minWidth: 0 }}
    >
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
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          // Forwarding needs somewhere to forward TO, and the chat list lives here.
          chats={chats}
        />
      ) : (
        <div className="empty-chat-window" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-main)' }}>
          <div className="empty-chat-content" style={{ textAlign: 'center' }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '10px' }}>WhatsApp CRM</h2>
            <p style={{ color: 'var(--text-dimmed)' }}>Select a chat to start messaging</p>
          </div>
        </div>
      )}
    </div>
  );
}
