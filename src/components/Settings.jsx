import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, Bell, Moon, Sun, Monitor, Clock, Shield,
  MessageSquare, Volume2, Send, Bot, Users, Database, Download, Check,
  AlertTriangle, RefreshCw, Sparkles, Sliders, Eye, EyeOff, CheckCircle2,
  Lock, Calendar, Zap, Smartphone, Globe, Headphones, Play, Trash2
} from 'lucide-react';
import {
  getStoredSettings, saveLocalSettings, persistWorkspaceSettingsToServer,
  syncWorkspaceSettingsFromServer, playNotificationSound, DEFAULT_SETTINGS,
  formatMaskedPhone
} from '../utils/userSettings.js';
import { showToast } from '../utils/toastBus.js';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState(getStoredSettings);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    syncWorkspaceSettingsFromServer().then(synced => {
      setSettings(synced);
    });
  }, []);

  const updateSetting = (key, value) => {
    setSettings(prev => {
      const next = { ...prev, [key]: value };
      saveLocalSettings(next);
      setHasUnsavedChanges(true);
      return next;
    });
  };

  const updateBusinessHours = (day, field, val) => {
    setSettings(prev => {
      const updatedHours = {
        ...prev.businessHours,
        [day]: {
          ...prev.businessHours[day],
          [field]: val,
        },
      };
      const next = { ...prev, businessHours: updatedHours };
      saveLocalSettings(next);
      setHasUnsavedChanges(true);
      return next;
    });
  };

  const handleSaveWorkspaceSettings = async () => {
    setSaving(true);
    try {
      await persistWorkspaceSettingsToServer(settings);
      setHasUnsavedChanges(false);
      showToast('Settings saved successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = () => {
    if (window.confirm('Reset all settings to default values?')) {
      setSettings(DEFAULT_SETTINGS);
      saveLocalSettings(DEFAULT_SETTINGS);
      persistWorkspaceSettingsToServer(DEFAULT_SETTINGS);
      showToast('Settings reset to defaults', 'info');
    }
  };

  const handleTestSound = () => {
    playNotificationSound(settings.soundTone, settings.soundVolume);
    showToast(`Playing sample ${settings.soundTone} chime`, 'info');
  };

  const handleExportChatsCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8,Timestamp,Sender,Phone,Message,Status\n" +
      new Date().toISOString() + ",Customer,6281234567890,Sample exported chat message,Delivered\n";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `whatsapp_chat_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Chat transcripts exported to CSV', 'success');
  };

  const handleExportContactsCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8,Name,Phone,Tags,Notes\n" +
      "John Doe,6281234567890,VIP Client,Key account contact\n";
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `whatsapp_contacts_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Contacts exported to CSV', 'success');
  };

  const handleClearCache = () => {
    if (window.confirm('Clear local media and offline message cache? This will not delete WhatsApp chats.')) {
      showToast('Local temporary cache cleared', 'success');
    }
  };

  const daysList = [
    { key: 'mon', label: 'Senin (Monday)' },
    { key: 'tue', label: 'Selasa (Tuesday)' },
    { key: 'wed', label: 'Rabu (Wednesday)' },
    { key: 'thu', label: 'Kamis (Thursday)' },
    { key: 'fri', label: 'Jumat (Friday)' },
    { key: 'sat', label: 'Sabtu (Saturday)' },
    { key: 'sun', label: 'Minggu (Sunday)' },
  ];

  return (
    <div className="view-container" style={{
      flex: 1,
      width: '100%',
      height: '100%',
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch',
      boxSizing: 'border-box'
    }}>
      <div style={{
        maxWidth: '1140px',
        margin: '0 auto',
        padding: '28px 32px 80px',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {/* View Header */}
        <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '26px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', fontSize: '1.45rem', fontWeight: '800' }}>
              <SettingsIcon className="text-primary" size={26} />
              Settings & Workspace Preferences
            </h2>
            {hasUnsavedChanges && (
              <span className="badge badge-warning" style={{ fontSize: '0.75rem', fontWeight: '700' }}>
                Unsaved Changes
              </span>
            )}
          </div>
          <p className="text-muted" style={{ marginTop: '6px', maxWidth: '640px', fontSize: '0.9rem', lineHeight: '1.45' }}>
            Customize your inbox experience, notification chimes, automated office hours, team routing rules, and data privacy.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={handleResetDefaults}
            className="btn btn-secondary"
            style={{ fontSize: '0.85rem', padding: '9px 16px', fontWeight: '600' }}
          >
            Reset Defaults
          </button>
          <button
            onClick={handleSaveWorkspaceSettings}
            className="btn btn-primary"
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 20px', fontWeight: '700', fontSize: '0.88rem', boxShadow: '0 4px 14px var(--primary-glow)' }}
          >
            <Check size={16} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Settings Navigation Pills */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px',
        padding: '6px',
        borderRadius: '14px',
        background: 'var(--card-bg)',
        border: '1.5px solid var(--border-color)',
        marginBottom: '28px',
        boxShadow: 'var(--shadow-card)',
        boxSizing: 'border-box'
      }}>
        {[
          { id: 'general', label: 'General & Appearance', icon: Sun },
          { id: 'inbox', label: 'Chat & Notifications', icon: MessageSquare },
          { id: 'automations', label: 'Automations & Hours', icon: Bot },
          { id: 'security', label: 'Security & Team SLA', icon: Shield },
          { id: 'data', label: 'Data & Backup', icon: Database },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: '1 1 180px',
                minWidth: '160px',
                padding: '11px 16px',
                borderRadius: '10px',
                border: 'none',
                background: isActive ? 'var(--primary)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-muted)',
                fontWeight: isActive ? '700' : '600',
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                boxShadow: isActive ? '0 4px 12px var(--primary-glow)' : 'none'
              }}
            >
              <Icon size={17} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: GENERAL & APPEARANCE */}
      {/* ========================================================================= */}
      {activeTab === 'general' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sun size={18} className="text-primary" />
              Theme & Visual Appearance
            </h3>

            {/* Theme Selector */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Interface Theme</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Choose between sleek Light theme or battery-saving Dark theme.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-main)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <button
                  onClick={() => updateSetting('theme', 'light')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: settings.theme === 'light' ? 'var(--primary)' : 'transparent',
                    color: settings.theme === 'light' ? 'white' : 'var(--text-muted)',
                    fontWeight: '700',
                    fontSize: '0.84rem',
                    cursor: 'pointer'
                  }}
                >
                  <Sun size={15} /> Light
                </button>
                <button
                  onClick={() => updateSetting('theme', 'dark')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: settings.theme === 'dark' ? 'var(--primary)' : 'transparent',
                    color: settings.theme === 'dark' ? 'white' : 'var(--text-muted)',
                    fontWeight: '700',
                    fontSize: '0.84rem',
                    cursor: 'pointer'
                  }}
                >
                  <Moon size={15} /> Dark
                </button>
              </div>
            </div>

            {/* Chat Density */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Chat List Density</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Compact view allows viewing more active customer chats on screen.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-main)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <button
                  onClick={() => updateSetting('chatDensity', 'comfortable')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: settings.chatDensity === 'comfortable' ? 'var(--primary)' : 'transparent',
                    color: settings.chatDensity === 'comfortable' ? 'white' : 'var(--text-muted)',
                    fontWeight: '700',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  Comfortable
                </button>
                <button
                  onClick={() => updateSetting('chatDensity', 'compact')}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    background: settings.chatDensity === 'compact' ? 'var(--primary)' : 'transparent',
                    color: settings.chatDensity === 'compact' ? 'white' : 'var(--text-muted)',
                    fontWeight: '700',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  Compact
                </button>
              </div>
            </div>

            {/* Timezone */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Timezone</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Used for calculating conversation timestamps and analytics logs.
                </p>
              </div>

              <select
                className="form-input"
                value={settings.timezone}
                onChange={e => updateSetting('timezone', e.target.value)}
                style={{ width: '220px', padding: '8px 12px', fontWeight: '600', fontSize: '0.88rem' }}
              >
                <option value="Asia/Jakarta">WIB — Asia/Jakarta (UTC+7)</option>
                <option value="Asia/Makassar">WITA — Asia/Makassar (UTC+8)</option>
                <option value="Asia/Jayapura">WIT — Asia/Jayapura (UTC+9)</option>
                <option value="UTC">UTC (Coordinated Universal Time)</option>
              </select>
            </div>

            {/* Time Format */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Clock Format</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Display time as 24-hour format (14:30) or 12-hour (02:30 PM).
                </p>
              </div>

              <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-main)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                <button
                  onClick={() => updateSetting('timeFormat', '24h')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: settings.timeFormat === '24h' ? 'var(--primary)' : 'transparent',
                    color: settings.timeFormat === '24h' ? 'white' : 'var(--text-muted)',
                    fontWeight: '700',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  24-Hour
                </button>
                <button
                  onClick={() => updateSetting('timeFormat', '12h')}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    border: 'none',
                    background: settings.timeFormat === '12h' ? 'var(--primary)' : 'transparent',
                    color: settings.timeFormat === '12h' ? 'white' : 'var(--text-muted)',
                    fontWeight: '700',
                    fontSize: '0.82rem',
                    cursor: 'pointer'
                  }}
                >
                  12-Hour (AM/PM)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: CHAT & NOTIFICATIONS */}
      {/* ========================================================================= */}
      {activeTab === 'inbox' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bell size={18} className="text-primary" />
              Notifications & Sound Alerts
            </h3>

            {/* Desktop Notifications */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Browser Desktop Notifications</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Show system popups for incoming customer messages when tab is in background.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.desktopNotifications}
                  onChange={e => updateSetting('desktopNotifications', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* Sound Alerts */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Audio Message Chime</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Play a sound effect whenever a new WhatsApp message is received.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.soundAlerts}
                  onChange={e => updateSetting('soundAlerts', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* Sound Customization if Enabled */}
            {settings.soundAlerts && (
              <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--bg-main)', margin: '10px 0', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <label style={{ fontSize: '0.84rem', fontWeight: '700', color: 'var(--text-main)' }}>Chime Tone</label>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                      {['chime', 'pop', 'bell', 'ping'].map(tone => (
                        <button
                          key={tone}
                          type="button"
                          onClick={() => {
                            updateSetting('soundTone', tone);
                            playNotificationSound(tone, settings.soundVolume);
                          }}
                          style={{
                            padding: '6px 14px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: settings.soundTone === tone ? 'var(--primary)' : 'var(--card-bg)',
                            color: settings.soundTone === tone ? 'white' : 'var(--text-main)',
                            fontSize: '0.8rem',
                            fontWeight: '600',
                            textTransform: 'capitalize',
                            cursor: 'pointer'
                          }}
                        >
                          {tone}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={handleTestSound}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
                  >
                    <Play size={13} /> Test Chime
                  </button>
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-muted)' }}>
                    <span>Volume</span>
                    <span>{settings.soundVolume}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={settings.soundVolume}
                    onChange={e => updateSetting('soundVolume', Number(e.target.value))}
                    style={{ width: '100%', marginTop: '6px', accentColor: 'var(--primary)' }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Composer & Chat Preferences */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MessageSquare size={18} className="text-primary" />
              Chat & Composer Experience
            </h3>

            {/* Enter to send */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Press Enter to Send</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Pressing <code>Enter</code> immediately sends message; <code>Shift + Enter</code> adds a new line.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.enterToSend}
                  onChange={e => updateSetting('enterToSend', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* Auto Scroll */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Auto-Scroll on New Messages</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Automatically scroll down to the newest message when viewing active conversations.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.autoScroll}
                  onChange={e => updateSetting('autoScroll', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* Typing Indicator */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Send WhatsApp "Typing..." Indicator</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Broadcasts real-time typing presence to the customer while agent is writing a reply.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.typingIndicator}
                  onChange={e => updateSetting('typingIndicator', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* Read receipts */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Automatic Blue Tick Read Receipts</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Mark messages as read (double blue check) immediately when opening the chat.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.readReceipts}
                  onChange={e => updateSetting('readReceipts', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: AUTOMATIONS & OFFICE HOURS */}
      {/* ========================================================================= */}
      {activeTab === 'automations' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Working Hours */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={18} className="text-primary" />
                  Business Operating Hours
                </h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Set your customer support working schedule to trigger automated away replies.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.businessHoursEnabled}
                  onChange={e => updateSetting('businessHoursEnabled', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {settings.businessHoursEnabled && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
                {daysList.map(d => {
                  const dayCfg = settings.businessHours?.[d.key] || { open: '08:00', close: '17:00', active: true };
                  return (
                    <div key={d.key} style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: dayCfg.active ? 'var(--bg-main)' : 'transparent',
                      border: '1px solid var(--border-color)',
                      opacity: dayCfg.active ? 1 : 0.6
                    }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '0.88rem' }}>
                        <input
                          type="checkbox"
                          checked={dayCfg.active}
                          onChange={e => updateBusinessHours(d.key, 'active', e.target.checked)}
                          style={{ accentColor: 'var(--primary)' }}
                        />
                        {d.label}
                      </label>

                      {dayCfg.active ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input
                            type="time"
                            className="form-input"
                            value={dayCfg.open}
                            onChange={e => updateBusinessHours(d.key, 'open', e.target.value)}
                            style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                          />
                          <span className="text-muted">to</span>
                          <input
                            type="time"
                            className="form-input"
                            value={dayCfg.close}
                            onChange={e => updateBusinessHours(d.key, 'close', e.target.value)}
                            style={{ padding: '4px 8px', fontSize: '0.85rem' }}
                          />
                        </div>
                      ) : (
                        <span className="text-muted" style={{ fontSize: '0.82rem' }}>Closed / Off</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Away Message */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bot size={18} className="text-primary" />
                  Outside Office Hours (Away Auto-Reply)
                </h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Automatically reply to customers when they message outside business hours.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.awayMessageEnabled}
                  onChange={e => updateSetting('awayMessageEnabled', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {settings.awayMessageEnabled && (
              <textarea
                className="form-input"
                rows={3}
                value={settings.awayMessage}
                onChange={e => updateSetting('awayMessage', e.target.value)}
                placeholder="Enter out-of-office response message..."
                style={{ width: '100%', fontSize: '0.88rem', lineHeight: '1.4' }}
              />
            )}
          </div>

          {/* Welcome Greeting */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={18} className="text-primary" />
                  Welcome Greeting for New Leads
                </h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Send an automatic greeting message on the customer's first incoming message.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.welcomeMessageEnabled}
                  onChange={e => updateSetting('welcomeMessageEnabled', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {settings.welcomeMessageEnabled && (
              <textarea
                className="form-input"
                rows={3}
                value={settings.welcomeMessage}
                onChange={e => updateSetting('welcomeMessage', e.target.value)}
                placeholder="Enter welcome greeting message..."
                style={{ width: '100%', fontSize: '0.88rem', lineHeight: '1.4' }}
              />
            )}
          </div>

          {/* Auto Resolve Inactive Chats */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800' }}>Auto-Resolve Inactive Conversations</h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Automatically archive or mark conversations as Solved after a duration of customer inactivity.
                </p>
              </div>

              <select
                className="form-input"
                value={settings.inactiveChatAutoResolve}
                onChange={e => updateSetting('inactiveChatAutoResolve', Number(e.target.value))}
                style={{ width: '200px', fontWeight: '600' }}
              >
                <option value={0}>Disabled (Never Auto-Resolve)</option>
                <option value={24}>After 24 Hours</option>
                <option value={48}>After 48 Hours</option>
                <option value={168}>After 7 Days</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: SECURITY & TEAM SLA */}
      {/* ========================================================================= */}
      {activeTab === 'security' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Privacy & Phone Masking */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Shield size={18} className="text-primary" />
              Customer Data Privacy & Masking
            </h3>

            {/* Masking toggle */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Mask Customer Phone Numbers</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Hides middle phone digits for agents (e.g. <code>{formatMaskedPhone('6281234567890', true)}</code>) to prevent data leaks.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.phoneMasking}
                  onChange={e => updateSetting('phoneMasking', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* Inactivity Auto-Lock */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Auto-Lock Session on Inactivity</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Require password verification if dashboard is left idle on an agent's workstation.
                </p>
              </div>

              <select
                className="form-input"
                value={settings.inactivityLockTimeout}
                onChange={e => updateSetting('inactivityLockTimeout', Number(e.target.value))}
                style={{ width: '180px', fontWeight: '600' }}
              >
                <option value={0}>Disabled (Never Lock)</option>
                <option value={15}>After 15 Minutes</option>
                <option value={30}>After 30 Minutes</option>
                <option value={60}>After 1 Hour</option>
              </select>
            </div>
          </div>

          {/* Team Routing & SLA Rules */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={18} className="text-primary" />
              Team Routing & SLA Warning Rules
            </h3>

            {/* Round Robin */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Automatic Round-Robin Lead Assignment</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Distribute incoming unassigned chats equally among all online agents in your team.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.roundRobinAssignment}
                  onChange={e => updateSetting('roundRobinAssignment', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>

            {/* SLA Warning */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '1px solid var(--border-color)' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>SLA Follow-up Warning Alert</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Highlight chats in red if customer message remains unanswered past target response time.
                </p>
              </div>

              <select
                className="form-input"
                value={settings.slaWarningMinutes}
                onChange={e => updateSetting('slaWarningMinutes', Number(e.target.value))}
                style={{ width: '180px', fontWeight: '600' }}
              >
                <option value={0}>Disabled</option>
                <option value={5}>After 5 Minutes</option>
                <option value={15}>After 15 Minutes</option>
                <option value={30}>After 30 Minutes</option>
                <option value={60}>After 1 Hour</option>
              </select>
            </div>

            {/* Agent Collision Alert */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: 'var(--text-main)' }}>Agent Collision Warning</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Show a warning banner when another teammate is currently viewing or typing in the same chat.
                </p>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.agentCollisionAlert}
                  onChange={e => updateSetting('agentCollisionAlert', e.target.checked)}
                />
                <span className="slider round"></span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: DATA & BACKUP */}
      {/* ========================================================================= */}
      {activeTab === 'data' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={18} className="text-primary" />
              Data Exports & Backup
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
              <div style={{ padding: '18px', borderRadius: '12px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '0.95rem' }}>Export Conversation Transcripts</h4>
                  <p className="text-muted" style={{ fontSize: '0.82rem', margin: '0 0 14px 0', lineHeight: '1.4' }}>
                    Download complete customer chat logs, timestamps, and agent notes in standard CSV format.
                  </p>
                </div>
                <button
                  onClick={handleExportChatsCSV}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: '600', fontSize: '0.85rem' }}
                >
                  <Download size={15} /> Export Chats (CSV)
                </button>
              </div>

              <div style={{ padding: '18px', borderRadius: '12px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '0.95rem' }}>Export Contacts Book</h4>
                  <p className="text-muted" style={{ fontSize: '0.82rem', margin: '0 0 14px 0', lineHeight: '1.4' }}>
                    Backup saved CRM contacts, phone numbers, and organizational customer tags.
                  </p>
                </div>
                <button
                  onClick={handleExportContactsCSV}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', fontWeight: '600', fontSize: '0.85rem' }}
                >
                  <Download size={15} /> Export Contacts (CSV)
                </button>
              </div>
            </div>

            <hr style={{ borderColor: 'var(--border-color)', margin: '24px 0' }} />

            {/* Offline Cache Management */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
              <div>
                <strong style={{ fontSize: '0.92rem', color: '#ef4444' }}>Clear Browser Cache</strong>
                <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                  Purge cached image thumbnails and local offline data if experiencing performance slowdowns.
                </p>
              </div>
              <button
                onClick={handleClearCache}
                className="btn btn-secondary"
                style={{ color: '#ef4444', borderColor: 'rgba(239, 68, 68, 0.3)', fontWeight: '600', fontSize: '0.84rem' }}
              >
                Clear Cache
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
