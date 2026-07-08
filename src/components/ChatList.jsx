import React from 'react';
import { Search, Plus, Check, CheckCheck } from 'lucide-react';
import { loadAllTags } from '../utils/contactTags.js';

export default function ChatList({ chats, searchQuery, setSearchQuery, activeChatJid, setActiveChatJid, userInfo }) {
  // Load contact tags (reactively updated via custom event)
  const [contactTags, setContactTags] = React.useState(loadAllTags);

  React.useEffect(() => {
    const handleTagsUpdated = () => setContactTags(loadAllTags());
    window.addEventListener('contact-tags-updated', handleTagsUpdated);
    return () => window.removeEventListener('contact-tags-updated', handleTagsUpdated);
  }, []);

  // Format timestamps into user-friendly times
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  // Get initials for profile placeholder
  const getInitials = (name) => {
    if (!name) return 'WA';
    const clean = name.replace(/[^a-zA-Z0-9 ]/g, '').trim();
    if (!clean) return 'WA';
    const parts = clean.split(' ');
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
  };

  // Format display name for a chat contact
  const getDisplayName = (chat) => {
    if (userInfo && userInfo.id) {
      const myCleanId = userInfo.id.split('@')[0].split(':')[0];
      const chatCleanId = chat.id.split('@')[0].split(':')[0];
      if (myCleanId === chatCleanId) {
        return '(YOU)';
      }
    }

    const name = chat.name || '';
    const cleanId = chat.id.split('@')[0];
    const isLid = chat.id.endsWith('@lid');

    // If name is a real text name (not just digits), use it directly
    if (name && !/^\d+$/.test(name.trim())) {
      return name;
    }

    // If we have a resolved phone number from LID mapping, show it
    if (chat.phoneNumber) {
      return chat.phoneNumber;
    }

    // For standard @s.whatsapp.net contacts, prepend +
    if (chat.id.endsWith('@s.whatsapp.net') && /^\d+$/.test(cleanId)) {
      return '+' + cleanId;
    }

    // For unresolved LID contacts (no phone, no name), show friendly label
    if (isLid) {
      return 'WhatsApp User';
    }

    // Fallback
    return name || cleanId;
  };

  // Filter chats by name or JID (phone number)
  const filteredChats = chats.filter(chat => {
    const name = (chat.name || '').toLowerCase();
    const id = (chat.id || '').toLowerCase();
    const query = searchQuery.toLowerCase();
    return name.includes(query) || id.includes(query);
  });

  // Check if search query looks like a phone number to allow initiating a chat
  const isPhoneNumberQuery = /^\+?\d{8,15}$/.test(searchQuery.trim());
  const cleanSearchQuery = searchQuery.replace(/\D/g, '');

  return (
    <>
      {/* Search Box */}
      <div className="search-container">
        <div className="search-input-wrapper">
          <Search className="search-icon" />
          <input 
            type="text" 
            placeholder="Search or start new chat..." 
            className="search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Chat List Scroll Box */}
      <ul className="chat-list">
        {isPhoneNumberQuery && !filteredChats.some(c => c.id.split('@')[0] === cleanSearchQuery) && (
          <li 
            className="chat-item start-new-chat-item"
            style={{ 
              border: '1px dashed var(--primary)', 
              borderRadius: '12px', 
              margin: '8px 12px', 
              padding: '12px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '10px', 
              cursor: 'pointer', 
              background: 'rgba(16,185,129,0.04)' 
            }}
            onClick={() => {
              setActiveChatJid(`${cleanSearchQuery}@s.whatsapp.net`);
              setSearchQuery('');
            }}
          >
            <Plus size={18} style={{ color: 'var(--primary)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: '600', fontSize: '0.88rem', color: 'var(--primary)' }}>Start new chat</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)' }}>+{cleanSearchQuery}</div>
            </div>
          </li>
        )}

        {filteredChats.length > 0 ? (
          filteredChats.map(chat => {
            const isActive = chat.id === activeChatJid;
            const hasUnread = chat.unreadCount > 0;
            
            // Compute a stable pastel background color for contact avatars
            const getAvatarColor = (jid) => {
              const colors = [
                '#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', 
                '#e8c4ff', '#ffd3e8', '#d6ffd6', '#ffe5cc', '#ccf2ff'
              ];
              let hash = 0;
              for (let i = 0; i < jid.length; i++) {
                hash = jid.charCodeAt(i) + ((hash << 5) - hash);
              }
              const index = Math.abs(hash) % colors.length;
              return colors[index];
            };

            return (
              <li 
                key={chat.id}
                className={`chat-item ${isActive ? 'active' : ''}`}
                onClick={() => setActiveChatJid(chat.id)}
              >
                <div className="chat-avatar-wrapper">
                  <div 
                    className="chat-avatar" 
                    style={{ backgroundColor: getAvatarColor(chat.id), color: '#2c3e50', fontWeight: '700' }}
                  >
                    {getInitials(chat.name || chat.id)}
                  </div>
                  {hasUnread && !isActive && (
                    <span className="chat-badge-avatar">{chat.unreadCount}</span>
                  )}
                </div>
                <div className="chat-info">
                  <div className="chat-name-row">
                    <span className="chat-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {getDisplayName(chat)}
                      {contactTags[chat.id] && (
                        <span style={{
                          fontSize: '0.58rem',
                          fontWeight: '600',
                          padding: '1px 6px',
                          borderRadius: '8px',
                          color: contactTags[chat.id].color,
                          background: contactTags[chat.id].bg,
                          whiteSpace: 'nowrap',
                          lineHeight: '1.4'
                        }}>
                          {contactTags[chat.id].label}
                        </span>
                      )}
                    </span>
                    <span className="chat-time">{formatTime(chat.lastMessageTimestamp)}</span>
                  </div>
                  <div className="chat-last-msg-row" style={{ display: 'flex', alignItems: 'center' }}>
                    {chat.lastMessageFromMe && (
                      <span style={{ marginRight: '4px', display: 'inline-flex', alignSelf: 'center', flexShrink: 0 }}>
                        {chat.lastMessageStatus === 3 || chat.lastMessageStatus === 4 || chat.lastMessageStatus === 'READ' || chat.lastMessageStatus === 'PLAYED' ? (
                          <CheckCheck size={15} style={{ color: '#34b7f1' }} />
                        ) : chat.lastMessageStatus === 2 || chat.lastMessageStatus === 'DELIVERY_ACK' ? (
                          <CheckCheck size={15} style={{ color: 'var(--text-dimmed)' }} />
                        ) : (
                          <Check size={15} style={{ color: 'var(--text-dimmed)' }} />
                        )}
                      </span>
                    )}
                    <span className="chat-last-msg" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                      {chat.lastMessage || 'No messages yet'}
                    </span>
                  </div>
                </div>
              </li>
            );
          })
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-dimmed)', padding: '40px 20px', fontSize: '0.9rem' }}>
            {searchQuery ? 'No chats found matching your search' : 'Waiting for chat sync...'}
          </div>
        )}
      </ul>
    </>
  );
}
