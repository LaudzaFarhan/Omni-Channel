/**
 * WhatsApp Ads Detection & Message Unwrapping Utility
 *
 * Handles detection and extraction of:
 * - Meta / Facebook / Instagram Click-to-WhatsApp (CTWA) Ads
 * - WhatsApp Status Ads
 * - Quoted Ads and Conversion Source referrals
 * - Deep unwrapping of ephemeral, viewOnce, and interactive messages
 */

/**
 * Recursively unwrap wrapped WhatsApp message content
 * e.g., ephemeralMessage, viewOnceMessage, viewOnceMessageV2, documentWithCaptionMessage
 */
export function unwrapMessageContent(msg) {
  if (!msg) return null;
  let content = msg.message || msg;

  // Repeatedly unwrap nested container structures if present
  let iterations = 0;
  while (content && typeof content === 'object' && iterations < 8) {
    iterations++;
    if (content.ephemeralMessage?.message) {
      content = content.ephemeralMessage.message;
      continue;
    }
    if (content.viewOnceMessage?.message) {
      content = content.viewOnceMessage.message;
      continue;
    }
    if (content.viewOnceMessageV2?.message) {
      content = content.viewOnceMessageV2.message;
      continue;
    }
    if (content.viewOnceMessageV2Extension?.message) {
      content = content.viewOnceMessageV2Extension.message;
      continue;
    }
    if (content.documentWithCaptionMessage?.message) {
      content = content.documentWithCaptionMessage.message;
      continue;
    }
    if (content.botInvokeMessage?.message) {
      content = content.botInvokeMessage.message;
      continue;
    }
    break;
  }

  return content;
}

/**
 * Extract contextInfo from any message type (extendedTextMessage, imageMessage, etc.)
 */
export function getMessageContextInfo(msg) {
  const content = unwrapMessageContent(msg);
  if (!content || typeof content !== 'object') return null;

  return (
    content.extendedTextMessage?.contextInfo ||
    content.imageMessage?.contextInfo ||
    content.videoMessage?.contextInfo ||
    content.audioMessage?.contextInfo ||
    content.documentMessage?.contextInfo ||
    content.stickerMessage?.contextInfo ||
    content.interactiveMessage?.contextInfo ||
    content.buttonsResponseMessage?.contextInfo ||
    content.templateButtonReplyMessage?.contextInfo ||
    content.listResponseMessage?.contextInfo ||
    content.contextInfo ||
    null
  );
}

/**
 * Normalize thumbnail data (can be URL, base64 string, Uint8Array, or buffer object)
 */
