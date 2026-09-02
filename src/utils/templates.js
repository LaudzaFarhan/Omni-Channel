// Message Templates & Dynamic Variables Engine
// Supports dynamic variables like {{name}}, {{phone}}, {{time}}, {{date}}, {{agent_name}}

export const TEMPLATES_STORAGE_KEY = 'whatsapp_quick_replies';

export const TEMPLATE_VARIABLES = [
  { key: 'name', label: '{{name}}', title: 'Customer Name', desc: 'Resolved name or fallback' },
  { key: 'phone', label: '{{phone}}', title: 'Phone Number', desc: 'Recipient phone number' },
  { key: 'time', label: '{{time}}', title: 'Current Time', desc: 'e.g. 14:30 WIB' },
  { key: 'date', label: '{{date}}', title: 'Current Date', desc: 'e.g. 2 September 2026' },
  { key: 'agent_name', label: '{{agent_name}}', title: 'Agent Name', desc: 'Logged-in operator name' },
];

export const DEFAULT_TEMPLATES = [
  {
    id: 'welcome',
    title: '👋 Welcome Greeting',
    text: 'Halo Kak {{name}}, terima kasih telah menghubungi kami! Ada yang bisa kami bantu hari ini? 😊',
    category: 'General'
  },
  {
    id: 'followup',
    title: '🔍 Follow Up Penawaran',
    text: 'Halo Kak {{name}}, kami ingin follow-up terkait informasi yang kami kirimkan sebelumnya. Apakah ada pertanyaan yang bisa kami bantu jelaskan?',
    category: 'Sales'
  },
  {
    id: 'promo_broadcast',
    title: '🎉 Promo & Diskon Spesial',
    text: 'Halo Kak {{name}}! 🔥 Kami ada promo spesial khusus minggu ini. Dapatkan potongan harga dan penawaran menarik sebelum kuota habis!',
    category: 'Marketing'
  },
  {
    id: 'payment_reminder',
    title: '💳 Konfirmasi & Info Pembayaran',
    text: 'Halo Kak {{name}}, berikut informasi pembayaran untuk pesanan Anda. Mohon konfirmasi dan kirimkan bukti transfer jika sudah selesai ya Kak.',
    category: 'Billing'
  },
  {
    id: 'thank_you',
    title: '💖 Ucapan Terima Kasih',
    text: 'Terima kasih banyak atas kepercayaannya Kak {{name}}! Jika butuh bantuan lebih lanjut, jangan ragu untuk menghubungi kami kembali.',
    category: 'Support'
  }
];

/** Read saved templates from localStorage or fallback */
export function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (err) {
    console.warn('[Templates] Failed to read templates:', err);
  }
  return DEFAULT_TEMPLATES;
}

/** Save templates list */
export function saveTemplates(templates) {
  try {
    localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
  } catch (err) {
    console.warn('[Templates] Failed to save templates:', err);
  }
}

/**
 * Resolves dynamic template variables against recipient and workspace context.
 *
 * Supported variables:
 * - {{name}}, {{customer_name}}, {{nama}}
 * - {{phone}}, {{nomor}}
 * - {{time}}, {{waktu}}
 * - {{date}}, {{tanggal}}
 * - {{agent_name}}, {{agent}}
 */
export function resolveTemplateVariables(templateStr = '', context = {}) {
  if (!templateStr || typeof templateStr !== 'string') return '';

  const customerName = (context.name || context.customer_name || context.pushName || '').trim() || 'Kak';
  const phone = (context.phone || context.jid || '').replace(/@.*$/, '').trim();
  const agentName = (context.agentName || context.agent_name || 'Tim Support').trim();

  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });

  return templateStr
    .replace(/\{\{\s*(name|customer_name|nama)\s*\}\}/gi, customerName)
    .replace(/\{\{\s*(phone|nomor)\s*\}\}/gi, phone)
    .replace(/\{\{\s*(agent_name|agent|operator)\s*\}\}/gi, agentName)
    .replace(/\{\{\s*(time|waktu|jam)\s*\}\}/gi, timeStr)
    .replace(/\{\{\s*(date|tanggal|hari)\s*\}\}/gi, dateStr);
}
