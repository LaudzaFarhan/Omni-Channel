import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookUser, Search, Plus, Upload, Download, Trash2, Pencil,
  MessageSquare, AlertTriangle, X, RefreshCw, Tag,
} from 'lucide-react';
import {
  fetchContacts, fetchContactTags, saveContact, updateContact,
  deleteContact, deleteContactsBulk, importContacts,
} from '../utils/api.js';
import { subscribeSocket } from '../utils/socket.js';
import { showToast } from '../utils/toastBus.js';
import { formatPhone } from '../utils/phone.js';
import ContactEditor from './contacts/ContactEditor.jsx';
import ContactImport from './contacts/ContactImport.jsx';

const SORTS = {
  name: { label: 'A – Z', compare: (a, b) => (a.name || '\uffff').localeCompare(b.name || '\uffff') },
  recent: { label: 'Recent message', compare: (a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0) },
  added: { label: 'Newest added', compare: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) },
};

function formatWhen(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;

  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { day: 'numeric', month: 'short', year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

// Saved customer contacts.
//
// These live in Postgres against the account, not in the WhatsApp store: Baileys'
// contact list is rebuilt from WhatsApp on every sync and deleted on logout, so a
// name typed here had to be stored separately to survive. The list works with
// WhatsApp offline; only the "last message" column needs a live session.
export default function Contacts({ activeSessionId = 'default', onOpenChat }) {
  const [contacts, setContacts] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [search, setSearch] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sortKey, setSortKey] = useState('name');

  const [selected, setSelected] = useState(new Set());
  const [editing, setEditing] = useState(null); // contact object, or {} for a new one
  const [importing, setImporting] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, tagList] = await Promise.all([
        fetchContacts(activeSessionId),
        fetchContactTags(),
      ]);
      setContacts(list);
      setTags(tagList);
      setError(null);
    } catch (err) {
      console.error('[Contacts] Load failed:', err);
      setError(err.message || 'Could not load contacts.');
    } finally {
      setLoading(false);
    }
  }, [activeSessionId]);

  useEffect(() => { load(); }, [load]);

  // Another tab of the same account saving a contact should show up here, the same
  // way plan and hold changes propagate.
  useEffect(() => {
    let attached = null;
    const handleUpdated = () => load();

    const unsubscribe = subscribeSocket((socket) => {
      if (attached) attached.off('contacts-updated', handleUpdated);
      attached = null;
      if (socket) {
        socket.on('contacts-updated', handleUpdated);
        attached = socket;
      }
    });

    return () => {
      unsubscribe();
      if (attached) attached.off('contacts-updated', handleUpdated);
    };
  }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const queryDigits = query.replace(/\D/g, '');

    return contacts
      .filter((c) => {
        if (tagFilter && !c.tags.some(t => t.toLowerCase() === tagFilter.toLowerCase())) return false;
        if (!query) return true;

        const haystack = [c.name, c.phone, c.email, c.company, c.note, ...(c.tags || [])]
          .filter(Boolean).join(' ').toLowerCase();
        if (haystack.includes(query)) return true;

        // Searching "0812…" must find a contact stored as "62812…".
        return queryDigits.length >= 3 && c.phone.includes(queryDigits.replace(/^0+/, ''));
      })
      .sort(SORTS[sortKey].compare);
  }, [contacts, search, tagFilter, sortKey]);

  // A selection can survive a filter change, so only count what is on screen.
  const visibleIds = useMemo(() => new Set(visible.map(c => c.id)), [visible]);
  const selectedVisible = useMemo(
    () => [...selected].filter(id => visibleIds.has(id)),
    [selected, visibleIds]
  );
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev);
      if (allVisibleSelected) visible.forEach(c => next.delete(c.id));
      else visible.forEach(c => next.add(c.id));
      return next;
    });
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async (payload) => {
    if (editing?.id) {
      await updateContact(editing.id, payload);
      showToast({ type: 'success', title: 'Contact updated', message: payload.name || formatPhone(payload.phone) });
    } else {
      const saved = await saveContact(payload);
      showToast({
        type: 'success',
        title: 'Contact saved',
        message: saved?.name || formatPhone(payload.phone),
      });
    }
    setEditing(null);
    await load();
  };

  const handleDelete = async (contact) => {
    setBusy(true);
    try {
      await deleteContact(contact.id);
      setSelected(prev => { const n = new Set(prev); n.delete(contact.id); return n; });
      showToast({ type: 'success', title: 'Contact deleted', message: contact.name || formatPhone(contact.phone) });
      setConfirm(null);
      await load();
    } catch (err) {
      showToast({ type: 'error', title: 'Delete failed', message: err.message, duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    setBusy(true);
    try {
      const res = await deleteContactsBulk(selectedVisible);
      setSelected(new Set());
      showToast({
        type: 'success',
        title: 'Contacts deleted',
        message: `${res.removed} contact${res.removed === 1 ? '' : 's'} removed.`,
      });
      setConfirm(null);
      await load();
    } catch (err) {
      showToast({ type: 'error', title: 'Delete failed', message: err.message, duration: 5000 });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (rows) => {
    const res = await importContacts(rows);
    const parts = [];
    if (res.created) parts.push(`${res.created} added`);
    if (res.updated) parts.push(`${res.updated} updated`);
    if (res.skipped) parts.push(`${res.skipped} skipped`);

    showToast({
      type: res.skipped && !res.created && !res.updated ? 'error' : 'success',
      title: 'Import finished',
      message: parts.join(', ') || 'Nothing changed.',
      duration: 6000,
    });
    setImporting(false);
    await load();
  };

  // Export what is currently on screen, so a filtered view exports that subset.
  const handleExport = () => {
    const escape = (value) => {
      const text = String(value ?? '');
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const header = ['name', 'phone', 'email', 'company', 'tags', 'note'];
    const lines = [header.join(',')];
    visible.forEach((c) => {
      lines.push([c.name, c.phone, c.email, c.company, (c.tags || []).join(';'), c.note].map(escape).join(','));
    });

    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openChat = (contact) => {
    if (!contact.chatJid && !contact.phone) return;
    // A contact with no synced conversation still opens: the messages view creates
    // a draft chat for a phone JID it has not seen before.
    onOpenChat?.(contact.chatJid || `${contact.phone}@s.whatsapp.net`);
  };

  const buttonStyle = {
    background: 'transparent', border: '1px solid var(--border-color)',
    color: 'var(--text-muted)', padding: '8px 13px', borderRadius: '8px',
    fontSize: '0.84rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
  };

  return (
    <div className="view-container">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '20px', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <BookUser size={26} style={{ color: 'var(--primary)' }} /> Contacts
          </h2>
          <p>
            Your own customer list. Saved against your account, so it survives a WhatsApp
            reconnect and is shared across every number you connect.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', paddingTop: '8px' }}>
          <button onClick={() => setImporting(true)} style={buttonStyle}>
            <Upload size={14} /> Import CSV
          </button>
          <button onClick={handleExport} disabled={visible.length === 0}
            style={{ ...buttonStyle, opacity: visible.length === 0 ? 0.5 : 1, cursor: visible.length === 0 ? 'not-allowed' : 'pointer' }}>
            <Download size={14} /> Export
          </button>
          <button className="upgrade-btn" onClick={() => setEditing({})}
            style={{ padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.84rem' }}>
            <Plus size={15} /> Add contact
          </button>
        </div>
      </div>

      <div className="view-content" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        {error && (
          <div style={{ padding: '14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '4px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            <strong style={{ color: '#ef4444' }}>Could not load contacts.</strong> {error}
          </div>
        )}

        {/* Toolbar */}
        <div className="card glass" style={{ padding: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: '200px' }}>
            <Search size={15} style={{ position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dimmed)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, number, company or note…"
              aria-label="Search contacts"
              style={{
                width: '100%', padding: '9px 12px 9px 34px', borderRadius: '8px',
                border: '1px solid var(--border-color)', background: 'var(--bg-panel, var(--bg-sidebar))',
                color: 'var(--text-main)', fontSize: '0.86rem', boxSizing: 'border-box',
              }}
            />
          </div>

          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            aria-label="Filter by tag"
            style={{
              padding: '9px 11px', borderRadius: '8px', border: '1px solid var(--border-color)',
              background: 'var(--bg-panel, var(--bg-sidebar))', color: 'var(--text-main)', fontSize: '0.84rem',
            }}
          >
            <option value="">All tags</option>
            {tags.map(({ tag, count }) => (
              <option key={tag} value={tag}>{tag} ({count})</option>
            ))}
          </select>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            aria-label="Sort contacts"
            style={{
              padding: '9px 11px', borderRadius: '8px', border: '1px solid var(--border-color)',
              background: 'var(--bg-panel, var(--bg-sidebar))', color: 'var(--text-main)', fontSize: '0.84rem',
            }}
          >
            {Object.entries(SORTS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>

          <button onClick={load} style={buttonStyle} title="Reload">
            <RefreshCw size={14} /> Refresh
          </button>

          {selectedVisible.length > 0 && (
            <button
              onClick={() => setConfirm({
                type: 'bulk',
                title: `Delete ${selectedVisible.length} contact${selectedVisible.length === 1 ? '' : 's'}?`,
                body: 'This removes them from your contact list. Their WhatsApp conversations and message history are not affected.',
              })}
              style={{
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#ef4444', padding: '8px 13px', borderRadius: '8px', fontSize: '0.84rem',
                fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px',
              }}
            >
              <Trash2 size={14} /> Delete {selectedVisible.length}
            </button>
          )}
        </div>

        {/* Table */}
        <div className="card glass" style={{ padding: '0', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px' }}><div className="spinner"></div></div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--text-dimmed)' }}>
              <BookUser size={40} style={{ opacity: 0.4, marginBottom: '14px' }} />
              <div style={{ fontSize: '0.95rem', marginBottom: '6px', color: 'var(--text-muted)' }}>
                {contacts.length === 0 ? 'No contacts saved yet.' : 'No contacts match that filter.'}
              </div>
              <div style={{ fontSize: '0.84rem' }}>
                {contacts.length === 0
                  ? 'Add one by hand, or import a CSV from your existing list.'
                  : 'Try clearing the search or the tag filter.'}
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)', color: 'var(--text-dimmed)', fontWeight: '600' }}>
                    <th style={{ padding: '13px 10px 13px 20px', width: '1%' }}>
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleAll}
                        aria-label="Select all contacts shown"
                      />
                    </th>
                    <th style={{ padding: '13px 14px' }}>Name</th>
                    <th style={{ padding: '13px 14px', whiteSpace: 'nowrap', width: '1%' }}>Number</th>
                    <th style={{ padding: '13px 14px' }}>Tags</th>
                    <th style={{ padding: '13px 14px' }}>Last message</th>
                    <th style={{ padding: '13px 20px 13px 14px', whiteSpace: 'nowrap', width: '1%' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((contact) => {
                    const when = formatWhen(contact.lastMessageTimestamp);
                    return (
                      <tr key={contact.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px 10px 12px 20px' }}>
                          <input
                            type="checkbox"
                            checked={selected.has(contact.id)}
                            onChange={() => toggleOne(contact.id)}
                            aria-label={`Select ${contact.name || contact.phone}`}
                          />
                        </td>

                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontWeight: '600' }}>
                            {contact.name || <span style={{ color: 'var(--text-dimmed)', fontWeight: '400' }}>No name</span>}
                          </div>
                          {(contact.company || contact.email) && (
                            <div style={{ fontSize: '0.76rem', color: 'var(--text-dimmed)' }}>
                              {[contact.company, contact.email].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </td>

                        <td style={{ padding: '12px 14px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {formatPhone(contact.phone)}
                        </td>

                        <td style={{ padding: '12px 14px' }}>
                          {contact.tags.length === 0 ? (
                            <span style={{ color: 'var(--text-dimmed)' }}>—</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                              {contact.tags.map(tag => (
                                <button
                                  key={tag}
                                  onClick={() => setTagFilter(tag)}
                                  title={`Filter by ${tag}`}
                                  style={{
                                    fontSize: '0.72rem', fontWeight: '600', padding: '2px 8px',
                                    borderRadius: '5px', color: 'var(--primary)', cursor: 'pointer',
                                    background: 'rgba(0,168,132,0.12)', border: '1px solid rgba(0,168,132,0.25)',
                                  }}
                                >
                                  {tag}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>

                        <td style={{ padding: '12px 14px', color: 'var(--text-muted)', maxWidth: '280px' }}>
                          {contact.lastMessage ? (
                            <>
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {contact.lastMessage}
                              </div>
                              {when && <div style={{ fontSize: '0.74rem', color: 'var(--text-dimmed)' }}>{when}</div>}
                            </>
                          ) : (
                            <span style={{ color: 'var(--text-dimmed)', fontSize: '0.8rem' }}>No conversation yet</span>
                          )}
                        </td>

                        <td style={{ padding: '12px 20px 12px 14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'inline-flex', gap: '6px' }}>
                            <button onClick={() => openChat(contact)} title="Open the conversation"
                              aria-label={`Message ${contact.name || contact.phone}`}
                              style={{ ...buttonStyle, padding: '5px 8px', color: 'var(--primary)', borderColor: 'rgba(0,168,132,0.3)' }}>
                              <MessageSquare size={13} />
                            </button>
                            <button onClick={() => setEditing(contact)} title="Edit"
                              aria-label={`Edit ${contact.name || contact.phone}`}
                              style={{ ...buttonStyle, padding: '5px 8px' }}>
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => setConfirm({
                                type: 'one', contact,
                                title: 'Delete this contact?',
                                body: `${contact.name || formatPhone(contact.phone)} will be removed from your contact list. The WhatsApp conversation and its messages are not affected.`,
                              })}
                              title="Delete"
                              aria-label={`Delete ${contact.name || contact.phone}`}
                              style={{ ...buttonStyle, padding: '5px 8px' }}>
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && contacts.length > 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-dimmed)', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>{visible.length} of {contacts.length} shown</span>
            {tagFilter && (
              <button onClick={() => setTagFilter('')}
                style={{ background: 'transparent', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: 0 }}>
                <Tag size={12} /> clear “{tagFilter}” filter
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <ContactEditor
          contact={editing.id ? editing : null}
          knownTags={tags}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}

      {importing && (
        <ContactImport
          onImport={handleImport}
          onClose={() => setImporting(false)}
        />
      )}

      {confirm && (
        <div role="dialog" aria-modal="true" style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
        }}>
          <div className="glass" style={{
            width: '100%', maxWidth: '450px', padding: '26px', borderRadius: '16px',
            display: 'flex', flexDirection: 'column', gap: '16px',
            border: '1px solid var(--border-color)', background: 'var(--bg-main)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: '700', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={17} style={{ color: '#f59e0b' }} /> {confirm.title}
              </h3>
              <button onClick={() => setConfirm(null)} aria-label="Close"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', margin: 0, lineHeight: '1.55' }}>
              {confirm.body}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => setConfirm(null)}
                style={{ ...buttonStyle, padding: '8px 16px' }}>
                Cancel
              </button>
              <button
                onClick={() => (confirm.type === 'one' ? handleDelete(confirm.contact) : handleBulkDelete())}
                disabled={busy}
                style={{
                  background: '#ef4444', border: 'none', color: '#fff', fontWeight: '600',
                  padding: '8px 18px', borderRadius: '8px', fontSize: '0.85rem',
                  cursor: busy ? 'wait' : 'pointer', opacity: busy ? 0.6 : 1,
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
