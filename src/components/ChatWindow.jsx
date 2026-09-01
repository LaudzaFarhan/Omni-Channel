import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Send, FileText, Calendar, Clock, Smile, PanelRight, AlertCircle, AlertTriangle, Plus, X, Pencil, Trash2, Loader2, Paperclip, Check, CheckCheck, Tag, ChevronDown, ChevronRight, Pause, Play, UserPlus, UserCheck, MoreVertical, Search, Trophy, UserMinus, RotateCcw, Maximize2, Minimize2, Reply, Forward, Copy, Zap } from 'lucide-react';
import { fetchWithAuth, saveContact, updateContact, setChatStatus as apiSetChatStatus } from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';
import { showToast } from '../utils/toastBus.js';
import { PRESET_TAGS, getTags, toggleTag, clearTags, createCustomTag, loadGlobalCustomTags, addGlobalCustomTag, deleteGlobalCustomTag } from '../utils/contactTags.js';
import { getChatDisplayName, getInitials, avatarColor } from '../utils/displayName.js';
import { get24HourWindowStatus } from '../utils/timeFormat.js';
import { jidToPhone, formatPhone } from '../utils/phone.js';
import ContactEditor from './contacts/ContactEditor.jsx';
import ForwardDialog from './chat/ForwardDialog.jsx';

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
  closed_won: { color: 'var(--success)', bg: 'var(--success-soft)', border: 'var(--success-border)' },
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
  formatted = formatted.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: var(--link-color); text-decoration: underline;">$1</a>');

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
            style={{ fontSize: '0.8rem', color: 'var(--link-color)', textDecoration: 'underline', fontWeight: '500' }}
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

