import React from 'react';
import {
  MessageSquare, BookUser, History, Users, Bell, CreditCard, User, Settings, ChevronRight,
} from 'lucide-react';
import { isVisible, isComingSoon } from '../../utils/features.js';

/**
 * Every feature area, with a live number and a way in.
 *
 * The home page used to show four counters and two charts, so most of what the product
 * does was only discoverable by clicking through the sidebar. This is the index: one card
 * per area, each carrying the figure that tells you whether it needs attention.
 *
 * The catalogue lives here rather than in the dashboard because it is the inventory of
 * the product's features; keeping it in one file is what stops it drifting out of date
 * when a feature is added.
 *
 * `supervisorOnly` mirrors the sidebar and the server's `supervisor` middleware chain.
 * An invited agent never sees these cards, so the page cannot offer a button that 403s.
 */
function catalogue(metrics) {
  const {
    unreadChats = 0, conversations = 0, contacts = 0, awaitingReply = 0,
    seatsUsed = null, seatsLimit = null, unreadNotifications = 0,
    planName = null, messagesSent = 0, messageLimit = 0,
    unlimitedAgents = false,
  } = metrics;

  return [
    {
      key: 'messages',
      tab: 'messages',
      icon: MessageSquare,
      label: 'Percakapan',
      description: 'Kotak masuk, template balasan cepat, tag, status prospek, teruskan pesan, dan jeda bot.',
      value: conversations.toLocaleString('id-ID'),
      valueLabel: 'percakapan',
      // The reason to go there right now, rather than a second static number.
      badge: unreadChats > 0 ? `${unreadChats} belum dibaca` : null,
      badgeTone: 'primary',
    },
    {
      key: 'contacts',
      tab: 'contacts',
      icon: BookUser,
      label: 'Kontak',
      description: 'Buku alamat tim, impor dan ekspor CSV, catatan, perusahaan, dan tag kontak.',
      value: contacts.toLocaleString('id-ID'),
      valueLabel: 'tersimpan',
    },
    {
      key: 'activity',
      tab: 'activity',
      icon: History,
      label: 'Riwayat Chat',
      description: 'Percakapan pelanggan dari seluruh tim: siapa yang memulai dan agen mana yang membalas.',
      value: awaitingReply.toLocaleString('id-ID'),
      valueLabel: 'belum dibalas',
      badge: awaitingReply > 0 ? 'Perlu tindakan' : null,
      badgeTone: 'warning',
      supervisorOnly: true,
    },
    {
      key: 'team',
      tab: 'team',
      icon: Users,
      label: 'Tim',
      description: 'Undang agen, kelola kursi, pantau status undangan, dan cabut akses.',
      // Seats need a request to know; until it arrives the card says so rather than
      // showing a zero that looks like "no agents".
      value: unlimitedAgents
        ? '∞'
        : seatsLimit === null ? '—' : `${seatsUsed}/${seatsLimit}`,
      valueLabel: unlimitedAgents ? 'kursi tanpa batas' : 'kursi terpakai',
      supervisorOnly: true,
    },
    {
      key: 'notifications',
      tab: 'notifications',
      icon: Bell,
      label: 'Notifikasi',
      description: 'Koneksi WhatsApp, pesan masuk, dan pemberitahuan langganan.',
      value: unreadNotifications.toLocaleString('id-ID'),
      valueLabel: 'belum dibaca',
      badge: unreadNotifications > 0 ? 'Baru' : null,
      badgeTone: 'primary',
    },
    {
      key: 'subscription',
      tab: 'subscription',
      icon: CreditCard,
      label: 'Langganan',
      description: 'Paket, kuota pesan, tambahan kursi agen, dan riwayat pembayaran.',
      value: planName || '—',
      valueLabel: messageLimit > 0
        ? `${messagesSent.toLocaleString('id-ID')}/${messageLimit.toLocaleString('id-ID')} pesan`
        : 'paket aktif',
      supervisorOnly: true,
    },
    {
      key: 'profile',
      tab: 'profile',
      icon: User,
      label: 'Profil',
      description: 'Akun, peran, dan status verifikasi Anda.',
    },
    {
      key: 'settings',
      tab: 'settings',
      icon: Settings,
      label: 'Pengaturan',
      description: 'Tema tampilan dan preferensi notifikasi.',
    },
  ];
}

export default function FeatureGrid({ metrics = {}, isSupervisor = true, onNavigate, features = {} }) {
  const items = catalogue(metrics)
    .filter(item => !item.supervisorOnly || isSupervisor)
    // A hidden feature leaves no card. A coming-soon one keeps its card — this grid is the
    // index of what the product does, and an announced feature belongs in it — but the card
    // says so instead of showing a metric that does not exist yet.
    .filter(item => isVisible(features, item.key))
    .map(item => (isComingSoon(features, item.key)
      ? { ...item, value: undefined, valueLabel: undefined, badge: 'Coming soon', badgeTone: 'warning' }
      : item));

  return (
    <div className="dashboard-panel">
      <div className="dashboard-panel-header">
        <span>Semua Fitur</span>
      </div>

      <div className="feature-grid">
        {items.map(({ key, tab, icon: Icon, label, description, value, valueLabel, badge, badgeTone }) => (
          <button
            key={key}
            type="button"
            className="feature-card"
            onClick={() => onNavigate?.(tab)}
            title={`Buka ${label}`}
          >
            <span className="feature-card-top">
              <span className="feature-icon"><Icon size={17} /></span>
              <span className="feature-label">{label}</span>
              {badge && <span className={`feature-badge tone-${badgeTone || 'primary'}`}>{badge}</span>}
              <ChevronRight size={14} className="feature-chevron" />
            </span>

            {value !== undefined && (
              <span className="feature-metric">
                <strong>{value}</strong>
                {valueLabel && <small>{valueLabel}</small>}
              </span>
            )}

            <span className="feature-desc">{description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
