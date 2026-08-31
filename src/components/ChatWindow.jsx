import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Send, FileText, Calendar, Clock, Smile, PanelRight, AlertCircle, Plus, X, Pencil, Trash2, Loader2, Paperclip, Check, CheckCheck, Tag, ChevronDown, ChevronRight, Pause, Play, UserPlus, UserCheck, MoreVertical, Search, Trophy, UserMinus, RotateCcw } from 'lucide-react';
import { fetchWithAuth, saveContact, updateContact, setChatStatus as apiSetChatStatus } from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';
import { showToast } from '../utils/toastBus.js';
import { PRESET_TAGS, getTags, toggleTag, clearTags, createCustomTag, loadGlobalCustomTags, addGlobalCustomTag, deleteGlobalCustomTag } from '../utils/contactTags.js';
import { getChatDisplayName, getInitials } from '../utils/displayName.js';
import { jidToPhone, formatPhone } from '../utils/phone.js';
import ContactEditor from './contacts/ContactEditor.jsx';

const DEFAULT_QUICK_REPLIES = [
  { id: 'welcome', title: '👋 Welcome Message', text: 'Hello! Thank you for contacting us. How can we assist you today?' },
  { id: 'hours', title: '🕒 Business Hours', text: 'Our operating hours are Monday to Friday, 9:00 AM to 6:00 PM. We will get back to you as soon as possible.' },
  { id: 'payment', title: '💳 Payment Details', text: 'We accept Bank Transfer and Credit Cards. Please send your payment receipt once completed so we can process your order.' },
  { id: 'thank_you', title: '💖 Thank You', text: 'Thank you for choosing us! If you have any further questions, feel free to reach out anytime.' },
];

const QR_STORAGE_KEY = 'whatsapp_quick_replies';

// Commercial state of a conversation. 'prospect' is the default and has no badge —
// every untouched chat is a prospect, so badging it would badge everything.
const STATUS_LABELS = {
  prospect: { badge: null, toast: 'Dikembalikan ke prospek' },
  closed_won: { badge: 'Closed Won', toast: 'Ditandai Closed Won' },
  dropped: { badge: 'Bukan prospek', toast: 'Dihapus dari prospek' },
};

const STATUS_STYLE = {
  closed_won: { color: 'var(--primary)', bg: 'rgba(0,168,132,0.12)', border: 'rgba(0,168,132,0.3)' },
  dropped: { color: 'var(--text-dimmed)', bg: 'var(--overlay-subtle)', border: 'var(--border-color)' },
};

// A short, deliberate set rather than a full emoji picker. A picker is a large
// dependency or a large component, and the overwhelming majority of business replies
// reach for a handful of these.
const QUICK_EMOJI = [
  '👍', '🙏', '😊', '😁', '❤️', '🔥', '✅', '❌',
  '🎉', '😢', '😅', '🤝', '💰', '📦', '⏰', '📝',
];

/** Day label for a message's date, in the customer's own words. */
function dayLabel(timestampSeconds) {
  const ms = Number(timestampSeconds) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return null;

  const date = new Date(ms);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) return 'Hari Ini';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Kemarin';

  // Within the last week, the weekday alone is more readable than a date.
  if (now - date < 7 * 86400000) {
    return date.toLocaleDateString('id-ID', { weekday: 'long' });
  }
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

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

// Rows of the header overflow menu. Extracted only because there are five of them and
// the inline styles would otherwise be repeated verbatim five times.
function MenuItem({ icon, label, trailing, onClick, disabled }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: '11px', width: '100%',
        padding: '10px 14px', border: 'none', background: 'transparent',
        color: disabled ? 'var(--text-dimmed)' : 'var(--text-main)',
        fontSize: '0.85rem', fontFamily: 'inherit', textAlign: 'left',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--overlay-subtle)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {icon}
      <span style={{ flex: 1 }}>{label}</span>
      {trailing}
    </button>
  );
}

function MenuDivider() {
  return <div style={{ height: '1px', background: 'var(--border-color)', margin: '2px 0' }} />;
}

function hasMedia(msg) {
  const content = msg.message;
  if (!content) return false;
  return !!(content.imageMessage || content.videoMessage || content.audioMessage || content.documentMessage || content.stickerMessage);
}