export default function ChatWindow({ activeChat, messages, setMessages, userProfile, user, activeSessionId, userInfo, savedNames = {}, savedContacts = {},
  // Fullscreen is owned by MessageDashboard: the element that expands has to contain the
  // chat list as well, and that is a sibling of this component. The button lives here
  // because the conversation header is where it belongs.
  isFullscreen = false, onToggleFullscreen = null,
  // Every conversation, so a message can be forwarded somewhere other than this one.
  chats = [] }) {
  // Saving the person you are talking to is the main way contacts get created —
  // expecting the operator to copy a number over to the contacts page instead
  // would mean the address book stays empty.
  const [editingContact, setEditingContact] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [activeRightPanel, setActiveRightPanel] = useState(null); // 'contact_info' | 'quick_reply' | null
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [quickReplies, setQuickReplies] = useState(loadQuickReplies);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingReply, setEditingReply] = useState(null); // null or reply id
  const [formTitle, setFormTitle] = useState('');
  const [formText, setFormText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const handleCopyPhone = (text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
    showToast({ type: 'success', title: 'Nomor disalin', message: text });
  };

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

  // Per-message actions.
  //
  // `msgMenu` carries viewport coordinates rather than just an id because the menu is
  // positioned fixed. The messages list is a scroll container, so a menu positioned
  // inside a bubble would be clipped by it near the top and bottom edges.
  const [msgMenu, setMsgMenu] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const msgMenuRef = useRef(null);
  const composerRef = useRef(null);

  // 24-Hour Follow-up Window: live real-time countdown & status
  const [ticker, setTicker] = useState(Date.now());
  const [dismissedBannerChatId, setDismissedBannerChatId] = useState(null);

  useEffect(() => {
    const interval = setInterval(() => setTicker(Date.now()), 30000);
    return () => clearInterval(interval);
  }, []);

  const windowStatus = useMemo(() => {
    return get24HourWindowStatus(activeChat, messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChat, messages, ticker]);



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
    // A quote or a menu anchored to the previous conversation's messages is meaningless
    // here, and the reply would be sent to the wrong person.
    setReplyTo(null);
    setMsgMenu(null);
    setForwardMsg(null);
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

  // Menu height/width are fixed here rather than measured. Measuring needs the element
  // to exist first, which would mean rendering it in the wrong place for one frame.
  const MSG_MENU_W = 186;
  const MSG_MENU_H = 132;

  const openMsgMenu = (event, msg) => {
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();

    // Flip above the button when there is not enough room below, and pull back from the
    // right edge, so the menu is never partly off-screen for the newest message.
    const openUpward = rect.bottom + MSG_MENU_H > window.innerHeight - 8;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - MSG_MENU_W - 8));

    setMsgMenu({
      id: msg.key.id,
      msg,
      left,
      top: openUpward ? Math.max(8, rect.top - MSG_MENU_H - 4) : rect.bottom + 4,
    });
  };

  const startReply = (msg) => {
    setReplyTo(msg);
    setMsgMenu(null);
    // Replying is always followed by typing, so put the caret where it is needed.
    composerRef.current?.focus();
  };

  const startForward = (msg) => {
    setForwardMsg(msg);
    setMsgMenu(null);
  };

  const copyMessageText = async (msg) => {
    setMsgMenu(null);
    const text = getMessageText(msg);
    if (!text) return;

    try {
      // navigator.clipboard needs a secure context. Over plain http it is undefined, so
      // without the fallback below "Salin" would silently do nothing.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const scratch = document.createElement('textarea');
        scratch.value = text;
        scratch.setAttribute('readonly', '');
        scratch.style.position = 'fixed';
        scratch.style.opacity = '0';
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand('copy');
        document.body.removeChild(scratch);
      }
      showToast({ type: 'success', title: 'Disalin', message: 'Pesan disalin ke clipboard' });
    } catch (err) {
      showToast({ type: 'error', title: 'Gagal menyalin', message: err.message });
    }
  };

  // The menu is positioned against the viewport, so any scroll or resize invalidates its
  // coordinates. Closing is the honest response — repositioning mid-scroll would have it
  // chase the bubble around.
  useEffect(() => {
    if (!msgMenu) return;

    const close = () => setMsgMenu(null);
    const onPointerDown = (e) => {
      if (!msgMenuRef.current?.contains(e.target)) close();
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') close(); };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    // Capture phase, because the scroll happens on the messages container rather than
    // on window and scroll events do not bubble.
    document.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [msgMenu]);

  // Forward one message to each chosen conversation.
  //
  // Sent one at a time on purpose: WhatsApp rate-limits bursts, and each send also
  // consumes quota server-side, so a parallel fan-out could half-succeed in a way that
  // is harder to report. Partial failures are surfaced without discarding the successes.
  const handleForward = async (targetJids) => {
    if (!forwardMsg) return;

    const failures = [];
    for (const jid of targetJids) {
      try {
        const res = await fetchWithAuth('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: jid,
            sessionId: activeSessionId,
            forwardFrom: { jid: activeChat.id, id: forwardMsg.key.id },
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) failures.push(data.error || `HTTP ${res.status}`);
      } catch (err) {
        failures.push(err.message);
      }
    }

    const delivered = targetJids.length - failures.length;
    if (delivered > 0) {
      showToast({
        type: 'success',
        title: 'Pesan diteruskan',
        message: `Terkirim ke ${delivered} chat`,
      });
    }
    // Throwing keeps the dialog open with the selection intact so it can be retried.
    if (failures.length) {
      throw new Error(`Gagal ke ${failures.length} chat: ${failures[0]}`);
    }
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
      return <CheckCheck size={14} style={{ color: 'var(--wa-read-receipt)', filter: 'drop-shadow(0 0 1px var(--wa-read-receipt-outline))', marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />;
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

  // Baileys attaches contextInfo to whichever message variant was sent, so a reply to a
  // photo carries it on imageMessage and a plain text reply on extendedTextMessage.
  // Checking only one of them would make replies to media look like ordinary messages.
  const getContextInfo = (msg) => {
    const c = msg?.message;
    if (!c) return null;
    return c.extendedTextMessage?.contextInfo
      || c.imageMessage?.contextInfo
      || c.videoMessage?.contextInfo
      || c.documentMessage?.contextInfo
      || c.audioMessage?.contextInfo
      || c.stickerMessage?.contextInfo
      || null;
  };

  // The quoted message shown inside a bubble, or null when this is not a reply.
  //
  // Authorship is best-effort: contextInfo.participant is the original sender, but on
  // an @lid account it may not equal our own JID even for our own message. When it
  // cannot be matched we label it with the conversation name instead of guessing
  // "Anda", because claiming the operator wrote someone else's line is worse than
  // being vague.
  const getQuotedPreview = (msg) => {
    const ctx = getContextInfo(msg);
    if (!ctx?.quotedMessage) return null;

    const bareId = (jid) => (typeof jid === 'string' ? jid.split('@')[0].split(':')[0] : null);
    const mine = bareId(userInfo?.id);
    const author = bareId(ctx.participant);

    return {
      text: getMessageText({ message: ctx.quotedMessage }) || 'Pesan',
      author: mine && author && mine === author ? 'Anda' : getDisplayName(activeChat),
    };
  };

  const isForwardedMessage = (msg) => {
    const ctx = getContextInfo(msg);
    return !!ctx && (ctx.isForwarded === true || (ctx.forwardingScore || 0) > 0);
  };

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

      // The server resolves this id back to the original message so WhatsApp threads the
      // reply. If it has aged out of the 100-message window the text still sends, just
      // without the quote.
      if (replyTo?.key?.id) {
        payload.quotedId = replyTo.key.id;
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
        setReplyTo(null); // the quote belonged to the message just sent
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
    <div style={{ display: 'flex', flex: 1, height: '100%', minWidth: 0 }}>
      {/* Active Conversation Area */}
      <div className="chat-window">
        {/* Header */}
        <div className="chat-window-header">
          <div
            className="header-user-info"
            onClick={() => setActiveRightPanel(prev => prev === 'contact_info' ? null : 'contact_info')}
            style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
            title="Klik untuk melihat Detail Profil Kontak"
          >
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

                {/* 24-Hour Follow-up Window Indicator */}
                {windowStatus && (
                  <span
                    className={`window-24h-pill is-${windowStatus.level}`}
                    title={
                      windowStatus.isExpired
                        ? `Sesi 24 jam telah berakhir (${windowStatus.elapsedDays > 0 ? `${windowStatus.elapsedDays} hari` : `${windowStatus.elapsedHours} jam`} yang lalu). Perlu template untuk inisiasi baru.`
                        : `Jendela percakapan 24 jam aktif. Sisa waktu follow-up: ${windowStatus.hoursLeft} jam ${windowStatus.minutesLeft} menit.`
                    }
                  >
                    {windowStatus.level === 'healthy' && <Clock size={11} />}
                    {windowStatus.level === 'warning' && <span className="pulsing-dot" />}
                    {windowStatus.level === 'urgent' && <AlertTriangle size={11} />}
                    {windowStatus.level === 'expired' && <Clock size={11} />}
                    <span>
                      {windowStatus.isExpired
                        ? '24h Expired'
                        : windowStatus.level === 'urgent'
                        ? `${windowStatus.minutesLeft}m tersisa!`
                        : `24h: ${windowStatus.hoursLeft}j ${windowStatus.minutesLeft}m`}
                    </span>
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

            {/* Fullscreen. Expands the chat list and this conversation together over the
                nav sidebar and top bar. Rendered only when a handler is supplied, so the
                button is never present without something behind it. */}
            {onToggleFullscreen && (
              <button
                className="icon-button"
                onClick={onToggleFullscreen}
                title={isFullscreen ? 'Keluar dari layar penuh (Esc)' : 'Buka layar penuh'}
                aria-pressed={isFullscreen}
                style={{ color: isFullscreen ? 'var(--primary)' : 'var(--text-muted)' }}
              >
                {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            )}

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
                      icon={<Trophy size={15} style={{ color: 'var(--success)' }} />}
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

        {/* 24-Hour Follow-up Window Banner / Warning */}
        {windowStatus && (windowStatus.level !== 'healthy' || dismissedBannerChatId !== activeChat.id) && (
          <div className={`window-24h-banner is-${windowStatus.level}`}>
            <div className="window-24h-banner-content">
              {windowStatus.level === 'healthy' && (
                <>
                  <Clock size={15} className="window-24h-icon" />
                  <span>
                    <strong>Jendela Percakapan 24 Jam:</strong> Tersisa <strong>{windowStatus.hoursLeft} jam {windowStatus.minutesLeft} menit</strong> untuk membalas atau follow up pelanggan dalam sesi ini.
                  </span>
                </>
              )}
              {windowStatus.level === 'warning' && (
                <>
                  <span className="pulsing-dot" />
                  <span>
                    <strong>Sesi 24 Jam Segera Berakhir:</strong> Tersisa <strong>{windowStatus.hoursLeft} jam {windowStatus.minutesLeft} menit</strong>. Segera tindak lanjuti sebelum jendela percakapan ditutup.
                  </span>
                </>
              )}
              {windowStatus.level === 'urgent' && (
                <>
                  <AlertTriangle size={15} className="window-24h-icon" />
                  <span>
                    <strong>Perhatian: Sesi 24 Jam Segera Habis!</strong> Tersisa <strong>{windowStatus.minutesLeft} menit</strong> untuk merespons pelanggan.
                  </span>
                </>
              )}
              {windowStatus.level === 'expired' && (
                <>
                  <AlertCircle size={15} className="window-24h-icon" />
                  <span>
                    <strong>Sesi 24 Jam Telah Berakhir:</strong> Lebih dari 24 jam sejak pesan terakhir ({windowStatus.elapsedDays > 0 ? `${windowStatus.elapsedDays} hari` : `${windowStatus.elapsedHours} jam`} lalu). Gunakan template resmi untuk inisiasi chat kembali.
                  </span>
                </>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              {windowStatus.isExpired && (
                <button
                  type="button"
                  className="window-24h-action-btn"
                  onClick={() => setActiveRightPanel('quick_reply')}
                  title="Buka panel Quick Reply"
                >
                  <Zap size={12} /> Quick Reply
                </button>
              )}
              {windowStatus.level === 'healthy' && (
                <button
                  type="button"
                  onClick={() => setDismissedBannerChatId(activeChat.id)}
                  className="window-24h-close-btn"
                  title="Tutup pemberitahuan"
                >
                  <X size={13} />
                </button>
              )}
            </div>
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
                  {/* Reveals on hover over the bubble, like WhatsApp. Kept visible while
                      its own menu is open, otherwise moving the pointer to the menu makes
                      the button it came from vanish. */}
                  <button
                    className={`bubble-menu-btn ${msgMenu?.id === msg.key.id ? 'open' : ''}`}
                    onClick={(e) => openMsgMenu(e, msg)}
                    title="Aksi pesan"
                    aria-haspopup="menu"
                    aria-expanded={msgMenu?.id === msg.key.id}
                  >
                    <ChevronDown size={15} />
                  </button>

                  {/* Sender name label for group chats */}
                  {isGroup && !isMe && senderName && (
                    <div className="msg-sender-name" style={{ color: senderColor }}>
                      {senderName}
                    </div>
                  )}

                  {isForwardedMessage(msg) && (
                    <div className="msg-forwarded-label">
                      <Forward size={12} /> Diteruskan
                    </div>
                  )}

                  {/* The quoted message. Without this a reply is indistinguishable from a
                      normal message in our own UI, even though WhatsApp shows the thread. */}
                  {(() => {
                    const quoted = getQuotedPreview(msg);
                    if (!quoted) return null;
                    return (
                      <div className="msg-quote">
                        <div className="msg-quote-author">{quoted.author}</div>
                        <div className="msg-quote-text">{quoted.text}</div>
                      </div>
                    );
                  })()}

                  {hasMedia(msg) ? (
                    <MediaMessage msg={msg} activeSessionId={activeSessionId} />
                  ) : (
                    formatMessageText(text)
                  )}
                  {/* Who on the team sent this, for messages sent from the dashboard.
                      Only our own messages are ever stamped, so the badge sits on a
                      footer row with the time; without a badge the time keeps its
                      original standalone layout. */}
                  {isMe && msg.agentName ? (
                    <div className="msg-footer">
                      <span className="msg-agent-badge" title={`Dikirim oleh ${msg.agentName}`}>
                        {msg.agentName}
                      </span>
                      <span className="message-time">
                        {formatMsgTime(msg.messageTimestamp)}
                        {renderMessageStatus(msg)}
                      </span>
                    </div>
                  ) : (
                    <span className="message-time">
                      {formatMsgTime(msg.messageTimestamp)}
                      {isMe && renderMessageStatus(msg)}
                    </span>
                  )}
                </div>
              </div>
              </React.Fragment>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Per-message actions. Fixed to viewport coordinates captured when the bubble's
            button was clicked, so the scroll container cannot clip it. Rendered inside
            ChatWindow rather than portalled to document.body, which would be invisible
            while the chat is fullscreen. */}
        {msgMenu && (
          <div
            ref={msgMenuRef}
            role="menu"
            style={{
              position: 'fixed', top: `${msgMenu.top}px`, left: `${msgMenu.left}px`,
              width: `${MSG_MENU_W}px`, zIndex: 3000, padding: '6px',
              background: 'var(--bg-panel, var(--bg-sidebar))',
              border: '1px solid var(--border-color)', borderRadius: '12px',
              boxShadow: '0 12px 30px rgba(0,0,0,0.22)',
            }}
          >
            <button className="msg-menu-item" role="menuitem" onClick={() => startReply(msgMenu.msg)}>
              <Reply size={15} /> Balas
            </button>
            <button className="msg-menu-item" role="menuitem" onClick={() => startForward(msgMenu.msg)}>
              <Forward size={15} /> Teruskan
            </button>
            <button className="msg-menu-item" role="menuitem" onClick={() => copyMessageText(msgMenu.msg)}>
              <Copy size={15} /> Salin
            </button>
          </div>
        )}

        {/* Replying banner */}
        {replyTo && (
          <div className="replying-banner">
            <div className="replying-content">
              <div className="replying-title">
                Membalas {replyTo.key.fromMe ? 'Anda' : getDisplayName(activeChat)}
              </div>
              <div className="replying-snippet">
                {getMessageText(replyTo) || (hasMedia(replyTo) ? 'Media' : 'Pesan')}
              </div>
            </div>
            <button
              type="button"
              className="replying-cancel"
              onClick={() => setReplyTo(null)}
              title="Batal membalas"
              aria-label="Batal membalas"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* File preview before sending */}
        {selectedFile && (
          <div style={{
            padding: '8px 16px', background: 'var(--overlay-subtle)',
            borderTop: '1px solid var(--border-color)', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
              <Paperclip size={14} style={{ color: 'var(--primary)', flexShrink: 0 }} />
              <span style={{ fontWeight: '600', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedFile.name}
              </span>
              <span style={{ color: 'var(--text-dimmed)', fontSize: '0.75rem' }}>
                ({(selectedFile.size / 1024).toFixed(1)} KB)
              </span>
            </div>
            <button
              onClick={() => setSelectedFile(null)}
              style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', display: 'flex' }}
              title="Batalkan berkas"
            >
              <X size={15} />
            </button>
          </div>
        )}

        {/* Hold alert banner */}
        {isHeld && (
          <div style={{
            padding: '6px 16px', background: 'rgba(245,158,11,0.12)',
            borderTop: '1px solid rgba(245,158,11,0.25)', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8rem',
            color: '#f59e0b',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Pause size={14} />
              <span>
                <strong>Agent on Hold:</strong> Respon otomatis bot dinonaktifkan untuk percakapan ini.
              </span>
            </div>
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
          {/* Quota-reached overlay */}
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

          <div className="composer-field">
            <button
              className="composer-icon"
              onClick={() => fileInputRef.current?.click()}
              title="Lampirkan berkas"
              disabled={sending}
            >
              <Plus size={19} />
            </button>

            {/* Quick Reply Lightning Button */}
            <button
              className={`composer-icon ${activeRightPanel === 'quick_reply' ? 'active' : ''}`}
              onClick={() => setActiveRightPanel(prev => prev === 'quick_reply' ? null : 'quick_reply')}
              title="Quick Reply"
              aria-expanded={activeRightPanel === 'quick_reply'}
              disabled={sending}
            >
              <Zap size={18} />
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
              ref={composerRef}
              placeholder="Ketik pesan... atau gunakan '/' untuk memilih template" 
              className="chat-input"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyPress}
              disabled={sending || (userProfile && userProfile.role !== 'admin' && (userProfile.messagesSent || 0) >= (userProfile.messageLimit ?? 500))}
            />
          </div>

          {/* Template picker for '/' shortcut */}
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

      {/* Right Drawer: Contact Info OR Quick Replies */}
      {activeRightPanel === 'contact_info' && (
        <div className="chat-right-drawer contact-profile-drawer">
          <div className="drawer-header">
            <button className="drawer-close-btn" onClick={() => setActiveRightPanel(null)} title="Tutup Detail Profil">
              <X size={18} />
            </button>
            <h3>Info Kontak</h3>
          </div>

          <div className="contact-profile-card">
            <div className="contact-profile-avatar" style={{ background: avatarColor(activeChat.id) }}>
              {getInitials(getDisplayName(activeChat))}
            </div>
            <div className="contact-profile-name">{getDisplayName(activeChat)}</div>
            {contactPhone && (
              <div className="contact-profile-phone">
                <span>{formatPhone(contactPhone)}</span>
                <button
                  type="button"
                  onClick={() => handleCopyPhone(formatPhone(contactPhone))}
                  title="Salin nomor telepon"
                  style={{
                    border: 'none', background: 'transparent', color: copiedPhone ? 'var(--success)' : 'var(--text-dimmed)',
                    cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center',
                  }}
                >
                  {copiedPhone ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            )}

            {/* 24h Window Badge */}
            {windowStatus && (
              <div style={{ marginTop: '4px', marginBottom: '12px' }}>
                <span className={`window-24h-pill is-${windowStatus.level}`}>
                  {windowStatus.level === 'healthy' && <Clock size={11} />}
                  {windowStatus.level === 'warning' && <span className="pulsing-dot" />}
                  {windowStatus.level === 'urgent' && <AlertTriangle size={11} />}
                  {windowStatus.level === 'expired' && <Clock size={11} />}
                  <span>
                    {windowStatus.isExpired
                      ? '24h Expired'
                      : windowStatus.level === 'urgent'
                      ? `${windowStatus.minutesLeft}m tersisa!`
                      : `24h: ${windowStatus.hoursLeft}j ${windowStatus.minutesLeft}m`}
                  </span>
                </span>
              </div>
            )}

            {/* Contact Action */}
            {canSaveContact && (
              <button
                type="button"
                onClick={() => setEditingContact(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '6px 14px', borderRadius: '8px', fontSize: '0.8rem',
                  fontWeight: '600', cursor: 'pointer', background: 'var(--primary-soft)',
                  border: '1px solid var(--primary-border)', color: 'var(--primary)',
                  transition: 'all 0.15s ease',
                }}
              >
                {savedContact ? <><Pencil size={13} /> Edit Kontak</> : <><UserPlus size={13} /> Simpan ke Kontak</>}
              </button>
            )}
          </div>

          {/* Section: Contact Tags */}
          <div className="contact-profile-section">
            <div className="contact-profile-section-title">
              <span>Label Kontak (Tags)</span>
              {currentTags.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllTags}
                  style={{
                    background: 'none', border: 'none', color: '#ef4444',
                    fontSize: '0.72rem', cursor: 'pointer', fontWeight: '600',
                  }}
                >
                  Hapus Semua
                </button>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
              {PRESET_TAGS.map(tag => {
                const isSelected = currentTags.some(t => t.label.toLowerCase() === tag.label.toLowerCase());
                return (
                  <button
                    key={tag.value}
                    type="button"
                    onClick={() => handleToggleTag(tag)}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '6px',
                      padding: '5px 10px', borderRadius: '8px', fontSize: '0.78rem',
                      fontWeight: '600', cursor: 'pointer', border: `1px solid ${isSelected ? tag.color : 'var(--border-color)'}`,
                      background: isSelected ? tag.bg : 'var(--bg-main)', color: isSelected ? tag.color : 'var(--text-muted)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                    {tag.label}
                    {isSelected && <Check size={12} style={{ color: tag.color }} />}
                  </button>
                );
              })}

              {globalCustomTags.map(tag => {
                const isSelected = currentTags.some(t => t.label.toLowerCase() === tag.label.toLowerCase());
                return (
                  <div
                    key={tag.value}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      padding: '4px 6px 4px 10px', borderRadius: '8px', fontSize: '0.78rem',
                      fontWeight: '600', border: `1px solid ${isSelected ? tag.color : 'var(--border-color)'}`,
                      background: isSelected ? tag.bg : 'var(--bg-main)', color: isSelected ? tag.color : 'var(--text-muted)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleTag(tag)}
                      style={{
                        background: 'none', border: 'none', color: 'inherit',
                        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: 0,
                      }}
                    >
                      <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                      {tag.label}
                      {isSelected && <Check size={12} style={{ color: tag.color }} />}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteGlobalCustomTag(e, tag)}
                      title="Hapus tag kustom"
                      style={{
                        background: 'transparent', border: 'none', color: 'var(--text-dimmed)',
                        cursor: 'pointer', padding: '2px', display: 'inline-flex', alignItems: 'center',
                      }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Add Custom Tag Form */}
            {!showCustomInput ? (
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                style={{
                  width: '100%', padding: '6px 10px', borderRadius: '8px', border: '1px dashed var(--border-color)',
                  background: 'transparent', color: 'var(--primary)', fontSize: '0.78rem', fontWeight: '600',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                }}
              >
                <Plus size={13} /> Tambah Tag Kustom
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Nama tag..."
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveCustomTag();
                    if (e.key === 'Escape') setShowCustomInput(false);
                  }}
                  autoFocus
                  style={{
                    flex: 1, padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--border-color)',
                    background: 'var(--bg-main)', color: 'var(--text-main)', fontSize: '0.78rem', outline: 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={handleSaveCustomTag}
                  style={{
                    padding: '6px 10px', background: 'var(--primary)', color: '#fff',
                    border: 'none', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer',
                  }}
                >
                  Simpan
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomInput(false)}
                  style={{
                    padding: '6px', background: 'transparent', color: 'var(--text-muted)',
                    border: 'none', borderRadius: '6px', cursor: 'pointer', display: 'flex',
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Section: Status Prospek */}
          <div className="contact-profile-section">
            <div className="contact-profile-section-title">
              <span>Status Prospek</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                type="button"
                onClick={() => handleSetStatus('prospect')}
                disabled={statusBusy}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: '8px', border: `1px solid ${chatStatus === 'prospect' ? 'var(--primary-border)' : 'var(--border-color)'}`,
                  background: chatStatus === 'prospect' ? 'var(--primary-soft)' : 'transparent',
                  color: chatStatus === 'prospect' ? 'var(--primary)' : 'var(--text-main)',
                  fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span>New Leads / Prospek Aktif</span>
                {chatStatus === 'prospect' && <Check size={14} />}
              </button>

              <button
                type="button"
                onClick={() => handleSetStatus('closed_won')}
                disabled={statusBusy}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: '8px', border: `1px solid ${chatStatus === 'closed_won' ? 'var(--success-border)' : 'var(--border-color)'}`,
                  background: chatStatus === 'closed_won' ? 'var(--success-soft)' : 'transparent',
                  color: chatStatus === 'closed_won' ? 'var(--success)' : 'var(--text-main)',
                  fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span>🏆 Closed Won</span>
                {chatStatus === 'closed_won' && <Check size={14} />}
              </button>

              <button
                type="button"
                onClick={() => handleSetStatus('dropped')}
                disabled={statusBusy}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', borderRadius: '8px', border: `1px solid ${chatStatus === 'dropped' ? 'rgba(239,68,68,0.3)' : 'var(--border-color)'}`,
                  background: chatStatus === 'dropped' ? 'rgba(239,68,68,0.1)' : 'transparent',
                  color: chatStatus === 'dropped' ? '#ef4444' : 'var(--text-main)',
                  fontSize: '0.82rem', fontWeight: '600', cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span>Bukan Prospek</span>
                {chatStatus === 'dropped' && <Check size={14} />}
              </button>
            </div>
          </div>

          {/* Section: AI Agent Hold */}
          <div className="contact-profile-section">
            <div className="contact-profile-section-title">
              <span>Automasi AI Bot</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
              <span style={{ fontSize: '0.8rem', color: isHeld ? '#f59e0b' : 'var(--success)' }}>
                {isHeld ? '⏸ Bot Ditahan (Manual)' : '🟢 Bot Aktif Otomatis'}
              </span>
              <button
                type="button"
                onClick={handleToggleHold}
                disabled={holdBusy}
                style={{
                  padding: '5px 10px', borderRadius: '6px', fontSize: '0.78rem', fontWeight: '600',
                  cursor: 'pointer', border: `1px solid ${isHeld ? 'rgba(245,158,11,0.35)' : 'var(--border-color)'}`,
                  background: isHeld ? 'rgba(245,158,11,0.12)' : 'transparent', color: isHeld ? '#f59e0b' : 'var(--text-main)',
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                }}
              >
                {isHeld ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Hold</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right Drawer: Quick Replies */}
      {activeRightPanel === 'quick_reply' && (
        <div className="chat-right-drawer quick-replies-panel">
          <div className="qr-panel-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={18} style={{ color: 'var(--primary)' }} />
              <h3>Quick Reply</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button 
                className="qr-add-btn" 
                onClick={openAddForm}
                title="Tambah template baru"
              >
                <Plus size={16} />
              </button>
              <button className="drawer-close-btn" onClick={() => setActiveRightPanel(null)} title="Tutup Quick Reply">
                <X size={17} />
              </button>
            </div>
          </div>

          {/* Add/Edit Form */}
          {showAddForm && (
            <div className="qr-form">
              <div className="qr-form-header">
                <span>{editingReply ? 'Edit Quick Reply' : 'Template Baru'}</span>
                <button className="qr-form-close" onClick={handleCancelForm}>
                  <X size={15} />
                </button>
              </div>
              <input 
                type="text" 
                className="qr-form-input" 
                placeholder="Judul (contoh: 🎉 Promo)" 
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                maxLength={50}
              />
              <textarea 
                className="qr-form-textarea" 
                placeholder="Isi pesan template..." 
                value={formText}
                onChange={(e) => setFormText(e.target.value)}
                rows={3}
                maxLength={500}
              />
              <div className="qr-form-actions">
                <button className="qr-form-cancel" onClick={handleCancelForm}>Batal</button>
                <button 
                  className="qr-form-save" 
                  onClick={handleSaveReply}
                  disabled={!formTitle.trim() || !formText.trim()}
                >
                  {editingReply ? 'Perbarui' : 'Simpan'}
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
                    title="Hapus"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {forwardMsg && (
        <ForwardDialog
          chats={chats}
          userInfo={userInfo}
          savedNames={savedNames}
          currentChatId={activeChat?.id}
          previewText={getMessageText(forwardMsg)}
          onForward={handleForward}
          onClose={() => setForwardMsg(null)}
        />
      )}
    </div>
  );
}
