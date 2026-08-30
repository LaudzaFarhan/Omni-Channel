import React, { useState, useEffect } from 'react';
import { X, UserPlus, Tag, Plus } from 'lucide-react';
import { normalizePhone, formatPhone } from '../../utils/phone.js';

const overlayStyle = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
  display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999, padding: '20px',
};

const panelStyle = {
  width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto',
  padding: '26px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '18px',
  border: '1px solid var(--border-color)', background: 'var(--bg-main)',
};

const labelStyle = {
  display: 'block', fontSize: '0.78rem', fontWeight: '600',
  color: 'var(--text-dimmed)', marginBottom: '6px',
};

const inputStyle = {
  width: '100%', padding: '10px 12px', borderRadius: '8px',
  border: '1px solid var(--border-color)', background: 'var(--bg-panel, var(--bg-sidebar))',
  color: 'var(--text-main)', fontSize: '0.9rem', boxSizing: 'border-box',
};

const EMPTY = { phone: '', name: '', email: '', company: '', note: '', tags: [] };

// Create or edit one saved contact.
//
// The phone field is normalised as it is typed rather than only on submit, so the
// operator can see that 0812... is being stored as +62 812... before they commit —
// silently rewriting the number on save would look like a bug.
export default function ContactEditor({ contact, knownTags = [], onSave, onClose }) {
  const [form, setForm] = useState(EMPTY);
  const [tagDraft, setTagDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (contact) {
      setForm({
        phone: contact.phone || '',
        name: contact.name || '',
        email: contact.email || '',
        company: contact.company || '',
        note: contact.note || '',
        tags: Array.isArray(contact.tags) ? contact.tags : [],
      });
    } else {
      setForm(EMPTY);
    }
    setError(null);
    setTagDraft('');
  }, [contact]);

  const isEdit = Boolean(contact?.id);
  const normalized = normalizePhone(form.phone);
  const update = (patch) => setForm(prev => ({ ...prev, ...patch }));

  const addTag = (label) => {
    const clean = String(label || '').trim().slice(0, 40);
    if (!clean) return;
    if (form.tags.some(t => t.toLowerCase() === clean.toLowerCase())) {
      setTagDraft('');
      return;
    }
    update({ tags: [...form.tags, clean] });
    setTagDraft('');
  };

  const removeTag = (label) =>
    update({ tags: form.tags.filter(t => t !== label) });

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;

    if (!normalized) {
      setError('Enter a valid WhatsApp number, for example 0812xxxxxxx.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        phone: normalized,
        name: form.name.trim(),
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        note: form.note.trim() || null,
        tags: form.tags,
      });
    } catch (err) {
      setError(err.message || 'Could not save the contact.');
    } finally {
      setSaving(false);
    }
  };

  // Tags the operator already uses elsewhere, minus the ones on this contact.
  const suggestions = knownTags
    .map(t => (typeof t === 'string' ? t : t.tag))
    .filter(t => t && !form.tags.some(existing => existing.toLowerCase() === t.toLowerCase()))
    .slice(0, 8);

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit contact' : 'Add contact'}>
      <form className="glass" style={panelStyle} onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <UserPlus size={18} style={{ color: 'var(--primary)' }} />
            {isEdit ? 'Edit contact' : 'Add contact'}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>

        {error && (
          <div style={{ padding: '12px 14px', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', borderLeft: '3px solid #ef4444', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            {error}
          </div>
        )}

        <div>
          <label style={labelStyle} htmlFor="contact-phone">WhatsApp number *</label>
          <input
            id="contact-phone"
            style={inputStyle}
            value={form.phone}
            onChange={(e) => update({ phone: e.target.value })}
            placeholder="0812xxxxxxx or +62812xxxxxxx"
            autoFocus={!isEdit}
            required
          />
          <div style={{ fontSize: '0.75rem', marginTop: '5px', color: normalized ? 'var(--primary)' : 'var(--text-dimmed)' }}>
            {form.phone.trim() === ''
              ? 'Stored in international form, so 0812… becomes 62812…'
              : normalized
                ? `Will be saved as ${formatPhone(normalized)}`
                : 'That does not look like a phone number yet.'}
          </div>
        </div>

        <div>
          <label style={labelStyle} htmlFor="contact-name">Name</label>
          <input
            id="contact-name"
            style={inputStyle}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="Customer name"
            autoFocus={isEdit}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
          <div>
            <label style={labelStyle} htmlFor="contact-email">Email</label>
            <input id="contact-email" type="email" style={inputStyle}
              value={form.email} onChange={(e) => update({ email: e.target.value })} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="contact-company">Company</label>
            <input id="contact-company" style={inputStyle}
              value={form.company} onChange={(e) => update({ company: e.target.value })} />
          </div>
        </div>

        <div>
          <label style={labelStyle} htmlFor="contact-tag-draft">
            <Tag size={12} style={{ verticalAlign: '-1px', marginRight: '4px' }} /> Tags
          </label>

          {form.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {form.tags.map(tag => (
                <span key={tag} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  fontSize: '0.75rem', fontWeight: '600', padding: '3px 6px 3px 9px',
                  borderRadius: '5px', color: 'var(--primary)',
                  background: 'rgba(0,168,132,0.12)', border: '1px solid rgba(0,168,132,0.25)',
                }}>
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} aria-label={`Remove tag ${tag}`}
                    style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', display: 'inline-flex', padding: 0 }}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              id="contact-tag-draft"
              style={{ ...inputStyle, flex: 1 }}
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                // Enter adds the tag rather than submitting the whole form, which
                // is what people expect from a tag box.
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(tagDraft);
                }
              }}
              placeholder="Type a tag and press Enter"
            />
            <button type="button" onClick={() => addTag(tagDraft)} disabled={!tagDraft.trim()}
              style={{
                background: 'transparent', border: '1px solid var(--border-color)',
                color: 'var(--text-muted)', borderRadius: '8px', padding: '0 12px',
                cursor: tagDraft.trim() ? 'pointer' : 'not-allowed',
                display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem',
              }}>
              <Plus size={13} /> Add
            </button>
          </div>

          {suggestions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)' }}>Reuse:</span>
              {suggestions.map(tag => (
                <button key={tag} type="button" onClick={() => addTag(tag)}
                  style={{
                    background: 'transparent', border: '1px dashed var(--border-color)',
                    color: 'var(--text-muted)', borderRadius: '5px', padding: '2px 8px',
                    fontSize: '0.74rem', cursor: 'pointer',
                  }}>
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label style={labelStyle} htmlFor="contact-note">Note</label>
          <textarea id="contact-note" rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            value={form.note} onChange={(e) => update({ note: e.target.value })}
            placeholder="Anything worth remembering about this customer" />
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button type="button" onClick={onClose}
            style={{
              background: 'transparent', border: '1px solid var(--border-color)',
              color: 'var(--text-muted)', padding: '9px 18px', borderRadius: '8px',
              fontSize: '0.85rem', cursor: 'pointer',
            }}>
            Cancel
          </button>
          <button type="submit" className="upgrade-btn" disabled={saving || !normalized}
            style={{ padding: '9px 20px', opacity: saving || !normalized ? 0.6 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Save contact'}
          </button>
        </div>
      </form>
    </div>
  );
}