export default function ChatWindow({ activeChat, messages, setMessages, userProfile, user, activeSessionId, userInfo, savedNames = {}, savedContacts = {} }) {
  // Saving the person you are talking to is the main way contacts get created —
  // expecting the operator to copy a number over to the contacts page instead
  // would mean the address book stays empty.
  const [editingContact, setEditingContact] = useState(false);
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

  // Agent hold: when a conversation is held, automated replies are suppressed so
  // a human can take over. Server-enforced; see /api/messages/send.
  const [holdState, setHoldState] = useState(null);
  const [holdBusy, setHoldBusy] = useState(false);

  // Overflow menu, and searching within this conversation's messages.
  const [showMenu, setShowMenu] = useState(false);
  const [showTagSubmenu, setShowTagSubmenu] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [messageQuery, setMessageQuery] = useState('');
  const menuRef = useRef(null);

  // Commercial state of the conversation. Arrives on the same chat_settings row as the
  // hold, so it is read from the same request.
  const [statusBusy, setStatusBusy] = useState(false);

  const [showEmoji, setShowEmoji] = useState(false);
  const emojiRef = useRef(null);

  // Explicit open state for the template picker, separate from the implicit '/' trigger.
  const [showTemplates, setShowTemplates] = useState(false);
  const templatesRef = useRef(null);

  // Load the hold state for whichever chat is open, and follow changes made in
  // another tab through the socket.
  useEffect(() => {
    if (!activeChat?.id) {
      setHoldState(null);
      return;
    }

    let cancelled = false;
    const jid = activeChat.id;

    (async () => {
      try {
        const res = await fetchWithAuth(
          `/api/chats/${encodeURIComponent(jid)}/hold?sessionId=${encodeURIComponent(activeSessionId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setHoldState(data);
      } catch (err) {
        console.info('Could not read hold state:', err.message);
      }
    })();

    // Hold and status share the chat_settings row, so one payload updates both.
    const handleSettingsUpdate = (settings) => {
      if (settings.chatJid === jid && settings.sessionId === activeSessionId) {
        setHoldState(settings);
      }
    };

    let attached = null;
    const unsubscribe = subscribeSocket((socket) => {
      if (attached) {
        attached.off('chat-hold-updated', handleSettingsUpdate);
        attached.off('chat-status-updated', handleSettingsUpdate);
      }
      attached = null;
      if (socket) {
        socket.on('chat-hold-updated', handleSettingsUpdate);
        socket.on('chat-status-updated', handleSettingsUpdate);
        attached = socket;
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      if (attached) {
        attached.off('chat-hold-updated', handleSettingsUpdate);
        attached.off('chat-status-updated', handleSettingsUpdate);
      }
    };
  }, [activeChat?.id, activeSessionId]);

  const isHeld = Boolean(holdState?.botPaused);
  // NULL in the column means untouched, which the server already maps to 'prospect'.
  const chatStatus = holdState?.status || 'prospect';

  // Close the overflow menu on an outside click or Escape, like the tag dropdown.
  useEffect(() => {
    if (!showMenu) return;

    const onPointerDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowMenu(false);
        setShowTagSubmenu(false);
      }
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { setShowMenu(false); setShowTagSubmenu(false); }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showMenu]);

  // Reset the per-conversation bits when the open chat changes: a search or an open
  // menu belonging to the previous conversation must not carry over.
  useEffect(() => {
    setShowMenu(false);
    setShowTagSubmenu(false);
    setShowSearch(false);
    setMessageQuery('');
    setShowTemplates(false);
    setShowEmoji(false);
  }, [activeChat?.id]);

  const handleSetStatus = async (next) => {
    if (!activeChat?.id || statusBusy) return;
    setStatusBusy(true);
    try {
      // The response carries the whole chat_settings row, so applying it directly keeps
      // the hold state in step as well.
      setHoldState(await apiSetChatStatus(activeChat.id, next, activeSessionId));
      setShowMenu(false);
      showToast({
        type: next === 'closed_won' ? 'success' : 'info',
        title: STATUS_LABELS[next].toast,
        message: getDisplayName(activeChat),
      });
    } catch (err) {
      showToast({
        type: 'error',
        title: 'Gagal mengubah status',
        message: err.message || 'Coba lagi.',
        duration: 5000,
      });
    } finally {
      setStatusBusy(false);
    }
  };

  const handleToggleHold = async () => {
    if (!activeChat?.id || holdBusy) return;
    setHoldBusy(true);
    const next = !isHeld;

    try {
      const res = await fetchWithAuth(`/api/chats/${encodeURIComponent(activeChat.id)}/hold`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botPaused: next, sessionId: activeSessionId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Server returned ${res.status}`);
      }

      // The socket event will also arrive, but applying the response directly
      // keeps the button responsive if the socket is down.
      setHoldState(await res.json());

      showToast({
        type: next ? 'info' : 'success',
        title: next ? 'Agent on hold' : 'Agent resumed',
        message: next
          ? 'Automated replies are paused for this conversation.'
          : 'Automated replies are active again for this conversation.',
      });
    } catch (err) {
      console.error('Failed to toggle hold:', err);
      showToast({
        type: 'error',
        title: 'Could not change hold state',
        message: err.message || 'Please try again.',
        duration: 5000,
      });
    } finally {
      setHoldBusy(false);
    }
  };

  // Tag state
  const [currentTags, setCurrentTags] = useState([]);
  const [globalCustomTags, setGlobalCustomTags] = useState(loadGlobalCustomTags());
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [customTagInput, setCustomTagInput] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const tagDropdownRef = useRef(null);

  // Load and sync tags when active chat changes or updates are dispatched
  useEffect(() => {
    const updateAllTags = () => {
      if (activeChat?.id) {
        setCurrentTags(getTags(activeChat.id));
      }
      setGlobalCustomTags(loadGlobalCustomTags());
    };
    
    updateAllTags();
    window.addEventListener('contact-tags-updated', updateAllTags);
    
    return () => {
      window.removeEventListener('contact-tags-updated', updateAllTags);
    };
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

  const handleToggleTag = (tag) => {
    toggleTag(activeChat.id, tag);
  };

  const handleRemoveSpecificTag = (tag) => {
    toggleTag(activeChat.id, tag);
  };

  const handleClearAllTags = () => {
    clearTags(activeChat.id);
    setShowTagDropdown(false);
  };

  const handleSaveCustomTag = () => {
    if (!customTagInput.trim()) return;
    const tag = createCustomTag(customTagInput.trim());
    addGlobalCustomTag(tag);
    toggleTag(activeChat.id, tag);
    setCustomTagInput('');
    setShowCustomInput(false);
  };

  const handleDeleteGlobalCustomTag = (e, tag) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to permanently delete the custom tag "${tag.label}"?`)) {
      deleteGlobalCustomTag(tag.label);
    }
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

  // Messages actually rendered. Declared HERE rather than with the other state because
  // it calls getMessageText above — a `const` arrow is not hoisted, so referencing it
  // from earlier in the body is a temporal-dead-zone error that no build step catches.
  //
  // Unfiltered unless a search is open with a query, so the normal path returns the same
  // array reference and costs nothing.
  const visibleMessages = useMemo(() => {
    const q = showSearch ? messageQuery.trim().toLowerCase() : '';
    if (!q) return messages;
    return messages.filter(m => getMessageText(m).toLowerCase().includes(q));
  }, [messages, messageQuery, showSearch]);

  // The template picker opens two ways, and they share one list.
  //
  // '/' filters as you type; the composer's template button opens it unfiltered. The
  // button used to toggle the quick-replies side drawer instead, which is a panel action
  // sitting on a composer control — the header's panel button is where that belongs.
  const slashQuery = inputText.startsWith('/') ? inputText.slice(1).trim().toLowerCase() : null;

  const templateMatches = useMemo(() => {
    if (!slashQuery) return quickReplies;
    return quickReplies.filter(r =>
      r.title.toLowerCase().includes(slashQuery) || r.text.toLowerCase().includes(slashQuery)
    );
  }, [slashQuery, quickReplies]);

  // Typing a slash opens it implicitly; the button opens it explicitly. Either counts.
  const templatesOpen = showTemplates || slashQuery !== null;

  const applyTemplate = (reply) => {
    setInputText(reply.text);
    setShowTemplates(false);
  };

  // Close the emoji tray on an outside click, like the other popovers.
  useEffect(() => {
    if (!showEmoji) return;
    const onPointerDown = (e) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target)) setShowEmoji(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setShowEmoji(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showEmoji]);

  // Same for the template picker, but only for the button-opened case. A '/' in the
  // composer keeps it open on purpose, and dismissing that on an outside click would
  // fight the text still sitting in the field.
  useEffect(() => {
    if (!showTemplates) return;

    const onPointerDown = (e) => {
      const insidePicker = templatesRef.current?.contains(e.target);
      // The composer, including the button that opened this, is not "outside".
      const insideComposer = e.target.closest?.('.chat-window-input-bar');
      if (!insidePicker && !insideComposer) setShowTemplates(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setShowTemplates(false); };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showTemplates]);

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

  // Naming comes from the shared helper so every view agrees. A saved contact name
  // beats the pushName WhatsApp reports.
  const getDisplayName = (chat) => (chat ? getChatDisplayName(chat, userInfo, savedNames[chat.id]) : '');

  // Whether this conversation is already in the address book, and the number to
  // pre-fill if it is not.
  //
  // A chat keyed by @lid only yields a phone number once WhatsApp has told us the
  // mapping (store.phoneNumber). Until then there is nothing to save, so the
  // button is hidden rather than opening a form the operator cannot complete.
  const savedContact = activeChat ? savedContacts[activeChat.id] : null;
  const contactPhone = activeChat
    ? (jidToPhone(activeChat.phoneNumber) || jidToPhone(activeChat.id))
    : null;
  const canSaveContact = Boolean(activeChat)
    && !activeChat.id.endsWith('@g.us')
    && Boolean(savedContact || contactPhone);

  // Second line of the header. Only shows the number when the name is something else,
  // otherwise it would print the same string twice.
  const headerSubtitle = useMemo(() => {
    if (!activeChat) return '';

    const name = getDisplayName(activeChat);
    const pretty = contactPhone ? formatPhone(contactPhone) : null;
    const shownDigits = String(name).replace(/\D/g, '');

    // The name already IS this number, in some formatting.
    if (pretty && shownDigits && shownDigits === contactPhone) {
      return savedContact ? pretty : 'Belum disimpan sebagai kontak';
    }
    return pretty || '';
  }, [activeChat, contactPhone, savedContact, savedNames]);

  const handleSaveContact = async (payload) => {
    if (savedContact?.id) {
      await updateContact(savedContact.id, payload);
      showToast({ type: 'success', title: 'Contact updated', message: payload.name || payload.phone });
    } else {
      await saveContact(payload);
      showToast({ type: 'success', title: 'Contact saved', message: payload.name || payload.phone });
    }
    // App reloads the list off the 'contacts-updated' socket event, so the header
    // and chat list pick the new name up without any local state here.
    setEditingContact(false);
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

        // The usage counter is no longer incremented here. The server consumes
        // the quota atomically as part of sending and pushes the new total over
        // the socket as 'quota-updated', so the browser cannot miscount or be
        // modified to skip the increment.
      } else if (res.status === 429) {
        // Server-side quota rejection. The local check above is only a courtesy;
        // this is the authoritative one.
        alert(data.error || 'Message quota reached. Upgrade your plan to send more messages.');
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

  // Last day heading printed, so the divider logic can look past messages the loop
  // discards (empty bodies, and free-tier messages older than 7 days). Local to this
  // render pass: comparing against visibleMessages[index - 1] instead would print a
  // heading for a day whose only message was skipped, and a module-level variable would
  // leak between conversations.
  let lastRenderedDay = null;

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%' }}>
      {/* Active Conversation Area */}
      <div className="chat-window">
        {/* Header */}
        <div className="chat-window-header">
          <div className="header-user-info">
            {/* Same helper the chat list uses. A raw substring(0,2) of the name gave
                "+6" for every unsaved number — identical for every such contact, and
                inconsistent with the list beside it, which shows the last two digits. */}
            <div className="header-avatar">
              {getInitials(getDisplayName(activeChat))}
            </div>
            <div>
              <div className="header-name" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span>{getDisplayName(activeChat)}</span>
                {currentTags && currentTags.map((tag, idx) => (
                  <span key={idx} style={{
                    fontSize: '0.65rem',
                    fontWeight: '600',
                    padding: '2px 8px',
                    borderRadius: '10px',
                    color: tag.color,
                    background: tag.bg,
                    border: `1px solid ${tag.color}22`,
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    {tag.label}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveSpecificTag(tag);
                      }}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: tag.color,
                        padding: 0,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        width: '12px',
                        height: '12px',
                        transition: 'background 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,0,0,0.06)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      title={`Remove tag ${tag.label}`}
                    >
                      <X size={10} style={{ pointerEvents: 'none' }} />
                    </button>
                  </span>
                ))}

                {/* Commercial state, next to the name so it is visible without opening
                    the menu. 'prospect' is deliberately unbadged: it is the default for
                    every conversation, so showing it would badge all of them. */}
                {STATUS_LABELS[chatStatus]?.badge && (
                  <span
                    title={holdState?.statusBy ? `Diubah oleh ${holdState.statusBy}` : undefined}
                    style={{
                      fontSize: '0.65rem', fontWeight: '700', padding: '2px 8px',
                      borderRadius: '10px', whiteSpace: 'nowrap',
                      color: STATUS_STYLE[chatStatus].color,
                      background: STATUS_STYLE[chatStatus].bg,
                      border: `1px solid ${STATUS_STYLE[chatStatus].border}`,
                    }}
                  >
                    {STATUS_LABELS[chatStatus].badge}
                  </span>
                )}
              </div>
              {/* The secondary line, which must not simply repeat the primary one.
                  An unsaved contact has no name, so getDisplayName returns the number —
                  and this line then printed the same number again. It now falls back to
                  the save prompt, which is both different information and the next
                  useful action. */}
              <div className="header-status">
                {activeChat.id.endsWith('@g.us')
                  ? 'Group Chat'
                  : headerSubtitle}
              </div>
            </div>
          </div>
          <div className="header-actions" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {/* Only shown while the contact is UNSAVED, where it is a call to action.
                Once saved, editing moves into the overflow menu — a permanent "Saved"
                button that merely reports state is a poor use of header space. */}
            {canSaveContact && !savedContact && (
              <button
                onClick={() => setEditingContact(true)}
                title="Simpan kontak ini"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 12px',
                  marginRight: '4px',
                  borderRadius: '8px',
                  fontSize: '0.78rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s',
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-muted)',
                }}
              >
                <UserPlus size={13} /> Simpan Kontak
              </button>
            )}

            {/* Agent hold: suppresses automated replies for this conversation */}
            <button
              onClick={handleToggleHold}
              disabled={holdBusy}
              aria-pressed={isHeld}
              title={isHeld
                ? 'Automated replies are paused for this chat. Click to let the agent resume.'
                : 'Pause automated replies so you can take over this conversation.'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                marginRight: '4px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                fontWeight: '600',
                cursor: holdBusy ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.2s',
                opacity: holdBusy ? 0.6 : 1,
                background: isHeld ? 'rgba(245,158,11,0.12)' : 'transparent',
                border: `1px solid ${isHeld ? 'rgba(245,158,11,0.35)' : 'var(--border-color)'}`,
                color: isHeld ? '#f59e0b' : 'var(--text-muted)',
              }}
            >
              {isHeld ? <><Play size={13} /> Resume Agent</> : <><Pause size={13} /> Hold Agent</>}
            </button>

            {/* Tag Selector */}
            <div style={{ position: 'relative' }} ref={tagDropdownRef}>
              <button 
                className="icon-button has-chevron" 
                onClick={() => setShowTagDropdown(!showTagDropdown)}
                title="Set Contact Tag"
                style={{ 
                  color: currentTags.length > 0 ? currentTags[0].color : 'var(--text-muted)',
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
                  width: '220px',
                  overflow: 'hidden'
                }}>
                  <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-color)', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-dimmed)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Set Tags
                  </div>
                  {PRESET_TAGS.map(tag => {
                    const isSelected = currentTags.some(t => t.label.toLowerCase() === tag.label.toLowerCase());
                    return (
                      <button
                        key={tag.value}
                        onClick={() => handleToggleTag(tag)}
                        style={{
                          width: '100%',
                          padding: '9px 12px',
                          border: 'none',
                          background: isSelected ? tag.bg : 'transparent',
                          color: 'var(--text-main)',
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = tag.bg}
                        onMouseLeave={e => e.currentTarget.style.background = isSelected ? tag.bg : 'transparent'}
                      >
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                        {tag.label}
                        {isSelected && (
                          <Check size={14} style={{ marginLeft: 'auto', color: tag.color }} />
                        )}
                      </button>
                    );
                  })}

                  {/* Global Custom Tags */}
                  {globalCustomTags.map(tag => {
                    const isSelected = currentTags.some(t => t.label.toLowerCase() === tag.label.toLowerCase());
                    return (
                      <div
                        key={tag.value}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          paddingRight: '8px',
                          background: isSelected ? tag.bg : 'transparent',
                          transition: 'background 0.15s'
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = tag.bg}
                        onMouseLeave={e => e.currentTarget.style.background = isSelected ? tag.bg : 'transparent'}
                      >
                        <button
                          onClick={() => handleToggleTag(tag)}
                          style={{
                            flex: 1,
                            padding: '9px 12px',
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-main)',
                            fontSize: '0.82rem',
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                          }}
                        >
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                            {tag.label}
                          </span>
                          {isSelected && (
                            <Check size={14} style={{ marginLeft: 'auto', color: tag.color, flexShrink: 0 }} />
                          )}
                        </button>
                        <button
                          onClick={(e) => handleDeleteGlobalCustomTag(e, tag)}
                          title="Delete Tag Globally"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '4px',
                            borderRadius: '4px',
                            transition: 'color 0.15s, background 0.15s'
                          }}
                          onMouseEnter={e => {
                            e.stopPropagation();
                            e.currentTarget.style.color = '#ef4444';
                            e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = 'var(--text-muted)';
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}

                  {/* Custom Tag Option */}
                  {!showCustomInput ? (
                    <button
                      onClick={() => setShowCustomInput(true)}
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-main)',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        transition: 'background 0.15s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(139, 92, 246, 0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <Pencil size={12} style={{ color: '#8b5cf6', flexShrink: 0 }} />
                      Custom Tag...
                    </button>
                  ) : (
                    <div style={{ padding: '8px 10px', display: 'flex', gap: '6px', boxSizing: 'border-box', width: '100%', alignItems: 'center' }}>
                      <input
                        type="text"
                        value={customTagInput}
                        onChange={(e) => setCustomTagInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSaveCustomTag()}
                        placeholder="Type tag name..."
                        autoFocus
                        style={{
                          flex: 1,
                          minWidth: 0,
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
                          padding: '6px 10px',
                          background: '#8b5cf6',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.78rem',
                          fontWeight: '600',
                          cursor: 'pointer',
                          flexShrink: 0
                        }}
                      >
                        Save
                      </button>
                    </div>
                  )}

                  {/* Clear All Tags */}
                  {currentTags.length > 0 && (
                    <button
                      onClick={handleClearAllTags}
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
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <X size={14} />
                      Clear All Tags
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Search within THIS conversation's messages. Filters what is already
                loaded — the store keeps the last 100 per chat, so there is nothing
                further back to search and no request to make. */}
            <button
              className="icon-button"
              onClick={() => {
                setShowSearch(v => !v);
                if (showSearch) setMessageQuery('');
              }}
              title="Cari dalam percakapan ini"
              aria-pressed={showSearch}
              style={{ color: showSearch ? 'var(--primary)' : 'var(--text-muted)' }}
            >
              <Search size={19} />
            </button>

            {/* Overflow menu. Actions that are occasional rather than per-message live
                here so the header stays legible; Hold Agent stays outside because it is
                toggled constantly. */}
            <div style={{ position: 'relative' }} ref={menuRef}>
              <button
                className="icon-button"
                onClick={() => { setShowMenu(v => !v); setShowTagSubmenu(false); }}
                title="Menu"
                aria-haspopup="menu"
                aria-expanded={showMenu}
                style={{ color: showMenu ? 'var(--primary)' : 'var(--text-muted)' }}
              >
                <MoreVertical size={19} />
              </button>

              {showMenu && (
                <div
                  role="menu"
                  style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: '6px',
                    minWidth: '224px', zIndex: 120, overflow: 'hidden',
                    background: 'var(--bg-panel, var(--bg-sidebar))',
                    border: '1px solid var(--border-color)', borderRadius: '10px',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.22)',
                  }}
                >
                  <MenuItem
                    icon={<UserPlus size={15} style={{ color: 'var(--primary)' }} />}
                    label={savedContact ? 'Edit Kontak' : 'Simpan Kontak'}
                    disabled={!canSaveContact}
                    onClick={() => { setShowMenu(false); setEditingContact(true); }}
                  />

                  <MenuDivider />

                  {/* Whichever transition is NOT the current state. Offering "mark won"
                      on an already-won deal would be a no-op dressed as an action. */}
                  {chatStatus !== 'dropped' && (
                    <MenuItem
                      icon={<UserMinus size={15} style={{ color: '#ef4444' }} />}
                      label="Hapus dari Prospek"
                      disabled={statusBusy}
                      onClick={() => handleSetStatus('dropped')}
                    />
                  )}

                  {chatStatus !== 'closed_won' && (
                    <MenuItem
                      icon={<Trophy size={15} style={{ color: 'var(--primary)' }} />}
                      label="Tandai Closed Won"
                      disabled={statusBusy}
                      onClick={() => handleSetStatus('closed_won')}
                    />
                  )}

                  {chatStatus !== 'prospect' && (
                    <MenuItem
                      icon={<RotateCcw size={15} style={{ color: 'var(--text-muted)' }} />}
                      label="Kembalikan ke Prospek"
                      disabled={statusBusy}
                      onClick={() => handleSetStatus('prospect')}
                    />
                  )}

                  <MenuDivider />

                  {/* Reuses the existing tag list rather than a second implementation,
                      so tags set here and in the tag dropdown cannot diverge. */}
                  <MenuItem
                    icon={<Tag size={15} style={{ color: '#8b5cf6' }} />}
                    label="Kelola Tag"
                    trailing={<ChevronRight size={14} style={{ color: 'var(--text-dimmed)' }} />}
                    onClick={() => setShowTagSubmenu(v => !v)}
                  />

                  {showTagSubmenu && (
                    <div style={{ borderTop: '1px solid var(--border-color)', background: 'var(--overlay-subtle)', padding: '4px 0' }}>
                      {[...PRESET_TAGS, ...globalCustomTags].map((tag) => {
                        const on = currentTags.some(t => t.label.toLowerCase() === tag.label.toLowerCase());
                        return (
                          <button
                            key={tag.value || tag.label}
                            role="menuitemcheckbox"
                            aria-checked={on}
                            onClick={() => handleToggleTag(tag)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: '9px', width: '100%',
                              padding: '8px 14px 8px 30px', border: 'none', background: 'transparent',
                              color: 'var(--text-main)', fontSize: '0.82rem', fontFamily: 'inherit',
                              textAlign: 'left', cursor: 'pointer',
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'var(--overlay-medium)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          >
                            <span style={{
                              width: '9px', height: '9px', borderRadius: '50%',
                              background: tag.color, flexShrink: 0,
                            }} />
                            <span style={{ flex: 1 }}>{tag.label}</span>
                            {on && <Check size={14} style={{ color: 'var(--primary)' }} />}
                          </button>
                        );
                      })}
                      {currentTags.length > 0 && (
                        <button
                          onClick={handleClearAllTags}
                          style={{
                            display: 'block', width: '100%', padding: '8px 14px 8px 30px',
                            border: 'none', background: 'transparent', color: '#ef4444',
                            fontSize: '0.8rem', fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
                          }}
                        >
                          Hapus semua tag
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* The only control that hides the side panel. The composer's template button
                picks a template instead — two different jobs, two different places. */}
            <button 
              className="icon-button" 
              onClick={() => setShowQuickReplies(!showQuickReplies)}
              title={showQuickReplies ? 'Sembunyikan panel template' : 'Tampilkan panel template'}
              aria-expanded={showQuickReplies}
              style={{ color: showQuickReplies ? 'var(--primary)' : 'var(--text-muted)' }}
            >
              <PanelRight size={20} />
            </button>
          </div>
        </div>

        {/* Search within this conversation. Sits between the header and the messages so
            it pushes the list rather than covering it. */}
        {showSearch && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '9px', flexShrink: 0,
            padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
            background: 'var(--overlay-subtle)',
          }}>
            <Search size={14} style={{ color: 'var(--text-dimmed)', flexShrink: 0 }} />
            <input
              autoFocus
              value={messageQuery}
              onChange={(e) => setMessageQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearch(false); setMessageQuery(''); } }}
              placeholder="Cari pesan dalam percakapan ini…"
              aria-label="Cari pesan"
              style={{
                flex: 1, minWidth: 0, border: 'none', background: 'transparent',
                color: 'var(--text-main)', fontSize: '0.86rem', fontFamily: 'inherit', outline: 'none',
              }}
            />
            {messageQuery.trim() && (
              <span style={{ fontSize: '0.76rem', color: 'var(--text-dimmed)', whiteSpace: 'nowrap' }}>
                {visibleMessages.length} hasil
              </span>
            )}
            <button
              onClick={() => { setShowSearch(false); setMessageQuery(''); }}
              aria-label="Tutup pencarian"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}
            >
              <X size={16} />
            </button>
          </div>
        )}

        {/* Message Bubble List */}
        <div className="messages-container">
          {showSearch && messageQuery.trim() && visibleMessages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dimmed)', fontSize: '0.86rem' }}>
              Tidak ada pesan yang cocok dengan “{messageQuery.trim()}”
            </div>
          )}
          {visibleMessages.map((msg, index) => {
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
              // Resolution order: the sender's own pushName, then their phone
              // number, then a stable label derived from their LID.
              //
              // participantAlt is the Baileys v7 name for what v6 called
              // participantPn. Only participantPn was checked here, so after the
              // v7 upgrade every group sender fell through to the last branch —
              // or to null when the key had no participant at all, which is why
              // messages showed a bare "WA" avatar with no name.
              const participantPhone = msg.key.participantAlt || msg.key.participantPn;

              if (msg.pushName) {
                senderName = msg.pushName;
              } else if (participantPhone) {
                senderName = '+' + participantPhone.split('@')[0];
              } else if (msg.key.participant) {
                const pid = msg.key.participant.split('@')[0];
                if (!/^\d+$/.test(pid)) {
                  senderName = pid;
                } else if (msg.key.participant.endsWith('@s.whatsapp.net')) {
                  senderName = '+' + pid;
                } else {
                  // Anonymous @lid participant: keep senders distinguishable.
                  senderName = `WhatsApp User #${pid.slice(-4)}`;
                }
              }

              // Generate a stable color for each sender
              if (msg.key.participant || participantPhone) {
                const senderId = msg.key.participant || participantPhone;
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
            const getSenderInitials = () => getInitials(senderName);

            // Day separator before the first message of each day.
            //
            // Compared against the PREVIOUS RENDERED message rather than
            // visibleMessages[index - 1], because the loop skips messages above (empty
            // bodies, and free-tier messages older than 7 days). Using the raw index
            // would print a divider for a day whose only message was skipped.
            const label = dayLabel(msg.messageTimestamp);
            const showDivider = label !== null && label !== lastRenderedDay;
            if (showDivider) lastRenderedDay = label;

            return (
              <React.Fragment key={msg.key.id || index}>
              {showDivider && <div className="chat-day-divider">{label}</div>}
              <div 
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
              </React.Fragment>
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

        {/* On-hold banner. Sits above the composer because the point of holding
            is that YOU reply — the human composer stays fully enabled. */}
        {isHeld && (
          <div
            role="status"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '10px 16px',
              background: 'rgba(245,158,11,0.08)',
              borderTop: '1px solid rgba(245,158,11,0.25)',
              color: '#f59e0b',
              fontSize: '0.82rem',
            }}
          >
            <Pause size={14} style={{ flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              <strong>Agent on hold.</strong> Automated replies are paused for this conversation
              {holdState?.pausedBy ? <> by <strong>{holdState.pausedBy}</strong></> : null}
              . You can reply normally.
            </span>
            <button
              onClick={handleToggleHold}
              disabled={holdBusy}
              style={{
                background: 'transparent',
                border: '1px solid rgba(245,158,11,0.4)',
                color: '#f59e0b',
                padding: '4px 10px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: '600',
                cursor: holdBusy ? 'wait' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Resume
            </button>
          </div>
        )}

        {/* Message Input Box */}
        <div className="chat-window-input-bar" style={{ position: 'relative' }}>
          {/* Quota-reached overlay. Themed rather than a hardcoded white wash,
              which read as a bright panel over the dark composer. */}
          {userProfile && userProfile.role !== 'admin' && (userProfile.messagesSent || 0) >= (userProfile.messageLimit ?? 500) && (
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-input)', opacity: 0.94, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444', fontWeight: '600', gap: '8px' }}>
              <AlertCircle size={18} /> Usage limit reached. Upgrade your plan to send more messages.
            </div>
          )}
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: 'none' }}
            disabled={sending}
          />

          {/* Everything the operator types or attaches lives in one rounded field, with
              the send button outside it. */}
          <div className="composer-field">
            <button
              className="composer-icon"
              onClick={() => fileInputRef.current?.click()}
              title="Lampirkan berkas"
              disabled={sending}
            >
              <Plus size={19} />
            </button>

            <button
              className={`composer-icon ${templatesOpen ? 'active' : ''}`}
              onClick={() => setShowTemplates(v => !v)}
              title="Pilih template pesan"
              aria-expanded={templatesOpen}
              disabled={sending}
            >
              <FileText size={17} />
            </button>

            <div style={{ position: 'relative', display: 'flex' }} ref={emojiRef}>
              <button
                className={`composer-icon ${showEmoji ? 'active' : ''}`}
                onClick={() => setShowEmoji(v => !v)}
                title="Emoji"
                disabled={sending}
                aria-expanded={showEmoji}
              >
                <Smile size={18} />
              </button>

              {showEmoji && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, zIndex: 60,
                  width: '236px', padding: '8px',
                  display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '2px',
                  background: 'var(--bg-panel, var(--bg-sidebar))',
                  border: '1px solid var(--border-color)', borderRadius: '12px',
                  boxShadow: '0 10px 28px rgba(0,0,0,0.2)',
                }}>
                  {QUICK_EMOJI.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => { setInputText(t => t + emoji); setShowEmoji(false); }}
                      style={{
                        border: 'none', background: 'transparent', cursor: 'pointer',
                        fontSize: '1.15rem', lineHeight: 1, padding: '5px', borderRadius: '6px',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--overlay-subtle)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <input 
              type="text" 
              placeholder="Ketik pesan... atau gunakan '/' untuk memilih template" 
              className="chat-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={sending || (userProfile && userProfile.role !== 'admin' && (userProfile.messagesSent || 0) >= (userProfile.messageLimit ?? 500))}
            />
          </div>

          {/* Template picker. Opened either by the composer's template button or by typing
              '/', which the placeholder advertises — an advertised shortcut that does
              nothing is worse than no shortcut. */}
          {templatesOpen && (
            <div ref={templatesRef} style={{
              position: 'absolute', bottom: 'calc(100% - 4px)', left: '20px', right: '76px',
              zIndex: 60, maxHeight: '260px', overflowY: 'auto', padding: '6px',
              background: 'var(--bg-panel, var(--bg-sidebar))',
              border: '1px solid var(--border-color)', borderRadius: '12px',
              boxShadow: '0 12px 30px rgba(0,0,0,0.2)',
            }}>
              {templateMatches.length === 0 ? (
                <div style={{ padding: '12px 14px', fontSize: '0.83rem', color: 'var(--text-dimmed)' }}>
                  {quickReplies.length === 0
                    ? 'Belum ada template. Tambahkan dari panel di kanan.'
                    : 'Tidak ada template yang cocok'}
                </div>
              ) : templateMatches.map((reply) => (
                <button
                  key={reply.id}
                  onClick={() => applyTemplate(reply)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', border: 'none',
                    background: 'transparent', cursor: 'pointer', padding: '9px 12px',
                    borderRadius: '8px', fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--overlay-subtle)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ fontSize: '0.84rem', fontWeight: '600', color: 'var(--text-main)' }}>
                    {reply.title}
                  </div>
                  <div style={{
                    fontSize: '0.78rem', color: 'var(--text-muted)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {reply.text}
                  </div>
                </button>
              ))}
            </div>
          )}
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

      {/* Save / edit this customer in the operator's own contact list. Prefilled
          with the number so the common case is one field and one click. */}
      {editingContact && (
        <ContactEditor
          contact={savedContact || (contactPhone ? {
            phone: contactPhone,
            // Prefill with WhatsApp's name only when it is a name. A numeric
            // pushName is just the number again and is noise in the form.
            name: /^\d+$/.test(String(activeChat.name || '').trim()) ? '' : (activeChat.name || ''),
          } : null)}
          onSave={handleSaveContact}
          onClose={() => setEditingContact(false)}
        />
      )}
    </div>
  );
}
