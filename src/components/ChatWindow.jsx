import React, { useState, useEffect, useRef } from 'react';
import { Send, FileText, Calendar, Clock, Smile, PanelRight, AlertCircle, Plus, X, Pencil, Trash2, Loader2, Paperclip, Check, CheckCheck, Tag, ChevronDown } from 'lucide-react';
import { fetchWithAuth, db } from '../utils/firebase.js';
import { doc, updateDoc, increment } from 'firebase/firestore';
import { PRESET_TAGS, getTag, setTag as saveTag, createCustomTag } from '../utils/contactTags.js';

const DEFAULT_QUICK_REPLIES = [
  { id: 'welcome', title: '👋 Welcome Message', text: 'Hello! Thank you for contacting us. How can we assist you today?' },
  { id: 'hours', title: '🕒 Business Hours', text: 'Our operating hours are Monday to Friday, 9:00 AM to 6:00 PM. We will get back to you as soon as possible.' },
  { id: 'payment', title: '💳 Payment Details', text: 'We accept Bank Transfer and Credit Cards. Please send your payment receipt once completed so we can process your order.' },
  { id: 'thank_you', title: '💖 Thank You', text: 'Thank you for choosing us! If you have any further questions, feel free to reach out anytime.' },
];

const QR_STORAGE_KEY = 'whatsapp_quick_replies';

const formatMessageText = (text) => {
  if (!text) return '';

  let formatted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
    
  // Bold: *text*
  formatted = formatted.replace(/\*(.*?)\*/g, '<strong>$1</strong>');
  // Italic: _text_
  formatted = formatted.replace(/_(.*?)_/g, '<em>$1</em>');
  // Strikethrough: ~text~
  formatted = formatted.replace(/~(.*?)~/g, '<del>$1</del>');
  // Monospace: ```text```
  formatted = formatted.replace(/```(.*?)```/gs, '<code>$1</code>');
  
  // Clickable links
  const urlPattern = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
  formatted = formatted.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #34b7f1; text-decoration: underline;">$1</a>');

  return <span dangerouslySetInnerHTML={{ __html: formatted }} />;
};

