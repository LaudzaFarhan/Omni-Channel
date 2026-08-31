import React, { useState, useMemo } from 'react';
import { X, Search, Send, Loader2, Check } from 'lucide-react';
import { getChatDisplayName, getInitials, isSelfChat } from '../../utils/displayName.js';

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
  display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
};

const panelStyle = {
  width: '100%', maxWidth: '460px', maxHeight: '85vh',
  display: 'flex', flexDirection: 'column',
  borderRadius: '16px', overflow: 'hidden',
  border: '1px solid var(--border-color)', background: 'var(--bg-main)',
};

/**
 * Pick one or more conversations to forward a message into.
 *
 * Rendered inline by ChatWindow rather than portalled to document.body, deliberately.
 * The fullscreen element is an ancestor of ChatWindow, and anything portalled out of
 * that subtree is invisible while the chat is expanded.
 *
 * `onForward` receives the selected JIDs and owns the actual sending, because the send
 * path (quota handling, error toasts, socket echo) already lives in ChatWindow.
 */
export default function ForwardDialog({
  chats = [],
  userInfo,
  savedNames = {},
  currentChatId,
  previewText = '',
  onForward,
  onClose,
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);

  // Label every chat once, so filtering and rendering agree and getChatDisplayName is
  // not recomputed per keystroke per row.
  const labelled = useMemo(() => (
    chats
      .filter(c => c?.id)
      .map(c => ({
        chat: c,
        id: c.id,
        label: getChatDisplayName(c, userInfo, savedNames[c.id]),
        isGroup: c.id.endsWith('@g.us'),
        isSelf: isSelfChat(c, userInfo),
      }))
      // Most recent first: forwarding almost always targets an active conversation.
      .sort((a, b) => (b.chat.lastMessageTimestamp || 0) - (a.chat.lastMessageTimestamp || 0))
  ), [chats, userInfo, savedNames]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return labelled;
    return labelled.filter(r =>
      r.label.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)
    );
  }, [labelled, query]);

  const toggle = (jid) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const submit = async () => {
    if (!selected.size || sending) return;
    setSending(true);
    setError(null);
    try {
      await onForward([...selected]);
      onClose();
    } catch (err) {
      // Kept open on failure so the selection is not lost and can be retried.
      setError(err?.message || 'Gagal meneruskan pesan.');
      setSending(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', padding: '16px 18px', borderBottom: '1px solid var(--border-color)',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: 'var(--text-main)' }}>
              Teruskan pesan
            </div>
            {previewText && (
              <div style={{
                fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {previewText}
              </div>
            )}
          </div>
          <button className="icon-button" onClick={onClose} title="Tutup">
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '12px 18px' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '8px 12px', borderRadius: '10px',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-panel, var(--bg-sidebar))',
          }}>
            <Search size={15} style={{ color: 'var(--text-dimmed)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari chat..."
              autoFocus
              style={{
                flex: 1, minWidth: 0, border: 'none', outline: 'none',
                background: 'transparent', color: 'var(--text-main)',
                fontSize: '0.86rem', fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
          {results.length === 0 ? (
            <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-dimmed)' }}>
              {chats.length === 0 ? 'Belum ada chat.' : 'Tidak ada chat yang cocok.'}
            </div>
          ) : results.map(({ id, label, isGroup, isSelf, chat }) => {
            const isChecked = selected.has(id);
            return (
              <button
                key={id}
                onClick={() => toggle(id)}
                aria-pressed={isChecked}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px', width: '100%',
                  padding: '10px 12px', border: 'none', borderRadius: '10px',
                  background: isChecked ? 'var(--overlay-subtle)' : 'transparent',
                  cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                }}
              >
                <div className="header-avatar" style={{ width: '36px', height: '36px', fontSize: '0.76rem', flexShrink: 0 }}>
                  {getInitials(label)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: '0.87rem', fontWeight: '600', color: 'var(--text-main)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {label}
                    {id === currentChatId && (
                      <span style={{ fontSize: '0.72rem', fontWeight: '500', color: 'var(--text-dimmed)', marginLeft: '6px' }}>
                        (chat ini)
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-dimmed)' }}>
                    {isSelf ? 'Catatan pribadi' : isGroup ? 'Grup' : (chat.phoneNumber || '')}
                  </div>
                </div>
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                  background: isChecked ? 'var(--primary)' : 'transparent',
                  color: '#fff',
                }}>
                  {isChecked && <Check size={13} />}
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div style={{ padding: '0 18px 10px', fontSize: '0.8rem', color: '#ef4444' }}>
            {error}
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', padding: '14px 18px', borderTop: '1px solid var(--border-color)',
        }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {selected.size === 0 ? 'Pilih tujuan' : `${selected.size} chat dipilih`}
          </span>
          <button
            className="upgrade-btn"
            onClick={submit}
            disabled={!selected.size || sending}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '9px 18px', borderRadius: '10px',
              opacity: (!selected.size || sending) ? 0.55 : 1,
              cursor: (!selected.size || sending) ? 'not-allowed' : 'pointer',
            }}
          >
            {sending ? <Loader2 size={15} className="spin-icon" /> : <Send size={15} />}
            {sending ? 'Mengirim...' : 'Teruskan'}
          </button>
        </div>
      </div>
    </div>
  );
}
