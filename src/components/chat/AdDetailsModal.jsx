import React, { useState } from 'react';
import { X, Megaphone, ExternalLink, Copy, Check, Calendar, Globe, Tag, Sparkles } from 'lucide-react';
import { showToast } from '../../utils/toastBus.js';

export default function AdDetailsModal({ adInfo, contactName, onClose }) {
  const [copiedKey, setCopiedKey] = useState(null);

  if (!adInfo) return null;

  const copyToClipboard = (text, key, label) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedKey(key);
    showToast({ type: 'success', title: 'Disalin', message: `${label} disalin ke clipboard` });
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const {
    sourceLabel = 'Meta Ad',
    sourceApp = 'meta',
    title = '',
    body = '',
    thumbnailUrl = '',
    sourceUrl = '',
    sourceId = '',
    ref = '',
    ctwaClid = '',
    greetingMessage = '',
    timestamp,
  } = adInfo;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card ad-details-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className="ad-modal-icon-badge">
              <Megaphone size={18} />
            </div>
            <div>
              <h3 className="modal-title">Sumber Iklan Pelanggan</h3>
              <p className="modal-subtitle">
                Percakapan ini berawal dari promosi berbayar {contactName ? `oleh ${contactName}` : ''}
              </p>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Tutup">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="modal-body ad-details-body">
          {/* Platform banner */}
          <div className={`ad-platform-banner platform-${sourceApp}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Globe size={16} />
              <span style={{ fontWeight: '700', fontSize: '0.9rem' }}>{sourceLabel}</span>
            </div>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ad-view-link-btn"
              >
                <span>Lihat Iklan Langsung</span>
                <ExternalLink size={12} />
              </a>
            )}
          </div>

          {/* Ad Creative Image & Title */}
          {thumbnailUrl && (
            <div className="ad-modal-creative">
              <img
                src={thumbnailUrl}
                alt={title || 'Ad Creative'}
                className="ad-modal-img"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
          )}

          {title && (
            <div className="ad-modal-section">
              <label className="ad-modal-label">Judul Iklan / Kampanye</label>
              <div className="ad-modal-headline">{title}</div>
            </div>
          )}

          {body && (
            <div className="ad-modal-section">
              <label className="ad-modal-label">Teks Iklan (Ad Copy)</label>
              <div className="ad-modal-copy-box">{body}</div>
            </div>
          )}

          {/* Metadata Grid */}
          <div className="ad-modal-grid">
            {sourceId && (
              <div className="ad-modal-field">
                <span className="ad-modal-field-title">Facebook / Meta Ad ID</span>
                <div className="ad-modal-field-value-row">
                  <code>{sourceId}</code>
                  <button
                    type="button"
                    className="ad-field-copy-btn"
                    onClick={() => copyToClipboard(sourceId, 'sourceId', 'Ad ID')}
                    title="Salin Ad ID"
                  >
                    {copiedKey === 'sourceId' ? <Check size={13} style={{ color: 'var(--success)' }} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            )}

            {ref && (
              <div className="ad-modal-field">
                <span className="ad-modal-field-title">Referral Tag (ref)</span>
                <div className="ad-modal-field-value-row">
                  <code>{ref}</code>
                  <button
                    type="button"
                    className="ad-field-copy-btn"
                    onClick={() => copyToClipboard(ref, 'ref', 'Referral Tag')}
                    title="Salin Ref"
                  >
                    {copiedKey === 'ref' ? <Check size={13} style={{ color: 'var(--success)' }} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            )}

            {ctwaClid && (
              <div className="ad-modal-field" style={{ gridColumn: 'span 2' }}>
                <span className="ad-modal-field-title">Click-to-WhatsApp Click ID (ctwa_clid)</span>
                <div className="ad-modal-field-value-row">
                  <code style={{ wordBreak: 'break-all', fontSize: '0.72rem' }}>{ctwaClid}</code>
                  <button
                    type="button"
                    className="ad-field-copy-btn"
                    onClick={() => copyToClipboard(ctwaClid, 'ctwaClid', 'Click ID')}
                    title="Salin Click ID"
                  >
                    {copiedKey === 'ctwaClid' ? <Check size={13} style={{ color: 'var(--success)' }} /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            )}

            {greetingMessage && (
              <div className="ad-modal-field" style={{ gridColumn: 'span 2' }}>
                <span className="ad-modal-field-title">Pesan Pembuka Otomatis dari Iklan</span>
                <div className="ad-modal-greeting-box">"{greetingMessage}"</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}