function normalizeThumbnail(rawThumb, rawThumbUrl, originalImageUrl) {
  if (rawThumbUrl && typeof rawThumbUrl === 'string' && rawThumbUrl.startsWith('http')) {
    return rawThumbUrl;
  }
  if (originalImageUrl && typeof originalImageUrl === 'string' && originalImageUrl.startsWith('http')) {
    return originalImageUrl;
  }
  if (!rawThumb) return null;

  if (typeof rawThumb === 'string') {
    if (rawThumb.startsWith('http') || rawThumb.startsWith('data:image')) {
      return rawThumb;
    }
    // Assume base64 JPEG
    return `data:image/jpeg;base64,${rawThumb}`;
  }

  // Handle Buffer or Uint8Array
  if (rawThumb instanceof Uint8Array || Array.isArray(rawThumb) || rawThumb?.data) {
    try {
      const bytes = rawThumb.data ? rawThumb.data : rawThumb;
      let binary = '';
      const len = bytes.length;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `data:image/jpeg;base64,${btoa(binary)}`;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Detect and extract comprehensive Ad details from a message
 * Returns null if the message did not originate from an Ad.
 */
export function extractAdInfo(msg) {
  if (!msg) return null;

  // Check if already extracted and stored at the root
  if (msg.adInfo && typeof msg.adInfo === 'object' && msg.adInfo.isAd) {
    return msg.adInfo;
  }

  const contextInfo = getMessageContextInfo(msg);
  if (!contextInfo) return null;

  const externalAdReply = contextInfo.externalAdReply;
  const quotedAd = contextInfo.quotedAd;
  const statusAttribution = contextInfo.statusAttributionType;
  const entrySource = contextInfo.entryPointConversionSource || contextInfo.entryPointConversionExternalSource;
  const entryApp = contextInfo.entryPointConversionApp;

  // Check if this is an external ad reply (Meta/Facebook/Instagram Click-to-WhatsApp)
  if (externalAdReply && (externalAdReply.title || externalAdReply.body || externalAdReply.sourceUrl || externalAdReply.sourceId || externalAdReply.sourceType === 'ad')) {
    const rawApp = (externalAdReply.sourceApp || entryApp || '').toLowerCase();
    const sourceUrl = externalAdReply.sourceUrl || '';

    let source = 'Meta Ad';
    let app = 'meta';
    if (rawApp.includes('fb') || rawApp.includes('facebook') || sourceUrl.includes('fb.me') || sourceUrl.includes('facebook.com')) {
      source = 'Facebook Ad';
      app = 'facebook';
    } else if (rawApp.includes('ig') || rawApp.includes('instagram') || sourceUrl.includes('instagram.com') || sourceUrl.includes('instagr.am')) {
      source = 'Instagram Ad';
      app = 'instagram';
    } else if (rawApp) {
      source = `${rawApp.charAt(0).toUpperCase() + rawApp.slice(1)} Ad`;
      app = rawApp;
    }

    const thumbnail = normalizeThumbnail(
      externalAdReply.thumbnail,
      externalAdReply.thumbnailUrl,
      externalAdReply.originalImageUrl
    );

    return {
      isAd: true,
      kind: 'external_ad',
      sourceApp: app,
      sourceLabel: source,
      sourceType: externalAdReply.sourceType || 'ad',
      sourceId: externalAdReply.sourceId || null,
      sourceUrl: externalAdReply.sourceUrl || null,
      title: externalAdReply.title || 'Iklan Bersponsor',
      body: externalAdReply.body || '',
      thumbnailUrl: thumbnail,
      mediaType: externalAdReply.mediaType || 'IMAGE',
      ctwaClid: externalAdReply.ctwaClid || null,
      ref: externalAdReply.ref || null,
      greetingMessage: externalAdReply.greetingMessageBody || null,
      renderLargerThumbnail: !!externalAdReply.renderLargerThumbnail,
      timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : null,
    };
  }

  // Check if this is a WhatsApp Status Ad or quoted ad
  if (quotedAd && (quotedAd.advertiserName || quotedAd.caption)) {
    const thumbnail = normalizeThumbnail(quotedAd.jpegThumbnail);
    return {
      isAd: true,
      kind: 'quoted_ad',
      sourceApp: 'whatsapp',
      sourceLabel: 'WhatsApp Status Ad',
      sourceType: 'status_ad',
      sourceId: null,
      sourceUrl: null,
      title: quotedAd.advertiserName || 'Status Ad',
      body: quotedAd.caption || '',
      thumbnailUrl: thumbnail,
      mediaType: quotedAd.mediaType === 2 ? 'VIDEO' : 'IMAGE',
      ctwaClid: null,
      ref: null,
      timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : null,
    };
  }

  // Check if this is a Status Attribution / Status Ad
  if (statusAttribution && statusAttribution !== 0 && statusAttribution !== 'NONE') {
    return {
      isAd: true,
      kind: 'status_attribution',
      sourceApp: 'whatsapp',
      sourceLabel: 'WhatsApp Status Ad',
      sourceType: 'status_ad',
      title: 'Status Ad',
      body: 'Pesan dari WhatsApp Status',
      thumbnailUrl: null,
      sourceUrl: null,
      timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : null,
    };
  }

  // Check if entry point source says ad / facebook / instagram
  if (entrySource && (entrySource.toLowerCase().includes('ad') || entrySource.toLowerCase().includes('fb') || entrySource.toLowerCase().includes('ig'))) {
    const isIg = entrySource.toLowerCase().includes('ig') || entryApp?.toLowerCase().includes('ig');
    return {
      isAd: true,
      kind: 'entry_point',
      sourceApp: isIg ? 'instagram' : 'facebook',
      sourceLabel: isIg ? 'Instagram Ad' : 'Facebook Ad',
      sourceType: 'ad',
      title: isIg ? 'Instagram Sponsored Ad' : 'Facebook Sponsored Ad',
      body: '',
      thumbnailUrl: null,
      sourceUrl: null,
      timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) : null,
    };
  }

  return null;
}

/**
 * Extract human-readable text from any Baileys message structure,
 * handling deep nesting, interactive buttons, polls, locations, and ad captions.
 */
export function extractMessageText(msg) {
  if (!msg) return '';
  if (typeof msg === 'string') return msg;

  const content = unwrapMessageContent(msg);
  if (!content) return '';
  if (typeof content === 'string') return content;

  // 1. Direct conversation
  if (content.conversation) {
    return content.conversation;
  }

  // 2. Extended text message (most common for texts and ads)
  if (content.extendedTextMessage?.text) {
    return content.extendedTextMessage.text;
  }

  // 3. Interactive messages (native flow, buttons, cards)
  if (content.interactiveMessage) {
    const im = content.interactiveMessage;
    const body = im.body?.text || '';
    const header = im.header?.title || im.header?.text || '';
    if (header && body) return `${header}\n${body}`;
    if (body) return body;
    if (header) return header;
    return '📋 Pesan Interaktif';
  }

  // 4. Template & Button messages
  if (content.templateMessage) {
    const tm = content.templateMessage;
    const hydrated = tm.hydratedTemplate || tm.hydratedFourRowTemplate;
    if (hydrated?.hydratedContentText) return hydrated.hydratedContentText;
    return '📋 Template Pesan';
  }

  if (content.buttonsMessage) {
    return content.buttonsMessage.contentText || '🔘 Pilihan Tombol';
  }

  // 5. Button and list responses
  if (content.buttonsResponseMessage) {
    return content.buttonsResponseMessage.selectedDisplayText || content.buttonsResponseMessage.selectedButtonId || '🔘 Tombol Diklik';
  }
  if (content.templateButtonReplyMessage) {
    return content.templateButtonReplyMessage.selectedDisplayText || '🔘 Tombol Diklik';
  }
  if (content.listResponseMessage) {
    return content.listResponseMessage.title || content.listResponseMessage.singleSelectReply?.selectedRowId || '📑 Pilihan Menu';
  }

  // 6. Media messages with captions
  if (content.imageMessage) {
    const cap = content.imageMessage.caption;
    return cap ? `📷 ${cap}` : '📷 Foto';
  }
  if (content.videoMessage) {
    const cap = content.videoMessage.caption;
    return cap ? `🎥 ${cap}` : '🎥 Video';
  }
  if (content.audioMessage) {
    return content.audioMessage.ptt ? '🎙️ Pesan Suara' : '🎵 Audio';
  }
  if (content.documentMessage) {
    const fn = content.documentMessage.fileName || content.documentMessage.caption;
    return fn ? `📄 ${fn}` : '📄 Dokumen';
  }
  if (content.stickerMessage) {
    return '🎨 Stiker';
  }

  // 7. Contact, Location, Poll
  if (content.contactMessage) {
    return `👤 Kontak: ${content.contactMessage.displayName || 'Kontak'}`;
  }
  if (content.contactsArrayMessage) {
    return `👥 ${content.contactsArrayMessage.contacts?.length || 'Beberapa'} Kontak`;
  }
  if (content.locationMessage) {
    const loc = content.locationMessage.name || content.locationMessage.address;
    return loc ? `📍 Lokasi: ${loc}` : '📍 Berbagi Lokasi';
  }
  if (content.liveLocationMessage) {
    return '📍 Lokasi Terkini (Live)';
  }
  if (content.pollCreationMessage || content.pollCreationMessageV3) {
    const poll = content.pollCreationMessage || content.pollCreationMessageV3;
    return `📊 Polling: ${poll.name || 'Pertanyaan Polling'}`;
  }
  if (content.reactionMessage) {
    return content.reactionMessage.text ? `Emotikon: ${content.reactionMessage.text}` : 'Reaksi';
  }

  // 8. If text is empty but an Ad is detected, show Ad summary instead of "Unsupported"
  const adInfo = extractAdInfo(msg);
  if (adInfo) {
    return `📢 Iklan: ${adInfo.title || adInfo.sourceLabel || 'Meta Ad'}`;
  }

  // 9. Graceful fallback rather than generic "Unsupported Message"
  const knownKeys = Object.keys(content).filter(k => k !== 'messageContextInfo' && k !== 'contextInfo');
  if (knownKeys.length > 0) {
    const key = knownKeys[0];
    const friendlyName = key.replace(/Message$/, '').replace(/([A-Z])/g, ' $1').toLowerCase();
    return `[Pesan ${friendlyName}]`;
  }

  return '[Pesan]';
}
