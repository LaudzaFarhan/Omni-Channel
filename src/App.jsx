import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getSocket, connectSocket, disconnectSocket, subscribeSocket } from './utils/socket.js';
import ChatList from './components/ChatList.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import ConnectionPanel from './components/ConnectionPanel.jsx';
import StatsPanel from './components/StatsPanel.jsx';
import LandingPage from './components/LandingPage.jsx';
import AuthScreens from './components/AuthScreens.jsx';
import AdminDashboard from './components/AdminDashboard.jsx';
import {
  fetchWithAuth, subscribeAuth, restoreSession, logout as apiLogout,
  getAccessToken, applyProfileUpdate, fetchContacts, fetchProfile, fetchFeatures,
} from './utils/api.js';
import { featureStatus, featureLabel, isVisible } from './utils/features.js';
import { normalizePlan, sortPlans, loadPlansOnce, resolveEffectiveLimits } from './utils/plans.js';
import { MessageSquare, Clock, AlertTriangle, Bell, X } from 'lucide-react';

import Sidebar from './components/Sidebar.jsx';
import Subscription from './components/Subscription.jsx';
import Profile from './components/Profile.jsx';
import Settings from './components/Settings.jsx';
import MessageDashboard from './components/MessageDashboard.jsx';
import Dashboard from './components/Dashboard.jsx';
import TopBar from './components/TopBar.jsx';
import NotificationsView from './components/NotificationsView.jsx';
import Contacts from './components/Contacts.jsx';
import Team from './components/Team.jsx';
import ConversationLog from './components/dashboard/ConversationLog.jsx';
import ComingSoon from './components/ComingSoon.jsx';
import AcceptInvite from './components/AcceptInvite.jsx';
import { showToast } from './utils/toastBus.js';

