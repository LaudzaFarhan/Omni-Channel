import React from 'react';
import ChatList from './ChatList.jsx';
import ChatWindow from './ChatWindow.jsx';
import StatsPanel from './StatsPanel.jsx';

export default function MessageDashboard({
  chats,
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
  activeSessionId
}) {
  return (
    <>
      <div className="sidebar">
        <ChatList 
          chats={chats}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          activeChatJid={activeChatJid}
          setActiveChatJid={setActiveChatJid}
          userInfo={userInfo}
        />
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
