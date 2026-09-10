import React, { useState, useEffect } from 'react';
import { ExternalLink, Megaphone, Copy, Check, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { showToast } from '../../utils/toastBus.js';

export default function AdMessageCard({ adInfo, onOpenDetails }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [imgSrc, setImgSrc] = useState(adInfo?.thumbnailUrl || adInfo?.embeddedThumbnail || '');

  useEffect(() => {
    if (adInfo) {
      setImgSrc(adInfo.thumbnailUrl || adInfo.embeddedThumbnail || '');
    }
  }, [adInfo?.thumbnailUrl, adInfo?.embeddedThumbnail]);

  if (!adInfo) return null;

  const {
    sourceLabel = 'Meta Ad',
    sourceApp = 'meta',
    title = '',
    body = '',
    thumbnailUrl = '',
    embeddedThumbnail = '',
    sourceUrl = '',
    sourceId = '',
    ref = '',
    ctwaClid = '',
  } = adInfo;

  const isFacebook = sourceApp === 'facebook';
  const isInstagram = sourceApp === 'instagram';
  const isStatus = sourceApp === 'whatsapp';

  const copyAdId = (e) => {
    e.stopPropagation();
    if (!sourceId) return;
    navigator.clipboard?.writeText(sourceId);
    setCopied(true);
    showToast({ type: 'success', title: 'Disalin', message: `Ad ID ${sourceId} disalin` });
    setTimeout(() => setCopied(false), 2000);
  };

  const bodyIsLong = body && body.length > 110;
  const displayBody = bodyIsLong && !expanded ? `${body.substring(0, 110)}...` : body;

  return (
    <div className={`campaign-card-container campaign-source-${sourceApp}`}>
      {/* Top bar: Source badge & links */}
      <div className="campaign-card-top">
        <div className="campaign-card-source-badge">
          <Megaphone size={12} className="campaign-card-icon" />
          <span className="campaign-card-source-text">{sourceLabel}</span>
        </div>
        <div className="campaign-card-actions">
          {onOpenDetails && (
            <button
              type="button"
              className="campaign-card-link-btn"
              title="Lihat detail lengkap kampanye iklan"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDetails(adInfo);
              }}
            >
              <Info size={11} />
              <span>Detail</span>
            </button>
          )}
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="campaign-card-link-btn"
              title="Buka tautan iklan"
              onClick={(e) => e.stopPropagation()}
            >
              <span>Buka Iklan</span>
              <ExternalLink size={11} />
            </a>
          )}
        </div>
      </div>

      {/* Main card body with image thumbnail & details */}
      <div className="campaign-card-main">
        {(imgSrc || thumbnailUrl || embeddedThumbnail) && (
          <div className="campaign-card-thumb-wrapper">
            <img
              src={imgSrc || thumbnailUrl || embeddedThumbnail}
              alt={title || 'Ad Preview'}
              className="campaign-card-thumb"
              loading="lazy"
              onError={(e) => {
                if (embeddedThumbnail && imgSrc !== embeddedThumbnail) {
                  setImgSrc(embeddedThumbnail);
                } else {
                  e.currentTarget.style.display = 'none';
                }
              }}
            />
          </div>
        )}

        <div className="campaign-card-details">
          {title && <div className="campaign-card-title">{title}</div>}
          {body && (
            <div className="campaign-card-body-text">
              {displayBody}
              {bodyIsLong && (
                <button
                  type="button"
                  className="campaign-card-expand-toggle"
                  onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                >
                  {expanded ? <>Ringkas <ChevronUp size={11} /></> : <>Selengkapnya <ChevronDown size={11} /></>}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Metadata tags: Ad ID, Ref, Click ID */}
      {(sourceId || ref) && (
        <div className="campaign-card-footer">
          {sourceId && (
            <button
              type="button"
              className="campaign-card-meta-chip"
              onClick={copyAdId}
              title="Klik untuk salin Ad ID"
            >
              <span>ID: {sourceId}</span>
              {copied ? <Check size={10} style={{ color: 'var(--success)' }} /> : <Copy size={10} />}
            </button>
          )}
          {ref && (
            <span className="campaign-card-meta-chip campaign-chip-ref" title={`Ref: ${ref}`}>
              Ref: {ref.length > 20 ? `${ref.substring(0, 20)}...` : ref}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
