import React from 'react';
import { Search, Plus, Check, CheckCheck } from 'lucide-react';
import { loadAllTags } from '../utils/contactTags.js';
import { getChatDisplayName, getInitials } from '../utils/displayName.js';

export default function ChatList({ chats, setChats, searchQuery, setSearchQuery, activeChatJid, setActiveChatJid, userInfo, selectedTagFilter, savedNames = {}, statusFilter = null, chatStatuses = {} }) {
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

  // Naming/initials come from the shared helper so every view agrees. A name from
  // the operator's own contacts outranks whatever WhatsApp reported.
  const getDisplayName = (chat) => getChatDisplayName(chat, userInfo, savedNames[chat.id]);

  // Filter chats by name or JID (phone number) and selected tag filter
  const filteredChats = chats.filter(chat => {
    const name = (chat.name || '').toLowerCase();
    const id = (chat.id || '').toLowerCase();
    const phoneNumber = (chat.phoneNumber || '').toLowerCase();
    // Searching for a customer by the name YOU saved has to work, otherwise the
    // contact list and the chat list disagree about who this is.
    const saved = (savedNames[chat.id] || '').toLowerCase();
    const query = searchQuery.toLowerCase().trim();
    
    // Check match by raw query (case-insensitive name, id, or phone number)
    let isMatched = name.includes(query) || id.includes(query) || phoneNumber.includes(query) || saved.includes(query);
    
    // Also support matching by cleaned digits if the query contains numbers
    const queryDigits = query.replace(/\D/g, ''); // Extract only digits
    if (!isMatched && queryDigits.length > 0) {
      const idDigits = id.replace(/\D/g, '');
      const phoneDigits = phoneNumber.replace(/\D/g, '');
      const nameDigits = name.replace(/\D/g, '');
      isMatched = idDigits.includes(queryDigits) || phoneDigits.includes(queryDigits) || nameDigits.includes(queryDigits);
    }
    
    if (!isMatched) return false;

    if (selectedTagFilter) {
      const tagsForChat = contactTags[chat.id] || [];
      return tagsForChat.some(t => t.label.toLowerCase() === selectedTagFilter.toLowerCase());
    }

    // Commercial state. An absent entry means 'prospect', so a conversation nobody has
    // touched still appears under New Leads — which is the point of that filter.
    if (statusFilter) {
      return (chatStatuses[chat.id] || 'prospect') === statusFilter;
    }

    return true;
  });

  // Check if search query looks like a phone number to allow initiating a chat
  const isPhoneNumberQuery = /^\+?\d{8,15}$/.test(searchQuery.trim());
  let normalizedDigits = searchQuery.replace(/\D/g, '');
  if (normalizedDigits.startsWith('0')) {
    normalizedDigits = '62' + normalizedDigits.substring(1);
  }

  const handleStartNewChat = (targetDigits) => {
    if (!targetDigits) return;
    const targetJid = `${targetDigits}@s.whatsapp.net`;
    if (setChats && !chats.some(c => c.id === targetJid)) {
      const draftChat = {
        id: targetJid,
        name: '+' + targetDigits,
        lastMessage: 'New chat initiated',
        lastMessageTimestamp: Date.now(),
        unreadCount: 0,
        isDraft: true
      };
      setChats(prev => [draftChat, ...prev]);
    }
    setActiveChatJid(targetJid);
    setSearchQuery('');
  };

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
        {isPhoneNumberQuery && !filteredChats.some(c => c.id.split('@')[0] === normalizedDigits) && (
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
              background: 'var(--primary-subtle)'
            }}
            onClick={() => handleStartNewChat(normalizedDigits)}
          >
            <Plus size={18} style={{ color: 'var(--primary)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: '600', fontSize: '0.88rem', color: 'var(--primary)' }}>Start new chat</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-dimmed)' }}>+{normalizedDigits}</div>
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
                    {getInitials(getDisplayName(chat))}
                  </div>
                  {hasUnread && !isActive && (
                    <span className="chat-badge-avatar">{chat.unreadCount}</span>
                  )}
                </div>
                <div className="chat-info">
                  <div className="chat-name-row">
                    <span className="chat-name" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {getDisplayName(chat)}
                      </span>
                      {contactTags[chat.id] && (
                        <span style={{ display: 'inline-flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
                          {Array.isArray(contactTags[chat.id]) ? (
                            contactTags[chat.id].map((tag, idx) => (
                              <span key={idx} style={{
                                fontSize: '0.58rem',
                                fontWeight: '600',
                                padding: '1px 6px',
                                borderRadius: '8px',
                                color: tag.color,
                                background: tag.bg,
                                whiteSpace: 'nowrap',
                                lineHeight: '1.4'
                              }}>
                                {tag.label}
                              </span>
                            ))
                          ) : (
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
                      )}
                    </span>
                    <span className="chat-time">{formatTime(chat.lastMessageTimestamp)}</span>
                  </div>
                  <div className="chat-last-msg-row" style={{ display: 'flex', alignItems: 'center' }}>
                    {chat.lastMessageFromMe && (
                      <span style={{ marginRight: '4px', display: 'inline-flex', alignSelf: 'center', flexShrink: 0 }}>
                        {chat.lastMessageStatus === 3 || chat.lastMessageStatus === 4 || chat.lastMessageStatus === 'READ' || chat.lastMessageStatus === 'PLAYED' ? (
                          <CheckCheck size={15} style={{ color: 'var(--wa-read-receipt)', filter: 'drop-shadow(0 0 1px var(--wa-read-receipt-outline))' }} />
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