function loadQuickReplies() {
  try {
    const stored = localStorage.getItem(QR_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('Failed to load quick replies:', e);
  }
  return DEFAULT_QUICK_REPLIES;
}

function saveQuickReplies(replies) {
  try {
    localStorage.setItem(QR_STORAGE_KEY, JSON.stringify(replies));
  } catch (e) {
    console.error('Failed to save quick replies:', e);
  }
}

if (!window.__mediaCache) {
  window.__mediaCache = {};
}
const mediaCache = window.__mediaCache; // msgId -> string URL or Promise

function MediaMessage({ msg, activeSessionId }) {
  const msgId = msg.key.id;
  const [mediaUrl, setMediaUrl] = useState(mediaCache[msgId] && typeof mediaCache[msgId] === 'string' ? mediaCache[msgId] : null);
  const [loading, setLoading] = useState(!mediaCache[msgId] || typeof mediaCache[msgId] !== 'string');
  const [error, setError] = useState(false);
  
  const content = msg.message;
  const isImage = !!content?.imageMessage;
  const isVideo = !!content?.videoMessage;
  const isAudio = !!content?.audioMessage;
  const isDocument = !!content?.documentMessage;
  const isSticker = !!content?.stickerMessage;
  
  const fileName = content?.documentMessage?.fileName || 'document';

  useEffect(() => {
    let active = true;

    if (mediaCache[msgId]) {
      if (typeof mediaCache[msgId] === 'string') {
        setMediaUrl(mediaCache[msgId]);
        setLoading(false);
      } else {
        // It is a Promise currently downloading, wait for it
        mediaCache[msgId].then(url => {
          if (active) {
            setMediaUrl(url);
            setLoading(false);
          }
        }).catch(err => {
          if (active) setError(true);
        });
      }
      return;
    }

    const fetchMedia = async () => {
      setLoading(true);
      setError(false);
      
      const downloadPromise = (async () => {
        const res = await fetchWithAuth(`/api/media/download?sessionId=${activeSessionId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ message: msg })
        });
        
        if (!res.ok) throw new Error('Failed to download media');
        
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        mediaCache[msgId] = url; // Save string to cache
        return url;
      })();

      mediaCache[msgId] = downloadPromise; // Save promise to cache

      try {
        const url = await downloadPromise;
        if (active) {
          setMediaUrl(url);
        }
      } catch (err) {
        console.error('Error fetching media:', err);
        delete mediaCache[msgId]; // Remove from cache on failure so retry can happen
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchMedia();

    return () => {
      active = false;
    };
  }, [msgId, activeSessionId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', color: 'var(--text-dimmed)', fontSize: '0.85rem' }}>
        <Loader2 size={16} className="spin-icon" style={{ color: 'var(--primary)' }} />
        <span>Downloading media...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0', color: '#ef4444', fontSize: '0.85rem' }}>
        <AlertCircle size={16} />
        <span>Failed to load media</span>
      </div>
    );
  }

  if (!mediaUrl) return null;

  if (isImage || isSticker) {
    return (
      <div className="media-image-wrapper" style={{ marginTop: '4px', maxWidth: '280px', borderRadius: '8px', overflow: 'hidden' }}>
        <img 
          src={mediaUrl} 
          alt="WhatsApp Media" 
          style={{ width: '100%', height: 'auto', display: 'block', maxHeight: '300px', objectFit: 'contain', cursor: 'pointer', borderRadius: '6px' }}
          onClick={() => window.open(mediaUrl, '_blank')}
        />
        {(content?.imageMessage?.caption || content?.stickerMessage?.caption) && (
          <div style={{ padding: '8px 4px 4px 4px', fontSize: '0.9rem', color: 'var(--text-main)', wordBreak: 'break-word' }}>
            {formatMessageText(content.imageMessage?.caption || content.stickerMessage?.caption)}
          </div>
        )}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="media-video-wrapper" style={{ marginTop: '4px', maxWidth: '280px', borderRadius: '8px', overflow: 'hidden' }}>
        <video 
          src={mediaUrl} 
          controls 
          style={{ width: '100%', maxHeight: '300px', display: 'block', borderRadius: '6px' }}
        />
        {content?.videoMessage?.caption && (
          <div style={{ padding: '8px 4px 4px 4px', fontSize: '0.9rem', color: 'var(--text-main)', wordBreak: 'break-word' }}>
            {formatMessageText(content.videoMessage.caption)}
          </div>
        )}
      </div>
    );
  }

  if (isAudio) {
    return (
      <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <audio src={mediaUrl} controls style={{ maxWidth: '240px', height: '40px' }} />
      </div>
    );
  }

  if (isDocument) {
    return (
      <div style={{ marginTop: '4px', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: 'rgba(0,0,0,0.03)', borderRadius: '8px', maxWidth: '280px' }}>
        <FileText size={24} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {fileName}
          </div>
          <a 
            href={mediaUrl} 
            download={fileName}
            style={{ fontSize: '0.8rem', color: 'var(--primary)', textDecoration: 'underline', fontWeight: '500' }}
          >
            Download
          </a>
        </div>
      </div>
    );
  }

  return null;
}

function hasMedia(msg) {
  const content = msg.message;
  if (!content) return false;
  return !!(content.imageMessage || content.videoMessage || content.audioMessage || content.documentMessage || content.stickerMessage);
}

export default function ChatWindow({ activeChat, messages, setMessages, userProfile, user, activeSessionId, userInfo }) {
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [showQuickReplies, setShowQuickReplies] = useState(true);
  const [quickReplies, setQuickReplies] = useState(loadQuickReplies);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingReply, setEditingReply] = useState(null); // null or reply id
  const [formTitle, setFormTitle] = useState('');
  const [formText, setFormText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Tag state
  const [currentTag, setCurrentTag] = useState(null);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [customTagInput, setCustomTagInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const tagDropdownRef = useRef(null);

  // Load tag when active chat changes
  useEffect(() => {
    if (activeChat?.id) {
      setCurrentTag(getTag(activeChat.id));
      setShowTagDropdown(false);
      setShowCustomInput(false);
    }
  }, [activeChat?.id]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target)) {
        setShowTagDropdown(false);
        setShowCustomInput(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectTag = (tag) => {
    saveTag(activeChat.id, tag);
    setCurrentTag(tag);
    setShowTagDropdown(false);
    setShowCustomInput(false);
  };

  const handleRemoveTag = () => {
    saveTag(activeChat.id, null);
    setCurrentTag(null);
    setShowTagDropdown(false);
  };

  const handleSaveCustomTag = () => {
    if (!customTagInput.trim()) return;
    const tag = createCustomTag(customTagInput.trim());
    saveTag(activeChat.id, tag);
    setCurrentTag(tag);
    setCustomTagInput('');
    setShowCustomInput(false);
    setShowTagDropdown(false);
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check size limit: 20MB
    if (file.size > 20 * 1024 * 1024) {
      alert("File is too large. Please select a file smaller than 20MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSelectedFile({
        name: file.name,
        type: file.type,
        base64: reader.result
      });
    };
    reader.onerror = (error) => {
      console.error('Error reading file:', error);
      alert('Failed to read file.');
    };
    reader.readAsDataURL(file);
  };

  // Persist quick replies on change
  useEffect(() => {
    saveQuickReplies(quickReplies);
  }, [quickReplies]);

  // Auto-scroll to bottom of messages container
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Extract text body from Baileys message structure
  const getMessageText = (msg) => {
    const content = msg.message;
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (content.conversation) return content.conversation;
    if (content.extendedTextMessage) return content.extendedTextMessage.text;
    if (content.imageMessage) return '📷 Photo';
    if (content.videoMessage) return '🎥 Video';
    if (content.audioMessage) return '🎵 Audio';
    if (content.documentMessage) return '📄 Document';
    return '[Media or Unsupported Message]';
  };

  // Render WhatsApp status checks next to message time for outgoing messages
  const renderMessageStatus = (msg) => {
    if (!msg.key.fromMe) return null;
    const status = msg.status;
    
    // Status 3 (READ) or 4 (PLAYED) -> Double blue check
    if (status === 3 || status === 4 || status === 'READ' || status === 'PLAYED') {
      return <CheckCheck size={14} style={{ color: '#34b7f1', marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;
    }
    
    // Status 2 (DELIVERY_ACK) -> Double gray check
    if (status === 2 || status === 'DELIVERY_ACK') {
      return <CheckCheck size={14} style={{ color: 'rgba(255, 255, 255, 0.6)', marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;
    }
    
    // Status 1 (SERVER_ACK) or undefined/pending -> Single check
    return <Check size={14} style={{ color: 'rgba(255, 255, 255, 0.6)', marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;
  };

  // Format display name for a chat contact
  const getDisplayName = (chat) => {
    if (!chat) return '';
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

  // Format message timestamps (Epoch in seconds -> readable)
  const formatMsgTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleSend = async (textToSend) => {
    const text = textToSend || inputText;
    if ((!text.trim() && !selectedFile) || sending) return;

    // Check limit
    const limit = userProfile?.messageLimit ?? 500;
    const sent = userProfile?.messagesSent || 0;
    if (userProfile && userProfile.role !== 'admin' && sent >= limit) {
      alert("You have reached your subscription limit for sending messages.");
      return;
    }

    setSending(true);
    try {
      const payload = {
        to: activeChat.id,
        text: text,
        sessionId: activeSessionId
      };

      if (selectedFile) {
        payload.file = selectedFile;
      }

      const res = await fetchWithAuth('/api/messages/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.success) {
        if (!textToSend) setInputText(''); // clear input if not quick reply
        setSelectedFile(null); // clear file attachment
        if (fileInputRef.current) fileInputRef.current.value = '';
        
        // Increment message limit in Firestore
        if (user && userProfile && userProfile.role !== 'admin') {
          try {
            const userRef = doc(db, 'users', user.uid);
            await updateDoc(userRef, {
              messagesSent: increment(1)
            });
          } catch (e) {
            console.error('Failed to increment message usage:', e);
          }
        }
      } else {
        alert(`Failed to send: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error sending message:', err);
      alert('Failed to send message. Connection issues.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Quick Reply CRUD
  const openAddForm = () => {
    setFormTitle('');
    setFormText('');
    setEditingReply(null);
    setShowAddForm(true);
  };

  const openEditForm = (reply) => {
    setFormTitle(reply.title);
    setFormText(reply.text);
    setEditingReply(reply.id);
    setShowAddForm(true);
  };

  const handleSaveReply = () => {
    if (!formTitle.trim() || !formText.trim()) return;

    if (editingReply) {
      // Update existing
      setQuickReplies(prev => 
        prev.map(r => r.id === editingReply 
          ? { ...r, title: formTitle.trim(), text: formText.trim() } 
          : r
        )
      );
    } else {
      // Add new
      const newReply = {
        id: `custom_${Date.now()}`,
        title: formTitle.trim(),
        text: formText.trim(),
      };
      setQuickReplies(prev => [...prev, newReply]);
    }
    setShowAddForm(false);
    setEditingReply(null);
    setFormTitle('');
    setFormText('');
  };

  const handleDeleteReply = (id) => {
    setQuickReplies(prev => prev.filter(r => r.id !== id));
  };

  const handleCancelForm = () => {
    setShowAddForm(false);
    setEditingReply(null);
    setFormTitle('');
    setFormText('');
  };

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%' }}>
      {/* Active Conversation Area */}
      <div className="chat-window">
        {/* Header */}
        <div className="chat-window-header">
          <div className="header-user-info">
            <div className="header-avatar">
              {(activeChat.name || activeChat.id).substring(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="header-name" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {getDisplayName(activeChat)}
                {currentTag && (
                  <span style={{
                    fontSize: '0.65rem',
                    fontWeight: '600',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    color: currentTag.color,
                    background: currentTag.bg,
                    border: `1px solid ${currentTag.color}22`,
                    whiteSpace: 'nowrap'
                  }}>
                    {currentTag.label}
                  </span>
                )}
              </div>
              <div className="header-status">
                {activeChat.id.endsWith('@g.us') 
                  ? 'Group Chat' 
                  : activeChat.phoneNumber 
                    ? activeChat.phoneNumber 
                    : getDisplayName(activeChat)}
              </div>
            </div>
          </div>
          <div className="header-actions" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {/* Tag Selector */}
            <div style={{ position: 'relative' }} ref={tagDropdownRef}>
              <button 
                className="icon-button" 
                onClick={() => setShowTagDropdown(!showTagDropdown)}
                title="Set Contact Tag"
                style={{ 
                  color: currentTag ? currentTag.color : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px'
                }}
              >
                <Tag size={17} />
                <ChevronDown size={12} />
              </button>

              {showTagDropdown && (
                <div style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '6px',
                  background: 'var(--bg-sidebar)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '10px',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  zIndex: 100,
                  width: '200px',
                  overflow: 'hidden'
                }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-dimmed)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Set Tag
                  </div>
                  {PRESET_TAGS.map(tag => (
                    <button
                      key={tag.value}
                      onClick={() => handleSelectTag(tag)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        border: 'none',
                        background: currentTag?.value === tag.value ? tag.bg : 'transparent',
                        color: 'var(--text-main)',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={e => e.target.style.background = tag.bg}
                      onMouseLeave={e => e.target.style.background = currentTag?.value === tag.value ? tag.bg : 'transparent'}
                    >
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                      {tag.label}
                      {currentTag?.value === tag.value && (
                        <Check size={14} style={{ marginLeft: 'auto', color: tag.color }} />
                      )}
                    </button>
                  ))}

                  {/* Custom Tag Option */}
                  {!showCustomInput ? (
                    <button
                      onClick={() => setShowCustomInput(true)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        border: 'none',
                        background: currentTag?.value === 'custom' ? 'rgba(139, 92, 246, 0.12)' : 'transparent',
                        color: 'var(--text-main)',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={e => e.target.style.background = 'rgba(139, 92, 246, 0.08)'}
                      onMouseLeave={e => e.target.style.background = currentTag?.value === 'custom' ? 'rgba(139, 92, 246, 0.12)' : 'transparent'}
                    >
                      <Pencil size={12} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                      Custom Tag...
                    </button>
                  ) : (
                    <div style={{ padding: '8px 10px', display: 'flex', gap: '6px' }}>
                      <input
                        type="text"
                        value={customTagInput}
                        onChange={(e) => setCustomTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveCustomTag()}
                        placeholder="Type tag name..."
                        autoFocus
                        style={{
                          flex: 1,
                          padding: '6px 8px',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          background: 'var(--bg-main)',
                          color: 'var(--text-main)',
                          fontSize: '0.78rem',
                          outline: 'none'
                        }}
                      />
                      <button
                        onClick={handleSaveCustomTag}
                        style={{
                          padding: '4px 8px',
                          background: '#8b5cf6',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {/* Remove Tag */}
                  {currentTag && (
                    <button
                      onClick={handleRemoveTag}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        border: 'none',
                        borderTop: '1px solid var(--border-color)',
                        background: 'transparent',
                        color: '#ef4444',
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                      onMouseEnter={e => e.target.style.background = 'rgba(239, 68, 68, 0.08)'}
                      onMouseLeave={e => e.target.style.background = 'transparent'}
                    >
                      <X size={14} />
                      Remove Tag
                    </button>
                  )}
                </div>
              )}
            </div>

            <button 
              className="icon-button" 
              onClick={() => setShowQuickReplies(!showQuickReplies)}
              title="Toggle Quick Replies"
              style={{ color: showQuickReplies ? 'var(--primary)' : 'var(--text-muted)' }}
            >
              <PanelRight size={20} />
            </button>
          </div>
        </div>

        {/* Message Bubble List */}
        <div className="messages-container">
          {messages.map((msg, index) => {
            const isMe = msg.key.fromMe;
            const text = getMessageText(msg);
            const isGroup = activeChat.id.endsWith('@g.us');
            
            // For free tier, restrict message visibility to the last 7 days
            const limitTimestamp = Date.now() / 1000 - (7 * 24 * 60 * 60);
            const isFreeTier = userProfile && userProfile.role !== 'admin' && (userProfile.tier || 'free') === 'free';
            if (isFreeTier && msg.messageTimestamp < limitTimestamp) {
              return null;
            }

            // Skip empty system messages if there are any
            if (!text) return null;

            // Get sender info for group chats
            let senderName = null;
            let senderColor = '#999';
            if (isGroup && !isMe) {
              // Try pushName first, then participantPn phone, then participant LID
              if (msg.pushName) {
                senderName = msg.pushName;
              } else if (msg.key.participantPn) {
                senderName = '+' + msg.key.participantPn.split('@')[0];
              } else if (msg.key.participant) {
                const pid = msg.key.participant.split('@')[0];
                senderName = /^\d+$/.test(pid) ? 'WhatsApp User' : pid;
              }

              // Generate a stable color for each sender
              if (msg.key.participant || msg.key.participantPn) {
                const senderId = msg.key.participant || msg.key.participantPn;
                const senderColors = [
                  '#e15d44', '#009b77', '#dd4124', '#45b8ac', '#5b5ea6',
                  '#9b2335', '#dfcfbe', '#55b4b0', '#e15d44', '#7fcdcd',
                  '#bc243c', '#c3447a', '#98b4d4', '#e0b589', '#6667ab'
                ];
                let hash = 0;
                for (let i = 0; i < senderId.length; i++) {
                  hash = senderId.charCodeAt(i) + ((hash << 5) - hash);
                }
                senderColor = senderColors[Math.abs(hash) % senderColors.length];
              }
            }

            // Get sender initials for the mini avatar
            const getSenderInitials = () => {
              if (!senderName || senderName === 'WhatsApp User') return 'WU';
              const clean = senderName.replace(/[^a-zA-Z0-9 ]/g, '').trim();
              if (!clean) return 'WU';
              const parts = clean.split(' ');
              if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
              return parts[0].substring(0, 2).toUpperCase();
            };

            return (
              <div 
                key={msg.key.id || index}
                className={`message-bubble-wrapper ${isMe ? 'sent' : 'received'}`}
              >
                {/* Mini avatar for group received messages */}
                {isGroup && !isMe && (
                  <div 
                    className="msg-sender-avatar" 
                    style={{ backgroundColor: senderColor }}
                    title={senderName || 'Unknown'}
                  >
                    {getSenderInitials()}
                  </div>
                )}
                <div className="message-bubble">
                  {/* Sender name label for group chats */}
                  {isGroup && !isMe && senderName && (
                    <div className="msg-sender-name" style={{ color: senderColor }}>
                      {senderName}
                    </div>
                  )}
                  {hasMedia(msg) ? (
                    <MediaMessage msg={msg} activeSessionId={activeSessionId} />
                  ) : (
                    formatMessageText(text)
                  )}
                  <span className="message-time">
                    {formatMsgTime(msg.messageTimestamp)}
                    {isMe && renderMessageStatus(msg)}
                  </span>
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {selectedFile && (
          <div className="file-preview-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', background: 'rgba(0,168,132,0.05)', borderTop: '1px solid var(--border-color)', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
              <FileText size={18} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.85rem', fontWeight: '500', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedFile.name}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)' }}>
                ({selectedFile.type || 'Unknown type'})
              </span>
            </div>
            <button 
              onClick={() => {
                setSelectedFile(null);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
              style={{ background: 'none', border: 'none', color: 'var(--text-dimmed)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Message Input Box */}
        <div className="chat-window-input-bar" style={{ position: 'relative' }}>
          {userProfile && userProfile.role !== 'admin' && (userProfile.messagesSent || 0) >= (userProfile.messageLimit ?? 500) && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(255,255,255,0.8)', zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontWeight: '600', gap: '8px' }}>
              <AlertCircle size={18} /> Usage limit reached. Upgrade your plan to send more messages.
            </div>
          )}
          <button 
            className="icon-button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            disabled={sending}
            style={{ color: 'var(--text-muted)', marginRight: '8px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '4px' }}
          >
            <Paperclip size={20} />
          </button>
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            disabled={sending}
          />
          <input 
            type="text" 
            placeholder="Type a message..." 
            className="chat-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyPress}
            disabled={sending || (userProfile && userProfile.role !== 'admin' && (userProfile.messagesSent || 0) >= (userProfile.messageLimit ?? 500))}
          />
          <button 
            className="send-button"
            onClick={() => handleSend()}
            disabled={sending || (!inputText.trim() && !selectedFile) || (userProfile && userProfile.role !== 'admin' && (userProfile.messagesSent || 0) >= (userProfile.messageLimit ?? 500))}
          >
            <Send size={18} />
          </button>
        </div>
      </div>

      {/* Right Sidebar - Quick Replies Template Drawer */}
      <div className={`quick-replies-panel ${!showQuickReplies ? 'hidden' : ''}`}>
        <div className="qr-panel-header">
          <h3>⚡ Quick Replies</h3>
          <button 
            className="qr-add-btn" 
            onClick={openAddForm}
            title="Add custom quick reply"
          >
            <Plus size={18} />
          </button>
        </div>

        {/* Add/Edit Form */}
        {showAddForm && (
          <div className="qr-form">
            <div className="qr-form-header">
              <span>{editingReply ? 'Edit Reply' : 'New Quick Reply'}</span>
              <button className="qr-form-close" onClick={handleCancelForm}>
                <X size={16} />
              </button>
            </div>
            <input 
              type="text"
              className="qr-form-input"
              placeholder="Title (e.g. 🎉 Promo)"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              maxLength={50}
            />
            <textarea
              className="qr-form-textarea"
              placeholder="Message text..."
              value={formText}
              onChange={(e) => setFormText(e.target.value)}
              rows={3}
              maxLength={500}
            />
            <div className="qr-form-actions">
              <button className="qr-form-cancel" onClick={handleCancelForm}>Cancel</button>
              <button 
                className="qr-form-save" 
                onClick={handleSaveReply}
                disabled={!formTitle.trim() || !formText.trim()}
              >
                {editingReply ? 'Update' : 'Add Reply'}
              </button>
            </div>
          </div>
        )}

        <div className="quick-replies-list">
          {quickReplies.map(reply => (
            <div key={reply.id} className="quick-reply-card">
              <button 
                className="quick-reply-btn"
                onClick={() => handleSend(reply.text)}
                disabled={sending}
                title={reply.text}
              >
                <div className="quick-reply-title">{reply.title}</div>
                <div className="quick-reply-text">{reply.text}</div>
              </button>
              <div className="quick-reply-actions">
                <button 
                  className="qr-action-btn edit" 
                  onClick={() => openEditForm(reply)}
                  title="Edit"
                >
                  <Pencil size={13} />
                </button>
                <button 
                  className="qr-action-btn delete" 
                  onClick={() => handleDeleteReply(reply.id)}
                  title="Delete"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