export default function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  // Plan catalogue, used to resolve the quota and device limit that actually
  // apply to this customer. Readable only once signed in.
  const [plans, setPlans] = useState([]);

  // What this account is allowed to see, as { featureKey: status }, resolved server-side
  // from the admin's rollout plus any exception on this workspace. Starts empty, which
  // every reader treats as "everything released" — see src/utils/features.js.
  const [features, setFeatures] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('messages');
  const [isSessionBlocked, setIsSessionBlocked] = useState(false);
  const [activeSessionCount, setActiveSessionCount] = useState(1);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // =============================================
  // MULTI-SESSION STATE
  // =============================================
  // Each WA session: { sessionId, status, qr, user }
  const [waSessions, setWaSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState('default');

  const [showNotificationsDrawer, setShowNotificationsDrawer] = useState(false);
  const [notifications, setNotifications] = useState([
    {
      id: '1',
      title: 'WhatsApp Connected',
      message: 'Your WhatsApp session has connected successfully.',
      time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      type: 'success',
      read: false
    },
    {
      id: '2',
      title: 'Trial Period Active',
      message: 'You have 7 days left in your free trial. Upgrade to premium for unlimited sessions.',
      time: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      type: 'info',
      read: false
    },
    {
      id: '3',
      title: 'Formatting Tips',
      message: 'You can now format text using bold (*), italics (_), strikethrough (~), and monospace (```).',
      time: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      type: 'warning',
      read: false
    }
  ]);

  // Per-active-session UI state
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [qrCode, setQrCode] = useState(null);
  const [userInfo, setUserInfo] = useState(null);
  
  const [chats, setChats] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeChatJid, setActiveChatJid] = useState(null);
  const [messages, setMessages] = useState([]);

  // Saved contacts. Held here rather than only inside the Contacts view because a
  // saved name has to beat WhatsApp's pushName everywhere a chat is labelled.
  const [contacts, setContacts] = useState([]);

  const activeChatJidRef = useRef(null);
  const activeSessionIdRef = useRef('default');

  // Sync refs
  useEffect(() => {
    activeChatJidRef.current = activeChatJid;
  }, [activeChatJid]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const [isSyncing, setIsSyncing] = useState(false);

  const handleSyncHistory = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    // Instantly refresh local chat list from server memory
    fetchChats(activeSessionIdRef.current);
    try {
      const res = await fetchWithAuth(`/api/sync?sessionId=${activeSessionId}`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Sync warning: ${errText || res.statusText}`);
        return;
      }
      const text = await res.text();
      if (!text) return;
      const data = JSON.parse(text);
      if (data.success) {
        showToast('Refreshing chats and WhatsApp history sync...', 'info');
      }
    } catch (e) {
      console.error('Failed to sync history:', e);
    } finally {
      setIsSyncing(false);
    }
  };

  // Navigate helper
  const navigateTo = (path) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  // Sync state with browser back/forward buttons
  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };
    window.addEventListener('popstate', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
    };
  }, []);

  const fetchChats = async (sessionId) => {
    const sid = sessionId || activeSessionIdRef.current;
    if (!sid) return;
    try {
      const res = await fetchWithAuth(`/api/chats?sessionId=${encodeURIComponent(sid)}`);
      if (!res.ok) {
        console.info(`fetchChats: server status ${res.status} (session initializing or reconnecting)`);
        return;
      }
      const text = await res.text();
      if (!text) return;
      const data = JSON.parse(text);
      if (sid === activeSessionIdRef.current) {
        setChats(prevChats => {
          if (!Array.isArray(data)) return prevChats;
          // Retain draft chats that user hasn't sent a message to yet
          const serverJids = new Set(data.map(c => c.id));
          const draftChats = (prevChats || []).filter(c => c.isDraft && !serverJids.has(c.id));
          return [...draftChats, ...data];
        });
      }
    } catch (err) {
      console.error('Error fetching chats:', err);
    }
  };

  const fetchMessages = async (sessionId, jid) => {
    const sid = sessionId || activeSessionIdRef.current;
    if (!jid) return;
    try {
      const res = await fetchWithAuth(`/api/chats/${encodeURIComponent(jid)}/messages?sessionId=${encodeURIComponent(sid)}`);
      if (!res.ok) {
        console.warn(`fetchMessages: server returned ${res.status}`);
        return;
      }
      const text = await res.text();
      if (!text) return;
      const data = JSON.parse(text);
      if (sid === activeSessionIdRef.current) {
        setMessages(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  };

  // Auth state.
  //
  // Replaces onAuthStateChanged plus the onSnapshot listener on the user's
  // Firestore document. The profile is fetched once on load and then kept
  // current by the 'profile-updated' socket event the server emits after any
  // change, so an admin approving an account or raising a quota still lands
  // live without polling.
  useEffect(() => {
    let cancelled = false;

    const unsubscribeAuth = subscribeAuth((nextUser) => {
      if (cancelled) return;
      setUser(nextUser);
      setUserProfile(nextUser);
      if (!nextUser) disconnectSocket();
    });

    // Validate any stored token against the server before trusting it.
    restoreSession()
      .catch((err) => console.error('[App] Session restore failed:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribeAuth();
    };
  }, []);

  // Open the socket once we have an approved account, and keep the profile in
  // step with what the server pushes.
  useEffect(() => {
    if (!userProfile) return;

    const canConnect = userProfile.isApproved || userProfile.role === 'admin';
    if (!canConnect) {
      disconnectSocket();
      return;
    }

    const token = getAccessToken();
    if (!token) return;

    let ws;
    try {
      ws = connectSocket(token);
      setupSocketListeners(ws);
    } catch (e) {
      console.error('[App] Failed to establish socket:', e);
      return;
    }

    const handleProfile = (profile) => {
      applyProfileUpdate(profile);
      setUserProfile(prev => (prev && prev.uid === profile.uid ? { ...prev, ...profile } : prev));
    };

    // Sent after the server increments the counter on a successful send, so the
    // quota bar reflects the authoritative value rather than a local guess.
    const handleQuota = ({ messagesSent }) => {
      setUserProfile(prev => (prev ? { ...prev, messagesSent } : prev));
    };

    const handlePlans = (nextPlans) => {
      setPlans(sortPlans((nextPlans || []).map(p => normalizePlan(p.id, p))));
    };

    ws.on('profile-updated', handleProfile);
    ws.on('quota-updated', handleQuota);
    ws.on('plans-updated', handlePlans);

    return () => {
      ws.off('profile-updated', handleProfile);
      ws.off('quota-updated', handleQuota);
      ws.off('plans-updated', handlePlans);
    };
  }, [userProfile?.uid, userProfile?.isApproved, userProfile?.role]);

  // Which features this account may see.
  //
  // Re-read on the 'features-updated' broadcast rather than receiving a payload: the map is
  // per-account once exceptions exist, so there is no single object the server could send
  // that is correct for everyone. An admin releasing something therefore lands live here
  // without a reload.
  //
  // A failure leaves the map empty, which reads as everything released. That is the
  // deliberate direction: the server still refuses gated endpoints, so the worst case is a
  // customer seeing a nav item that reports the feature is unavailable — far better than a
  // failed request emptying their sidebar.
  const loadFeatures = useCallback(async () => {
    try {
      setFeatures(await fetchFeatures());
    } catch (err) {
      console.warn('[App] Could not read feature availability, showing everything:', err.message);
      setFeatures({});
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setFeatures({});
      return;
    }
    loadFeatures();

    // subscribeSocket rather than getSocket(): the socket is opened by a different effect
    // and may not exist yet on this pass. getSocket() would return null, silently leave no
    // listener, and an admin's change would then only land on the next reload.
    let attached = null;
    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('features-updated', loadFeatures);
      attached = null;
      if (socket) {
        socket.on('features-updated', loadFeatures);
        attached = socket;
      }
    });

    return () => {
      unsubscribe();
      if (attached) attached.off('features-updated', loadFeatures);
    };
  }, [user?.uid, loadFeatures]);

  // Load the plan catalogue once signed in, so limits resolve from the plan
  // rather than the built-in fallbacks. Updates arrive via 'plans-updated'.
  useEffect(() => {
    if (!user) {
      setPlans([]);
      return;
    }

    let cancelled = false;
    loadPlansOnce()
      .then((list) => {
        if (!cancelled) setPlans(list);
      })
      .catch((err) => {
        console.warn('[App] Plan catalogue unavailable, using built-in defaults:', err.message);
        if (!cancelled) setPlans([]);
      });

    return () => { cancelled = true; };
  }, [user?.uid]);

  // Saved contacts, reloaded when the account or the active WhatsApp session
  // changes. The session matters because the server resolves each contact to the
  // conversation it maps to in that session, which is what lets a saved name be
  // matched to an @lid-keyed chat.
  const loadContacts = useCallback(async (sessionId) => {
    if (!user || !(userProfile?.isApproved || userProfile?.role === 'admin')) return;
    try {
      setContacts(await fetchContacts(sessionId || activeSessionIdRef.current));
    } catch (err) {
      // A contact list that fails to load must not break the dashboard; names
      // simply fall back to whatever WhatsApp reported.
      console.warn('[App] Could not load contacts:', err.message);
    }
  }, [user?.uid, userProfile?.isApproved, userProfile?.role]);

  useEffect(() => {
    if (!user) {
      setContacts([]);
      return;
    }
    loadContacts(activeSessionId);
  }, [user?.uid, activeSessionId, loadContacts]);

  // Another tab — or a colleague sharing this account — saving a contact should
  // rename the chat here too.
  useEffect(() => {
    const ws = getSocket();
    if (!ws) return;

    const handleContacts = () => loadContacts(activeSessionIdRef.current);
    ws.on('contacts-updated', handleContacts);
    return () => ws.off('contacts-updated', handleContacts);
  }, [userProfile?.uid, loadContacts]);

  // Team-seat events.
  //
  // workspace-updated  the account's plan or agent count changed (someone bought
  //                    more agents). Everyone's resolved limits move, so re-read
  //                    the profile and the plan catalogue.
  // access-revoked     the supervisor removed this person. The server has already
  //                    revoked their tokens and is about to drop the socket, so the
  //                    only thing left is to clear local state and say why —
  //                    otherwise the app sits there failing every request.
  useEffect(() => {
    const ws = getSocket();
    if (!ws) return;

    const handleWorkspace = async () => {
      try {
        const [profile, list] = await Promise.all([fetchProfile(), loadPlansOnce()]);
        setUserProfile(profile);
        setPlans(list);
      } catch (err) {
        console.warn('[App] Could not refresh after a workspace change:', err.message);
      }
    };

    const handleRevoked = ({ message } = {}) => {
      showToast({
        type: 'error',
        title: 'Access removed',
        message: message || 'Your access to this account has been removed.',
        duration: 9000,
      });
      apiLogout();
      navigateTo('/login');
    };

    const handleDenied = ({ message } = {}) => {
      showToast({
        type: 'error',
        title: 'Not allowed',
        message: message || 'Only the account owner can do that.',
        duration: 6000,
      });
    };

    ws.on('workspace-updated', handleWorkspace);
    ws.on('access-revoked', handleRevoked);
    ws.on('action-denied', handleDenied);

    return () => {
      ws.off('workspace-updated', handleWorkspace);
      ws.off('access-revoked', handleRevoked);
      ws.off('action-denied', handleDenied);
    };
  }, [userProfile?.uid]);

  // Saved name for a chat, keyed by every JID the contact could appear under: the
  // conversation the server resolved (often an @lid) and the plain phone JID.
  //
  // Only names are indexed. The chat list needs a label, not the whole record, and
  // keeping the map to strings means a re-render of the list does not depend on
  // anything else about the contact changing.
  const savedNames = useMemo(() => {
    const map = {};
    contacts.forEach((contact) => {
      const name = (contact.name || '').trim();
      if (!name) return;
      if (contact.chatJid) map[contact.chatJid] = name;
      if (contact.phone) map[`${contact.phone}@s.whatsapp.net`] = name;
    });
    return map;
  }, [contacts]);

  // The full record, keyed the same way. Only the chat window needs this — it lets
  // the "Save contact" button know whether to create or edit, and prefill the form.
  const savedContacts = useMemo(() => {
    const map = {};
    contacts.forEach((contact) => {
      if (contact.chatJid) map[contact.chatJid] = contact;
      if (contact.phone) map[`${contact.phone}@s.whatsapp.net`] = contact;
    });
    return map;
  }, [contacts]);

  // Leave a tab that has just been hidden.
  //
  // An admin can hide a feature while a customer is sitting on it. Without this the pane
  // would render nothing and the sidebar would have no matching item, which looks like the
  // app broke. Messages is the fallback because it is locked and cannot be hidden.
  useEffect(() => {
    if (!activeTab || isVisible(features, activeTab)) return;
    setActiveTab('messages');
  }, [features, activeTab]);

  // Open a conversation from somewhere other than the chat list (the contacts
  // table). A number with no synced history still works: the messages view creates
  // a draft chat for a JID it has not seen.
  const handleOpenChatFor = (jid) => {
    if (!jid) return;
    setActiveChatJid(jid);
    setActiveTab('messages');
  };

  // Handle page focus or tab visibility changes to auto-sync background tabs
  useEffect(() => {
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible' && user && userProfile?.isApproved) {
        fetchChats(activeSessionIdRef.current);
        const currentActiveJid = activeChatJidRef.current;
        if (currentActiveJid) {
          fetchMessages(activeSessionIdRef.current, currentActiveJid);
        }
      }
    };

    document.addEventListener('visibilitychange', handleFocusOrVisibility);
    window.addEventListener('focus', handleFocusOrVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleFocusOrVisibility);
      window.removeEventListener('focus', handleFocusOrVisibility);
    };
  }, [user, userProfile]);

  // =============================================
  // SOCKET EVENT LISTENERS (multi-session aware)
  // =============================================
  const setupSocketListeners = (ws) => {
    if (!ws) return;

    ws.on('connect', () => {
      console.log('Socket.io connected securely');
      // Server will send 'all-sessions' on connect
    });

    // Receive all existing WA sessions on first connect
    ws.on('all-sessions', (sessions) => {
      console.log('[App] Received all-sessions:', sessions);
      setWaSessions(sessions);
      
      // If there are sessions, pick the first connected one or the first one
      if (sessions.length > 0) {
        const connectedSession = sessions.find(s => s.status === 'connected');
        const target = connectedSession || sessions[0];
        setActiveSessionId(target.sessionId);
        setConnectionStatus(target.status);
        setQrCode(target.qr || null);
        setUserInfo(target.user || null);
        
        if (target.status === 'connected') {
          fetchChats(target.sessionId);
        }
      } else {
        // No sessions exist — init default
        ws.emit('init-session', { sessionId: 'default' });
        setWaSessions([{ sessionId: 'default', status: 'connecting', qr: null, user: null }]);
        setActiveSessionId('default');
        setConnectionStatus('connecting');
      }
    });

    ws.on('status-change', (data) => {
      const { sessionId, status, qr, user } = data;

      // Add status change notification
      if (status === 'connected') {
        setNotifications(prev => [
          {
            id: `status_${Date.now()}`,
            title: `Session Connected`,
            message: `WhatsApp session (${sessionId}) connected successfully.`,
            time: new Date().toISOString(),
            type: 'success',
            read: false
          },
          ...prev
        ]);
      } else if (status === 'disconnected') {
        setNotifications(prev => [
          {
            id: `status_${Date.now()}`,
            title: `Session Disconnected`,
            message: `WhatsApp session (${sessionId}) has disconnected.`,
            time: new Date().toISOString(),
            type: 'error',
            read: false
          },
          ...prev
        ]);
      }

      // Update waSessions array
      setWaSessions(prev => {
        const idx = prev.findIndex(s => s.sessionId === sessionId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], status, qr: qr || null, user: user || updated[idx].user };
          return updated;
        } else {
          return [...prev, { sessionId, status, qr: qr || null, user: user || null }];
        }
      });

      // Only update main view state if this is the active session
      if (sessionId === activeSessionIdRef.current) {
        setConnectionStatus(status);
        setQrCode(qr || null);
        if (user) setUserInfo(user);

        if (status === 'connected') {
          fetchChats(sessionId);
          const currentActiveJid = activeChatJidRef.current;
          if (currentActiveJid) {
            fetchMessages(sessionId, currentActiveJid);
          }
        } else if (status === 'disconnected') {
          setChats([]);
          setActiveChatJid(null);
          setMessages([]);
        }
      }
    });

    ws.on('new-message', (data) => {
      const { sessionId } = data;
      if (sessionId !== activeSessionIdRef.current) return;
      
      fetchChats(sessionId);
      const currentActiveJid = activeChatJidRef.current;
      if (currentActiveJid && data.jid === currentActiveJid) {
        setMessages(prev => {
          const idx = prev.findIndex(m => m.key.id === data.message.key.id);
          if (idx === -1) return [...prev, data.message];
          // The same message can arrive twice: once from our own send (carrying the
          // agent who sent it) and once echoed back by WhatsApp (without it). If the
          // unstamped echo won the race, backfill the name so the badge is not lost.
          if (data.message.agentName && !prev[idx].agentName) {
            const next = prev.slice();
            next[idx] = { ...next[idx], agentName: data.message.agentName };
            return next;
          }
          return prev;
        });
      }

      // Add real-time message notification
      if (data.message && !data.message.key.fromMe) {
        const msgText = data.message.message?.conversation || 
                       data.message.message?.extendedTextMessage?.text || 
                       'Received media attachment.';
        
        setNotifications(prev => [
          {
            id: `msg_${Date.now()}`,
            title: `New Message`,
            message: `From +${data.jid.split('@')[0]}: ${msgText.substring(0, 60)}${msgText.length > 60 ? '...' : ''}`,
            time: new Date().toISOString(),
            type: 'message',
            read: false
          },
          ...prev
        ]);
      }
    });

    ws.on('message-update', (data) => {
      const { sessionId } = data;
      if (sessionId !== activeSessionIdRef.current) return;
      
      // Update message status in the main chat pane if currently open
      if (activeChatJidRef.current && data.key.remoteJid === activeChatJidRef.current) {
        setMessages(prev => 
          prev.map(m => m.key.id === data.key.id ? { ...m, ...data.update } : m)
        );
      }

      // Also update the check status in the left sidebar chat row
      if (data.update && data.update.status !== undefined) {
        setChats(prev => 
          prev.map(chat => {
            if (chat.id === data.key.remoteJid) {
              return {
                ...chat,
                lastMessageStatus: data.update.status
              };
            }
            return chat;
          })
        );
      }
    });

    ws.on('history-sync-complete', (data) => {
      const { sessionId } = data;
      if (sessionId !== activeSessionIdRef.current) return;
      
      fetchChats(sessionId);
      const currentActiveJid = activeChatJidRef.current;
      if (currentActiveJid) {
        fetchMessages(sessionId, currentActiveJid);
      }
    });

    ws.on('store-cleared', (data) => {
      const { sessionId } = data;
      if (sessionId !== activeSessionIdRef.current) return;
      
      setChats([]);
      setActiveChatJid(null);
      setMessages([]);
    });

    ws.on('session-blocked', (data) => {
      setIsSessionBlocked(true);
      disconnectSocket();
    });

    ws.on('session-count-update', (data) => {
      setActiveSessionCount(data.count);
    });
  };

  // =============================================
  // SESSION SWITCHING
  // =============================================
  const handleSwitchSession = (sessionId) => {
    setActiveSessionId(sessionId);
    activeSessionIdRef.current = sessionId;

    // Clear current view
    setChats([]);
    setActiveChatJid(null);
    setMessages([]);
    setSearchQuery('');

    // Find this session in our list
    const session = waSessions.find(s => s.sessionId === sessionId);
    if (session) {
      setConnectionStatus(session.status);
      setQrCode(session.qr || null);
      setUserInfo(session.user || null);

      if (session.status === 'connected') {
        fetchChats(sessionId);
      }
    } else {
      // Session doesn't exist yet (new), init it
      setConnectionStatus('connecting');
      setQrCode(null);
      setUserInfo(null);
      const ws = getSocket();
      if (ws) {
        ws.emit('init-session', { sessionId });
      }
    }
  };

  const handleAddSession = () => {
    const newId = `session_${Date.now()}`;
    
    // Add to local state immediately
    setWaSessions(prev => [...prev, { sessionId: newId, status: 'connecting', qr: null, user: null }]);
    
    // Switch to the new session
    setActiveSessionId(newId);
    activeSessionIdRef.current = newId;
    setConnectionStatus('connecting');
    setQrCode(null);
    setUserInfo(null);
    setChats([]);
    setActiveChatJid(null);
    setMessages([]);
    setSearchQuery('');

    // Tell server to init
    const ws = getSocket();
    if (ws) {
      ws.emit('init-session', { sessionId: newId });
    }
  };

  const handleRemoveSession = (sessionId) => {
    if (!window.confirm('Are you sure you want to disconnect and remove this WhatsApp number?')) return;

    const ws = getSocket();
    if (ws) {
      ws.emit('logout-session', { sessionId });
    }

    // Remove from local list
    setWaSessions(prev => prev.filter(s => s.sessionId !== sessionId));

    // If it was the active session, switch to another
    if (activeSessionIdRef.current === sessionId) {
      const remaining = waSessions.filter(s => s.sessionId !== sessionId);
      if (remaining.length > 0) {
        handleSwitchSession(remaining[0].sessionId);
      } else {
        // No sessions left, create default
        handleAddSession();
      }
    }
  };

  // =============================================
  // DATA FETCHERS (session-scoped)
  // =============================================
  const fetchStatus = async (sessionId) => {
    const sid = sessionId || activeSessionIdRef.current;
    try {
      const res = await fetchWithAuth(`/api/status?sessionId=${sid}`);
      const data = await res.json();
      
      if (sid === activeSessionIdRef.current) {
        setConnectionStatus(data.status);
        setQrCode(data.qr);
        setUserInfo(data.user);
        
        if (data.status === 'connected') {
          fetchChats(sid);
        }
      }
    } catch (err) {
      console.error('Error fetching connection status:', err);
      if (sid === activeSessionIdRef.current) {
        setConnectionStatus('disconnected');
      }
    }
  };



  // Handle Website Logout
  const handleWebsiteLogout = async () => {
    const confirmLogout = window.confirm('Are you sure you want to sign out of the dashboard?');
    if (!confirmLogout) return;

    // Capture the email before the sign-out clears the user object.
    const signedOutEmail = user?.email;

    try {
      setLoading(true);
      // Revokes the refresh token server-side, so the session cannot be resumed
      // from another tab that still has it cached.
      await apiLogout();
      disconnectSocket();
      navigateTo('/');
      showToast({
        type: 'logout',
        title: 'Signed out',
        message: signedOutEmail
          ? `${signedOutEmail} has been signed out.`
          : 'You have been signed out of the dashboard.',
      });
    } catch (e) {
      console.error('Website signout failed:', e);
      showToast({
        type: 'error',
        title: 'Sign out failed',
        message: e.message || 'Could not sign out. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle WhatsApp Session Disconnect for the active session
  const handleWhatsAppLogout = async () => {
    const confirmLogout = window.confirm('Are you sure you want to disconnect your WhatsApp account? This will unlink your device.');
    if (!confirmLogout) return;

    try {
      setLoading(true);
      await fetchWithAuth('/api/logout', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSessionId })
      });
    } catch (e) {
      console.error('WhatsApp logout failed:', e);
      alert('Failed to disconnect WhatsApp session.');
    } finally {
      setLoading(false);
    }
  };

  // Load messages when selecting a chat
  useEffect(() => {
    if (activeChatJid) {
      fetchMessages(activeSessionIdRef.current, activeChatJid);
      
      // Clear unread count locally for visual response
      setChats(prev => 
        prev.map(c => c.id === activeChatJid ? { ...c, unreadCount: 0 } : c)
      );
    }
  }, [activeChatJid]);

  // Load connection status when approved customer logs in
  useEffect(() => {
    if (user && userProfile && userProfile.isApproved && userProfile.role === 'customer') {
      fetchStatus(activeSessionIdRef.current);
    }
  }, [user, userProfile]);

  let activeChat = Array.isArray(chats) ? chats.find(c => c.id === activeChatJid) : null;
  if (!activeChat && activeChatJid) {
    const cleanId = activeChatJid.split('@')[0];
    if (/^\d+$/.test(cleanId)) {
      activeChat = {
        id: activeChatJid,
        name: '+' + cleanId,
        phoneNumber: '+' + cleanId,
        unreadCount: 0
      };
    }
  }

  // 1. Loading State Screen
  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', width: '100vw', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main)' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  // 1.5. Session Blocked Screening
  if (isSessionBlocked) {
    return (
      <div className="connection-overlay">
        <div className="connection-card glass" style={{ maxWidth: '440px', padding: '40px' }}>
          <div className="welcome-logo-wrapper" style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.2)', margin: '0 auto 24px auto' }}>
            <AlertTriangle size={36} />
          </div>
          <h2 className="connection-title">Session Already Active</h2>
          <p className="connection-subtitle" style={{ marginBottom: '24px' }}>
            This account is currently logged in on another device or browser tab.
          </p>
          <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.08)', borderLeft: '4px solid #ef4444', borderRadius: '6px', textAlign: 'left', fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '30px' }}>
            Please log out from the previous device or tab first to access the dashboard on this device.
          </div>
          <button className="logout-button" onClick={() => {
            setIsSessionBlocked(false);
            apiLogout();
            navigateTo('/login');
          }} style={{ width: '100%', padding: '12px' }}>
            Back to Sign In
          </button>
        </div>
      </div>
    );
  }

  // 1b. Invitation link.
  //
  // Checked before the `!user` gate so an already-signed-in person opening a link
  // still lands on the accept screen rather than their own dashboard — which is what
  // happens when a supervisor tests the link they just generated.
  if (currentPath === '/accept-invite') {
    const inviteToken = new URLSearchParams(window.location.search).get('token');
    return (
      <AcceptInvite
        token={inviteToken}
        onAccepted={(invitedUser) => {
          navigateTo('/dashboard');
          showToast({
            type: 'success',
            title: 'You are in',
            message: invitedUser?.email
              ? `Signed in as ${invitedUser.email}.`
              : 'Your account is ready.',
            duration: 4200,
          });
        }}
        onGoToLogin={() => navigateTo('/login')}
      />
    );
  }

  // 2. Unauthenticated Routing (SaaS Landing & Login/Register Panels)
  if (!user) {
    if (currentPath === '/login') {
      return (
        <AuthScreens 
          type="login" 
          onSwitchType={() => navigateTo('/register')} 
          onBackToHome={() => navigateTo('/')}
          onAuthSuccess={(signedInUser) => {
            navigateTo('/dashboard');
            showToast({
              type: 'success',
              title: 'Signed in',
              message: signedInUser?.email
                ? `Welcome back, ${signedInUser.email}.`
                : 'Welcome back.',
            });
          }}
        />
      );
    }
    if (currentPath === '/register') {
      return (
        <AuthScreens 
          type="register" 
          onSwitchType={() => navigateTo('/login')} 
          onBackToHome={() => navigateTo('/')}
          onAuthSuccess={(newUser) => {
            navigateTo('/dashboard');
            showToast({
              type: 'success',
              title: 'Account created',
              message: newUser?.email
                ? `Welcome, ${newUser.email}. Your account is ready.`
                : 'Your account has been created.',
              duration: 4200,
            });
          }}
        />
      );
    }
    return (
      <LandingPage 
        onGoToDashboard={() => navigateTo('/login')} 
      />
    );
  }

  // 3. Admin Account Routing
  if (userProfile && userProfile.role === 'admin') {
    return (
      <AdminDashboard 
        user={user} 
        onLogout={handleWebsiteLogout} 
      />
    );
  }

  // 4. Pending Approval Screening
  if (userProfile && !userProfile.isApproved) {
    return (
      <div className="connection-overlay">
        <div className="connection-card glass" style={{ maxWidth: '440px', padding: '40px' }}>
          <div className="welcome-logo-wrapper" style={{ color: '#f59e0b', borderColor: 'rgba(245,158,11,0.2)', margin: '0 auto 24px auto' }}>
            <Clock size={36} />
          </div>
          <h2 className="connection-title">Pending Verification</h2>
          <p className="connection-subtitle" style={{ marginBottom: '24px' }}>
            Your account has been registered successfully but requires administrator approval.
          </p>
          <div style={{ padding: '16px', background: 'rgba(245, 158, 11, 0.08)', borderLeft: '4px solid #f59e0b', borderRadius: '6px', textAlign: 'left', fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '30px' }}>
            Please contact your system administrator to approve access for: <br />
            <strong>{user.email}</strong>
          </div>
          <button className="logout-button" onClick={handleWebsiteLogout} style={{ width: '100%', padding: '12px' }}>
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Resolve the limits that apply to this customer from their plan, then hand
  // the enriched profile to the dashboard. Children keep reading
  // `userProfile.messageLimit` / `.sessionLimit` as before; those values are now
  // plan-derived unless an admin set an explicit override on the account.
  const effectiveLimits = userProfile ? resolveEffectiveLimits(userProfile, plans) : null;
  const activeProfile = userProfile
    ? {
        ...userProfile,
        planId: effectiveLimits.planId,
        planName: effectiveLimits.planName,
        messageLimit: effectiveLimits.messageLimit,
        sessionLimit: effectiveLimits.sessionLimit,
      }
    : userProfile;

  // Calculate trial status. The trial length comes from the plan, so a plan with
  // trialDays of 0 has no countdown at all.
  const trialDays = effectiveLimits?.trialDays ?? 0;
  let isTrialExpired = userProfile?.trialExpired || false;
  let trialDaysLeft = trialDays;
  if (userProfile && userProfile.role !== 'admin' && trialDays > 0) {
    let createdAtDate = new Date();
    if (userProfile.createdAt) {
      if (typeof userProfile.createdAt.toDate === 'function') {
        createdAtDate = userProfile.createdAt.toDate();
      } else if (userProfile.createdAt.seconds) {
        createdAtDate = new Date(userProfile.createdAt.seconds * 1000);
      } else {
        createdAtDate = new Date(userProfile.createdAt);
      }
    }
    const differenceMs = Date.now() - createdAtDate.getTime();
    const differenceDays = differenceMs / (1000 * 60 * 60 * 24);
    if (differenceDays >= trialDays) {
      isTrialExpired = true;
    } else {
      trialDaysLeft = Math.max(0, trialDays - Math.floor(differenceDays));
    }
  }

  // Check: is the active WA session connected?
  const activeWaSession = waSessions.find(s => s.sessionId === activeSessionId);
  const isActiveConnected = connectionStatus === 'connected';

  // Whether this person owns the account or was invited into someone else's.
  // `ownerUserId` is null for an owner. Defaulting to true keeps the pre-team
  // behaviour for any profile payload that predates the field.
  const isSupervisor = !userProfile?.ownerUserId;

  // Render a gated view.
  //
  // Three outcomes, matching the three rollout states: released renders the feature,
  // coming soon renders the placeholder so the nav item leads somewhere that explains
  // itself, and hidden renders nothing — the effect above has already moved the customer
  // off it, and returning null covers the render in between.
  //
  // Kept as one helper rather than repeated per tab so a new gated view cannot accidentally
  // implement only two of the three cases.
  const gated = (key, node) => {
    const status = featureStatus(features, key);
    if (status === 'hidden') return null;
    if (status === 'coming_soon') {
      return <ComingSoon label={featureLabel(key)} onBack={() => setActiveTab('messages')} />;
    }
    return node;
  };

  // 5. Approved Customer Dashboard
  return (
    <div className="dashboard-container" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <div className={`sidebar-wrapper ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <Sidebar 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            onLogout={handleWebsiteLogout}
            collapsed={sidebarCollapsed}
            notifications={notifications}
            isSupervisor={isSupervisor}
            features={features}
          />
        </div>
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <TopBar 
            user={user} 
            userProfile={activeProfile} 
            connectionStatus={connectionStatus}
            userInfo={userInfo}
            onWhatsAppLogout={handleWhatsAppLogout}
            waSessions={waSessions}
            activeSessionId={activeSessionId}
            onSwitchSession={handleSwitchSession}
            onAddSession={handleAddSession}
            onRemoveSession={handleRemoveSession}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
            syncing={isSyncing}
            onSyncHistory={handleSyncHistory}
            notifications={notifications}
            onToggleNotifications={() => setShowNotificationsDrawer(prev => !prev)}
            isSupervisor={isSupervisor}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />
          <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
            {isTrialExpired && activeTab !== 'subscription' && activeTab !== 'profile' && (
              <div className="upgrade-overlay">
                <div className="upgrade-card glass">
                  <div style={{ background: 'rgba(239, 68, 68, 0.1)', width: '60px', height: '60px', borderRadius: '50%', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
                    <AlertTriangle size={32} />
                  </div>
                  <h3 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '12px' }}>Free Trial Expired</h3>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '24px', fontSize: '0.95rem', lineHeight: '1.5' }}>
                    Your 7-day free trial has ended. Subscribe to Premium to continue using the dashboard.
                  </p>
                  <button 
                    className="upgrade-btn" 
                    style={{ width: '100%', padding: '14px', borderRadius: '8px' }}
                    onClick={() => setActiveTab('subscription')}
                  >
                    Upgrade to Premium
                  </button>
                </div>
              </div>
            )}
            
            <div className={isTrialExpired && activeTab !== 'subscription' && activeTab !== 'profile' ? 'blurry-workspace' : ''} style={{ display: 'flex', flex: 1, position: 'relative' }}>
              {!isActiveConnected && (activeTab === 'dashboard' || activeTab === 'messages') ? (
                <ConnectionPanel status={connectionStatus} qrCode={qrCode} />
              ) : (
                <>
                  {activeTab === 'dashboard' && gated('dashboard',
                    <Dashboard 
                      chats={chats}
                      userProfile={activeProfile}
                      userInfo={userInfo}
                      waSessions={waSessions}
                      savedNames={savedNames}
                      activeSessionId={activeSessionId}
                      connectionStatus={connectionStatus}
                      onOpenChat={handleOpenChatFor}
                      contactCount={contacts.length}
                      notifications={notifications}
                      isSupervisor={isSupervisor}
                      onNavigate={setActiveTab}
                      features={features}
                    />
                  )}

                  {activeTab === 'messages' && (
                    <MessageDashboard 
                      chats={chats}
                      setChats={setChats}
                      searchQuery={searchQuery}
                      setSearchQuery={setSearchQuery}
                      activeChatJid={activeChatJid}
                      setActiveChatJid={setActiveChatJid}
                      activeChat={activeChat}
                      messages={messages}
                      setMessages={setMessages}
                      userInfo={userInfo}
                      userProfile={activeProfile}
                      user={user}
                      onLogout={handleWhatsAppLogout}
                      activeSessionId={activeSessionId}
                      savedNames={savedNames}
                      savedContacts={savedContacts}
                    />
                  )}
                </>
              )}

              {activeTab === 'contacts' && gated('contacts',
                <Contacts
                  activeSessionId={activeSessionId}
                  onOpenChat={handleOpenChatFor}
                />
              )}

              {/* Supervisor-only, matching the sidebar and the server. Guarded here
                  too so a stale activeTab cannot render it for a member. */}
              {activeTab === 'team' && isSupervisor && gated('team',
                <Team userProfile={activeProfile} />
              )}

              {/* Supervisor-only, guarded here as well as in the sidebar so a stale
                  activeTab cannot render it for an invited member. */}
              {activeTab === 'activity' && isSupervisor && gated('activity',
                <ConversationLog
                  variant="page"
                  chats={chats}
                  userInfo={userInfo}
                  savedNames={savedNames}
                  activeSessionId={activeSessionId}
                  onOpenChat={handleOpenChatFor}
                />
              )}

              {activeTab === 'notifications' && gated('notifications',
                <NotificationsView 
                  notifications={notifications}
                  setNotifications={setNotifications}
                />
              )}

              {activeTab === 'subscription' && isSupervisor && (
                <Subscription 
                  userProfile={activeProfile} 
                  activeSessionCount={activeSessionCount} 
                  plans={plans}
                />
              )}

              {activeTab === 'profile' && (
                <Profile user={user} userProfile={activeProfile} />
              )}

              {activeTab === 'settings' && gated('settings',
                <Settings />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Right Slide-out Notifications Drawer */}
      {showNotificationsDrawer && (
        <div 
          style={{ 
            position: 'fixed', 
            top: 0, 
            right: 0, 
            bottom: 0, 
            width: '360px', 
            backgroundColor: 'var(--bg-sidebar)', 
            borderLeft: '1px solid var(--border-color)', 
            zIndex: 1000, 
            boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideIn 0.2s ease-out'
          }}
        >
          {/* Drawer Header */}
          <div style={{ padding: '20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bell size={18} style={{ color: 'var(--primary)' }} />
              Notifications
            </h3>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button 
                onClick={() => {
                  setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                }}
                style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer' }}
                title="Mark all as read"
              >
                Mark all read
              </button>
              <button 
                onClick={() => setShowNotificationsDrawer(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dimmed)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Drawer List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
            {notifications.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {notifications.map(n => (
                  <div 
                    key={n.id}
                    onClick={() => {
                      setNotifications(prev => prev.map(item => item.id === n.id ? { ...item, read: true } : item));
                    }}
                    style={{ 
                      padding: '12px', 
                      borderRadius: '8px', 
                      border: '1px solid var(--border-color)', 
                      backgroundColor: n.read ? 'var(--bg-main)' : 'var(--primary-subtle)',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: n.read ? '500' : '700', color: 'var(--text-main)' }}>
                        {n.title}
                      </span>
                      {!n.read && (
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--primary)', flexShrink: 0, marginTop: '4px' }} />
                      )}
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: '1.3' }}>
                      {n.message}
                    </p>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-dimmed)', display: 'block', marginTop: '6px' }}>
                      {new Date(n.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-dimmed)' }}>
                <p style={{ fontSize: '0.88rem', margin: 0 }}>No notifications yet</p>
              </div>
            )}
          </div>

          {/* Drawer Footer */}
          <div style={{ padding: '16px', borderTop: '1px solid var(--border-color)', display: 'flex' }}>
            <button 
              onClick={() => {
                setShowNotificationsDrawer(false);
                setActiveTab('notifications');
              }}
              style={{ 
                width: '100%', 
                padding: '10px', 
                backgroundColor: 'var(--primary-soft)',
                color: 'var(--primary)', 
                border: 'none', 
                borderRadius: '8px', 
                fontSize: '0.85rem', 
                fontWeight: '600', 
                cursor: 'pointer',
                textAlign: 'center'
              }}
            >
              View All Notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
