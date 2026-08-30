import React, { useState, useEffect } from 'react';
import ChatList from './ChatList.jsx';
import ChatWindow from './ChatWindow.jsx';
import StatsPanel from './StatsPanel.jsx';
import { loadAllTags, loadGlobalCustomTags, PRESET_TAGS } from '../utils/contactTags.js';

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
  const [selectedTagFilter, setSelectedTagFilter] = useState(null);
  const [contactTags, setContactTags] = useState(loadAllTags());
  const [globalCustomTags, setGlobalCustomTags] = useState(loadGlobalCustomTags());

  // Listen to tag updates to keep counts reactive
  useEffect(() => {
    const handleTagsUpdated = () => {
      setContactTags(loadAllTags());
      setGlobalCustomTags(loadGlobalCustomTags());
    };
    window.addEventListener('contact-tags-updated', handleTagsUpdated);
    return () => window.removeEventListener('contact-tags-updated', handleTagsUpdated);
  }, []);

  // Calculate tag counts based on current chats list
  const totalLeads = chats.length;
  const tagCounts = {};

  // Initialize counts for preset tags
  PRESET_TAGS.forEach(tag => {
    tagCounts[tag.label.toLowerCase()] = 0;
  });

  // Initialize counts for global custom tags
  globalCustomTags.forEach(tag => {
    tagCounts[tag.label.toLowerCase()] = 0;
  });

  // Calculate counts
  chats.forEach(chat => {
    const tagsForChat = contactTags[chat.id] || [];
    tagsForChat.forEach(t => {
      const key = t.label.toLowerCase();
      tagCounts[key] = (tagCounts[key] || 0) + 1;
    });
  });

  return (
    <>
      <div className="sidebar" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Categories Section */}
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-dimmed)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '12px' }}>
            Categories
          </div>
          <div style={{ maxHeight: '60px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', paddingRight: '2px', scrollbarWidth: 'none' }}>
            {/* Total Leads Card */}
            <div 
              onClick={() => setSelectedTagFilter(null)}
              style={{
                background: selectedTagFilter === null ? 'rgba(0, 168, 132, 0.08)' : 'var(--bg-main)',
                border: `1px solid ${selectedTagFilter === null ? 'var(--primary)' : 'var(--border-color)'}`,
                borderRadius: '8px',
                padding: '8px 12px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                minHeight: '52px',
                boxSizing: 'border-box'
              }}
              onMouseEnter={e => {
                if (selectedTagFilter !== null) e.currentTarget.style.borderColor = 'var(--text-dimmed)';
              }}
              onMouseLeave={e => {
                if (selectedTagFilter !== null) e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
            >
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)', fontWeight: '600' }}>Total Leads</span>
              <span style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main)', marginTop: '2px' }}>{totalLeads}</span>
            </div>

            {/* Preset Tag Cards */}
            {PRESET_TAGS.map(tag => {
              const isSelected = selectedTagFilter === tag.label.toLowerCase();
              const count = tagCounts[tag.label.toLowerCase()] || 0;
              return (
                <div 
                  key={tag.value}
                  onClick={() => setSelectedTagFilter(isSelected ? null : tag.label.toLowerCase())}
                  style={{
                    background: isSelected ? tag.bg : 'var(--bg-main)',
                    border: `1px solid ${isSelected ? tag.color : 'var(--border-color)'}`,
                    borderRadius: '8px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '52px',
                    boxSizing: 'border-box'
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = tag.color;
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tag.label}
                    </span>
                  </div>
                  <span style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main)', marginTop: '2px' }}>{count}</span>
                </div>
              );
            })}

            {/* Global Custom Tag Cards */}
            {globalCustomTags.map(tag => {
              const isSelected = selectedTagFilter === tag.label.toLowerCase();
              const count = tagCounts[tag.label.toLowerCase()] || 0;
              return (
                <div 
                  key={tag.value}
                  onClick={() => setSelectedTagFilter(isSelected ? null : tag.label.toLowerCase())}
                  style={{
                    background: isSelected ? tag.bg : 'var(--bg-main)',
                    border: `1px solid ${isSelected ? tag.color : 'var(--border-color)'}`,
                    borderRadius: '8px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minHeight: '52px',
                    boxSizing: 'border-box'
                  }}
                  onMouseEnter={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = tag.color;
                  }}
                  onMouseLeave={e => {
                    if (!isSelected) e.currentTarget.style.borderColor = 'var(--border-color)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' }}>
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)', fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {tag.label}
                    </span>
                  </div>
                  <span style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main)', marginTop: '2px' }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

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
            selectedTagFilter={selectedTagFilter}
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
