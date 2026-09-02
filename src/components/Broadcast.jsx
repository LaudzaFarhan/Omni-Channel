import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Megaphone, Send, Users, Tag, Clock, ShieldCheck, Sparkles, Plus,
  Trash2, Pencil, Play, Pause, Square, CheckCircle2, AlertTriangle,
  RotateCcw, Eye, Download, Search, Check, X, FileText, ChevronRight,
  Filter, Layers, ArrowRight, MessageSquare
} from 'lucide-react';
import { fetchContacts, fetchContactTags, fetchWithAuth } from '../utils/api.js';
import {
  loadTemplates, saveTemplates, resolveTemplateVariables,
  TEMPLATE_VARIABLES, DEFAULT_TEMPLATES
} from '../utils/templates.js';
import { showToast } from '../utils/toastBus.js';
import { formatPhone, jidToPhone } from '../utils/phone.js';

const CAMPAIGNS_STORAGE_KEY = 'whatsapp_broadcast_campaigns';

export default function Broadcast({ activeSessionId = 'default', userInfo, onOpenChat }) {
  const [activeTab, setActiveTab] = useState('composer'); // 'composer' | 'templates' | 'history'
  const [contacts, setContacts] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);

  // Templates state
  const [templates, setTemplates] = useState(loadTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateEditing, setTemplateEditing] = useState(null); // null or { id, title, text, category }
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  // Composer Form state
  const [campaignTitle, setCampaignTitle] = useState('');
  const [messageText, setMessageText] = useState(
    'Halo Kak {{name}}, terima kasih telah menjadi pelanggan setia kami! Kami memiliki penawaran spesial untuk Anda hari ini. 😊'
  );
  const [audienceMode, setAudienceMode] = useState('all'); // 'all' | 'tags' | 'manual' | 'custom'
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState(new Set());
  const [customNumbersText, setCustomNumbersText] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(4); // anti-ban delay (seconds)

  // Live Preview recipient
  const [previewRecipientIndex, setPreviewRecipientIndex] = useState(0);

  // Runner state
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [runnerProgress, setRunnerProgress] = useState({
    total: 0,
    current: 0,
    success: 0,
    failed: 0,
    logs: [],
  });
  const runnerCancelRef = useRef(false);
  const runnerPauseRef = useRef(false);

  // Campaign History state
  const [campaignHistory, setCampaignHistory] = useState(() => {
    try {
      const raw = localStorage.getItem(CAMPAIGNS_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Load contacts and tags on mount
  useEffect(() => {
    let mounted = true;
    Promise.all([fetchContacts(activeSessionId), fetchContactTags()])
      .then(([contactList, tagList]) => {
        if (!mounted) return;
        setContacts(contactList || []);
        setTags(tagList || []);
      })
      .catch(err => {
        console.error('[Broadcast] Failed to load contacts:', err);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [activeSessionId]);

  // Save templates on change
  const handleSaveTemplate = (tpl) => {
    let updated;
    if (tpl.id) {
      updated = templates.map(t => t.id === tpl.id ? tpl : t);
    } else {
      const newTpl = { ...tpl, id: `tpl_${Date.now()}` };
      updated = [...templates, newTpl];
    }
    setTemplates(updated);
    saveTemplates(updated);
    setShowTemplateModal(false);
    setTemplateEditing(null);
    showToast('Template saved successfully', 'success');
  };

  const handleDeleteTemplate = (id) => {
    if (window.confirm('Delete this message template?')) {
      const updated = templates.filter(t => t.id !== id);
      setTemplates(updated);
      saveTemplates(updated);
      if (selectedTemplateId === id) setSelectedTemplateId('');
      showToast('Template deleted', 'info');
    }
  };

  const handleApplyTemplate = (tplId) => {
    setSelectedTemplateId(tplId);
    const found = templates.find(t => t.id === tplId);
    if (found) {
      setMessageText(found.text);
      if (!campaignTitle) {
        setCampaignTitle(`Broadcast: ${found.title}`);
      }
    }
  };

  // Compute resolved target recipients based on audienceMode
  const targetRecipients = useMemo(() => {
    if (audienceMode === 'all') {
      return contacts.map(c => ({
        id: c.id,
        name: c.name || '',
        phone: c.phone || '',
        tags: c.tags || [],
      })).filter(c => !!c.phone);
    }

    if (audienceMode === 'tags') {
      if (selectedTags.length === 0) return [];
      return contacts.filter(c => {
        const cTags = c.tags || [];
        return selectedTags.some(t => cTags.includes(t));
      }).map(c => ({
        id: c.id,
        name: c.name || '',
        phone: c.phone || '',
        tags: c.tags || [],
      })).filter(c => !!c.phone);
    }

    if (audienceMode === 'manual') {
      return contacts.filter(c => selectedContactIds.has(c.id)).map(c => ({
        id: c.id,
        name: c.name || '',
        phone: c.phone || '',
        tags: c.tags || [],
      })).filter(c => !!c.phone);
    }

    if (audienceMode === 'custom') {
      // Parse lines formatted as "phone, Name" or just "phone"
      const lines = customNumbersText.split('\n').map(l => l.trim()).filter(Boolean);
      return lines.map((line, idx) => {
        const parts = line.split(',');
        const phone = parts[0]?.trim().replace(/\D/g, '') || '';
        const name = parts[1]?.trim() || '';
        return { id: `custom_${idx}`, name, phone, tags: [] };
      }).filter(c => c.phone.length >= 8);
    }

    return [];
  }, [contacts, audienceMode, selectedTags, selectedContactIds, customNumbersText]);

  // Active preview recipient
  const activePreviewRecipient = useMemo(() => {
    if (targetRecipients.length === 0) {
      return { name: 'Budi Santoso', phone: '6281234567890' };
    }
    const idx = Math.max(0, Math.min(previewRecipientIndex, targetRecipients.length - 1));
    return targetRecipients[idx] || { name: 'Pelanggan', phone: '6281234567890' };
  }, [targetRecipients, previewRecipientIndex]);

  // Render preview text
  const previewRenderedText = useMemo(() => {
    return resolveTemplateVariables(messageText, {
      name: activePreviewRecipient.name || 'Kak',
      phone: activePreviewRecipient.phone || '6281234567890',
      agentName: userInfo?.name || 'Tim Support',
    });
  }, [messageText, activePreviewRecipient, userInfo]);

  // Insert variable tag into message input
  const insertVariable = (variableKey) => {
    setMessageText(prev => prev + ` {{${variableKey}}} `);
  };

  // Toggle tag selection
  const toggleTagSelection = (tagName) => {
    setSelectedTags(prev => 
      prev.includes(tagName) ? prev.filter(t => t !== tagName) : [...prev, tagName]
    );
  };

  // Toggle single contact selection
  const toggleContactSelection = (contactId) => {
    setSelectedContactIds(prev => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });
  };

  const selectAllContacts = () => {
    setSelectedContactIds(new Set(contacts.map(c => c.id)));
  };

  const deselectAllContacts = () => {
    setSelectedContactIds(new Set());
  };

  // Start broadcast campaign
  const handleStartBroadcast = async () => {
    if (targetRecipients.length === 0) {
      showToast('No valid recipients selected', 'error');
      return;
    }
    if (!messageText.trim()) {
      showToast('Please enter message content', 'error');
      return;
    }

    const title = campaignTitle.trim() || `Broadcast Campaign ${new Date().toLocaleDateString('id-ID')}`;
    
    setIsRunning(true);
    setIsPaused(false);
    runnerCancelRef.current = false;
    runnerPauseRef.current = false;

    setRunnerProgress({
      total: targetRecipients.length,
      current: 0,
      success: 0,
      failed: 0,
      logs: [],
    });

    let successCount = 0;
    let failedCount = 0;
    const logs = [];

    for (let i = 0; i < targetRecipients.length; i++) {
      if (runnerCancelRef.current) {
        logs.unshift({ time: new Date().toLocaleTimeString(), text: '⚠️ Broadcast cancelled by user.', type: 'warn' });
        break;
      }

      // Handle pause loop
      while (runnerPauseRef.current && !runnerCancelRef.current) {
        await new Promise(r => setTimeout(r, 500));
      }

      const recipient = targetRecipients[i];
      const personalizedMsg = resolveTemplateVariables(messageText, {
        name: recipient.name || 'Kak',
        phone: recipient.phone,
        agentName: userInfo?.name || 'Tim Support',
      });

      let cleanPhone = recipient.phone.replace(/\D/g, '');
      if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
      const toJid = `${cleanPhone}@s.whatsapp.net`;

      try {
        const res = await fetchWithAuth('/api/messages/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: toJid,
            text: personalizedMsg,
            sessionId: activeSessionId,
          }),
        });

        if (res.ok) {
          successCount++;
          logs.unshift({
            time: new Date().toLocaleTimeString(),
            text: `✅ [${i + 1}/${targetRecipients.length}] Sent to ${recipient.name || cleanPhone} (${cleanPhone})`,
            type: 'success',
          });
        } else {
          const errData = await res.json().catch(() => ({}));
          failedCount++;
          logs.unshift({
            time: new Date().toLocaleTimeString(),
            text: `❌ [${i + 1}/${targetRecipients.length}] Failed for ${cleanPhone}: ${errData.error || 'Send error'}`,
            type: 'error',
          });
        }
      } catch (err) {
        failedCount++;
        logs.unshift({
          time: new Date().toLocaleTimeString(),
          text: `❌ [${i + 1}/${targetRecipients.length}] Network error for ${cleanPhone}: ${err.message}`,
          type: 'error',
        });
      }

      setRunnerProgress({
        total: targetRecipients.length,
        current: i + 1,
        success: successCount,
        failed: failedCount,
        logs: [...logs],
      });

      // Anti-ban delay between sends
      if (i < targetRecipients.length - 1) {
        const delayWithJitter = Math.max(1000, (delaySeconds * 1000) + (Math.random() * 1000 - 500));
        await new Promise(r => setTimeout(r, delayWithJitter));
      }
    }

    // Save completed campaign
    const newCampaignRecord = {
      id: `camp_${Date.now()}`,
      title,
      total: targetRecipients.length,
      success: successCount,
      failed: failedCount,
      timestamp: new Date().toISOString(),
      messageSnippet: messageText.slice(0, 100),
    };

    setCampaignHistory(prev => {
      const updated = [newCampaignRecord, ...prev];
      try { localStorage.setItem(CAMPAIGNS_STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });

    setIsRunning(false);
    showToast(`Broadcast completed: ${successCount} sent, ${failedCount} failed`, successCount > 0 ? 'success' : 'error');
  };

  const handlePauseResume = () => {
    const nextPaused = !isPaused;
    setIsPaused(nextPaused);
    runnerPauseRef.current = nextPaused;
  };

  const handleStopBroadcast = () => {
    if (window.confirm('Are you sure you want to stop the broadcast?')) {
      runnerCancelRef.current = true;
      setIsPaused(false);
      runnerPauseRef.current = false;
    }
  };

  const clearHistory = () => {
    if (window.confirm('Clear all past broadcast campaign history?')) {
      setCampaignHistory([]);
      try { localStorage.removeItem(CAMPAIGNS_STORAGE_KEY); } catch {}
      showToast('Campaign history cleared', 'info');
    }
  };

  return (
    <div className="view-container" style={{ paddingBottom: '80px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Top Header & KPI Bar */}
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '22px' }}>
        <div>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Megaphone className="text-primary" size={28} />
            Broadcast & Message Campaigns
          </h2>
          <p className="text-muted" style={{ marginTop: '4px', fontSize: '0.92rem' }}>
            Send mass WhatsApp campaigns with dynamic customer name variables (<code>{'{{name}}'}</code>), tag filters, and anti-ban pacing.
          </p>
        </div>

        {/* Action Button */}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => { setTemplateEditing({ title: '', text: '', category: 'General' }); setShowTemplateModal(true); }}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '600', fontSize: '0.85rem' }}
          >
            <Plus size={16} /> New Template
          </button>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: '14px',
        marginBottom: '24px'
      }}>
        <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'var(--primary-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
            <Users size={22} />
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: '0.78rem', fontWeight: '600', textTransform: 'uppercase' }}>Total CRM Contacts</div>
            <div style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-main)' }}>{contacts.length}</div>
          </div>
        </div>

        <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981' }}>
            <Sparkles size={22} />
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: '0.78rem', fontWeight: '600', textTransform: 'uppercase' }}>Saved Templates</div>
            <div style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-main)' }}>{templates.length}</div>
          </div>
        </div>

        <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(59, 130, 246, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#3b82f6' }}>
            <Send size={22} />
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: '0.78rem', fontWeight: '600', textTransform: 'uppercase' }}>Campaigns Dispatched</div>
            <div style={{ fontSize: '1.4rem', fontWeight: '800', color: 'var(--text-main)' }}>{campaignHistory.length}</div>
          </div>
        </div>

        <div className="card glass" style={{ padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="text-muted" style={{ fontSize: '0.78rem', fontWeight: '600', textTransform: 'uppercase' }}>Anti-Ban Protection</div>
            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={15} /> Active ({delaySeconds}s delay)
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '6px',
        padding: '6px',
        borderRadius: '12px',
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        marginBottom: '24px',
        boxShadow: 'var(--shadow-card)'
      }}>
        {[
          { id: 'composer', label: '🚀 Campaign Composer', count: `${targetRecipients.length} target` },
          { id: 'templates', label: '📝 Message Templates', count: templates.length },
          { id: 'history', label: '📜 Campaign History', count: campaignHistory.length },
        ].map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                padding: '11px 16px',
                borderRadius: '8px',
                border: 'none',
                background: isActive ? 'var(--primary)' : 'transparent',
                color: isActive ? '#ffffff' : 'var(--text-muted)',
                fontWeight: isActive ? '700' : '600',
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'var(--transition-smooth)',
                boxShadow: isActive ? '0 2px 8px var(--primary-glow)' : 'none'
              }}
            >
              <span>{tab.label}</span>
              <span style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '12px',
                background: isActive ? 'rgba(255,255,255,0.22)' : 'var(--overlay-subtle)',
                color: isActive ? '#ffffff' : 'var(--text-dimmed)'
              }}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: CAMPAIGN COMPOSER */}
      {/* ===================================================================== */}
      {activeTab === 'composer' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(360px, 1fr)', gap: '24px', alignItems: 'start' }}>
          {/* Left Column: Form & Audience */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Step 1: Campaign Title & Template Selection */}
            <div className="card glass" style={{ padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary)', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.82rem', fontWeight: '800' }}>
                  1
                </span>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-main)' }}>
                  Campaign Details & Template
                </h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">
                    <span>Campaign Name</span>
                    <span className="form-hint">(Internal identifier for reports)</span>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Promo Merdeka 2026 / Follow Up New Leads"
                    value={campaignTitle}
                    onChange={e => setCampaignTitle(e.target.value)}
                  />
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label className="form-label">
                    <span>Choose Message Template</span>
                    <span className="form-hint">(Optional — or write custom message below)</span>
                  </label>
                  <select
                    className="form-input form-select"
                    value={selectedTemplateId}
                    onChange={e => handleApplyTemplate(e.target.value)}
                  >
                    <option value="">-- Write Custom Message or Pick a Template --</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.title} [{t.category || 'General'}]
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Step 2: Message Content & Dynamic Variables */}
            <div className="card glass" style={{ padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--primary)', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.82rem', fontWeight: '800' }}>
                  2
                </span>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-main)' }}>
                  Message Content & Dynamic Placeholders
                </h3>
              </div>

              {/* Dynamic Variables helper bar */}
              <div style={{
                padding: '12px 14px',
                borderRadius: '12px',
                background: 'var(--bg-main)',
                border: '1.5px dashed var(--primary-border)',
                marginBottom: '14px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: '700', color: 'var(--primary)', marginBottom: '8px' }}>
                  <Sparkles size={14} /> Click to insert personalized recipient variable:
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {TEMPLATE_VARIABLES.map(v => (
                    <button
                      key={v.key}
                      type="button"
                      className="var-pill-btn"
                      onClick={() => insertVariable(v.key)}
                      title={v.desc}
                    >
                      <Plus size={12} /> {v.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <textarea
                  className="form-input form-textarea"
                  rows={6}
                  value={messageText}
                  onChange={e => setMessageText(e.target.value)}
                  placeholder="Type your broadcast message here. Use {{name}} to insert the customer's name automatically..."
                  style={{ lineHeight: '1.55', fontSize: '0.92rem' }}
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '0.78rem', color: 'var(--text-dimmed)' }}>
                  <span>WhatsApp formatting supported (*bold*, _italic_, ~strike~)</span>
                  <span style={{ fontWeight: '600', padding: '2px 8px', borderRadius: '6px', background: 'var(--bg-main)' }}>
                    {messageText.length} characters
                  </span>
                </div>
              </div>
            </div>

            {/* Step 3: Audience Selector */}
            <div className="card glass" style={{ padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Users size={18} className="text-primary" />
                  3. Select Audience ({targetRecipients.length} recipients)
                </h3>

                {/* Audience mode pills */}
                <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-main)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  {[
                    { id: 'all', label: 'All Contacts' },
                    { id: 'tags', label: 'Filter Tags' },
                    { id: 'manual', label: 'Pick Specific' },
                    { id: 'custom', label: 'Paste Numbers' },
                  ].map(mode => (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setAudienceMode(mode.id)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: 'none',
                        background: audienceMode === mode.id ? 'var(--primary)' : 'transparent',
                        color: audienceMode === mode.id ? 'white' : 'var(--text-muted)',
                        fontSize: '0.78rem',
                        fontWeight: '700',
                        cursor: 'pointer'
                      }}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tag filtering subview */}
              {audienceMode === 'tags' && (
                <div style={{ marginTop: '10px' }}>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 8px 0' }}>
                    Select customer tags to include:
                  </p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {tags.length === 0 ? (
                      <span className="text-muted" style={{ fontSize: '0.82rem' }}>No tags found. Add tags in Contacts view.</span>
                    ) : (
                      tags.map(t => {
                        const isSelected = selectedTags.includes(t.name);
                        return (
                          <button
                            key={t.name}
                            type="button"
                            onClick={() => toggleTagSelection(t.name)}
                            style={{
                              padding: '6px 14px',
                              borderRadius: '20px',
                              border: `1px solid ${isSelected ? 'var(--primary)' : 'var(--border-color)'}`,
                              background: isSelected ? 'var(--primary-subtle)' : 'var(--bg-main)',
                              color: isSelected ? 'var(--primary)' : 'var(--text-main)',
                              fontWeight: isSelected ? '700' : '600',
                              fontSize: '0.82rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                          >
                            <Tag size={13} />
                            {t.name}
                            <span style={{ fontSize: '0.72rem', opacity: 0.7 }}>({t.count || 0})</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Specific Contacts picker */}
              {audienceMode === 'manual' && (
                <div style={{ marginTop: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dimmed)' }} />
                      <input
                        type="text"
                        className="form-input"
                        placeholder="Search contact name or phone..."
                        value={contactSearch}
                        onChange={e => setContactSearch(e.target.value)}
                        style={{ paddingLeft: '32px', width: '100%', fontSize: '0.82rem' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={selectAllContacts} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem' }}>Select All</button>
                      <button onClick={deselectAllContacts} className="btn btn-secondary btn-sm" style={{ fontSize: '0.75rem' }}>Deselect</button>
                    </div>
                  </div>

                  <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                    {contacts.filter(c => {
                      const q = contactSearch.toLowerCase();
                      return (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q);
                    }).map(c => {
                      const isChecked = selectedContactIds.has(c.id);
                      return (
                        <div
                          key={c.id}
                          onClick={() => toggleContactSelection(c.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderBottom: '1px solid var(--border-color)',
                            background: isChecked ? 'var(--primary-subtle)' : 'transparent',
                            cursor: 'pointer'
                          }}
                        >
                          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.84rem', cursor: 'pointer', fontWeight: '600' }}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              style={{ accentColor: 'var(--primary)' }}
                            />
                            <span>{c.name || 'Unnamed Contact'}</span>
                          </label>
                          <span className="text-muted" style={{ fontSize: '0.78rem' }}>{formatPhone(c.phone)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Custom pasted numbers */}
              {audienceMode === 'custom' && (
                <div style={{ marginTop: '10px' }}>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 6px 0' }}>
                    Paste numbers in CSV format: <code>phone, Customer Name</code> (one per line)
                  </p>
                  <textarea
                    className="form-input"
                    rows={4}
                    value={customNumbersText}
                    onChange={e => setCustomNumbersText(e.target.value)}
                    placeholder={"6281234567890, John Doe\n6289876543210, Sarah Connor"}
                    style={{ width: '100%', fontSize: '0.82rem', fontFamily: 'monospace' }}
                  />
                </div>
              )}
            </div>

            {/* Step 4: Anti-Ban & Dispatch Button */}
            <div className="card glass" style={{ padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
              <h3 style={{ margin: '0 0 14px 0', fontSize: '1.1rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <ShieldCheck size={18} className="text-primary" />
                4. Anti-Ban Safe Pacing & Launch
              </h3>

              <div style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', fontWeight: '700', color: 'var(--text-main)' }}>
                  <span>Safe Interval Delay</span>
                  <span style={{ color: 'var(--primary)' }}>{delaySeconds} seconds / message</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="15"
                  value={delaySeconds}
                  onChange={e => setDelaySeconds(Number(e.target.value))}
                  style={{ width: '100%', marginTop: '6px', accentColor: 'var(--primary)' }}
                />
                <p className="text-muted" style={{ margin: '4px 0 0 0', fontSize: '0.78rem' }}>
                  🛡️ Random ±0.5s jitter is automatically applied to mimic human typing and protect your WhatsApp number.
                </p>
              </div>

              <button
                onClick={handleStartBroadcast}
                disabled={targetRecipients.length === 0 || !messageText.trim() || isRunning}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '14px',
                  fontSize: '1rem',
                  fontWeight: '800',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '10px',
                  boxShadow: '0 4px 16px var(--primary-glow)'
                }}
              >
                <Send size={18} />
                Start Broadcast to {targetRecipients.length} Recipients
              </button>
            </div>
          </div>

          {/* Right Column: Live WhatsApp Message Preview & Live Progress */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', position: 'sticky', top: '20px' }}>
            {/* Live Personalized Preview Card */}
            <div className="card glass" style={{ padding: '22px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Eye size={16} className="text-primary" />
                  Live Preview Simulator
                </h3>
                <span className="badge badge-primary" style={{ fontSize: '0.72rem' }}>
                  Personalized View
                </span>
              </div>

              {/* Recipient switcher */}
              {targetRecipients.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: '8px', background: 'var(--bg-main)', marginBottom: '12px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>Simulating Recipient:</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      onClick={() => setPreviewRecipientIndex(p => Math.max(0, p - 1))}
                      disabled={previewRecipientIndex === 0}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                    >
                      ←
                    </button>
                    <span style={{ fontSize: '0.78rem', fontWeight: '700' }}>
                      {activePreviewRecipient.name || formatPhone(activePreviewRecipient.phone)}
                    </span>
                    <button
                      onClick={() => setPreviewRecipientIndex(p => Math.min(targetRecipients.length - 1, p + 1))}
                      disabled={previewRecipientIndex >= targetRecipients.length - 1}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '2px 8px', fontSize: '0.75rem' }}
                    >
                      →
                    </button>
                  </div>
                </div>
              )}

              {/* Mock WhatsApp Bubble */}
              <div style={{
                background: 'var(--bg-main)',
                borderRadius: '12px',
                padding: '16px',
                border: '1px solid var(--border-color)',
                backgroundImage: 'radial-gradient(rgba(0,0,0,0.03) 1px, transparent 0)',
                backgroundSize: '16px 16px'
              }}>
                <div style={{
                  maxWidth: '85%',
                  marginLeft: 'auto',
                  background: 'var(--chat-bubble-out, #d9fdd3)',
                  color: 'var(--chat-bubble-out-text, #111b21)',
                  borderRadius: '10px 10px 2px 10px',
                  padding: '10px 14px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                  fontSize: '0.88rem',
                  lineHeight: '1.45',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}>
                  {previewRenderedText}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px', fontSize: '0.68rem', color: 'var(--text-dimmed)', marginTop: '4px' }}>
                    <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    <CheckCircle2 size={12} color="#53bdeb" />
                  </div>
                </div>
              </div>
            </div>

            {/* Live Progress Runner (If running or just completed) */}
            {(isRunning || runnerProgress.total > 0) && (
              <div className="card glass" style={{ padding: '22px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: '800' }}>
                    {isRunning ? (isPaused ? '⏸ Broadcast Paused' : '⚡ Broadcast in Progress') : '✅ Broadcast Finished'}
                  </h3>

                  {isRunning && (
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={handlePauseResume}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                      >
                        {isPaused ? <Play size={13} /> : <Pause size={13} />}
                        {isPaused ? 'Resume' : 'Pause'}
                      </button>
                      <button
                        onClick={handleStopBroadcast}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 10px', fontSize: '0.78rem', color: '#ef4444' }}
                      >
                        <Square size={13} /> Stop
                      </button>
                    </div>
                  )}
                </div>

                {/* Progress bar */}
                <div style={{ width: '100%', height: '8px', borderRadius: '6px', background: 'var(--bg-main)', overflow: 'hidden', marginBottom: '12px' }}>
                  <div style={{
                    width: `${runnerProgress.total ? (runnerProgress.current / runnerProgress.total) * 100 : 0}%`,
                    height: '100%',
                    background: isRunning ? 'var(--primary)' : '#10b981',
                    transition: 'width 0.3s ease'
                  }} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: '700', marginBottom: '14px' }}>
                  <span>Sent: {runnerProgress.current} / {runnerProgress.total}</span>
                  <span style={{ color: '#10b981' }}>Success: {runnerProgress.success}</span>
                  {runnerProgress.failed > 0 && <span style={{ color: '#ef4444' }}>Failed: {runnerProgress.failed}</span>}
                </div>

                {/* Log stream */}
                <div style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  background: 'var(--bg-main)',
                  borderRadius: '8px',
                  padding: '8px 10px',
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  {runnerProgress.logs.slice(0, 30).map((log, idx) => (
                    <div key={idx} style={{ color: log.type === 'error' ? '#ef4444' : log.type === 'warn' ? '#f59e0b' : 'var(--text-main)' }}>
                      <span style={{ color: 'var(--text-dimmed)', marginRight: '6px' }}>[{log.time}]</span>
                      {log.text}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: MESSAGE TEMPLATES MANAGEMENT */}
      {/* ===================================================================== */}
      {activeTab === 'templates' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800' }}>Saved Message Templates</h3>
                <p className="text-muted" style={{ fontSize: '0.86rem', margin: '4px 0 0 0' }}>
                  Pre-configured quick reply templates with dynamic variable placeholders for chats and broadcasts.
                </p>
              </div>

              <button
                onClick={() => { setTemplateEditing({ title: '', text: '', category: 'General' }); setShowTemplateModal(true); }}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: '700', fontSize: '0.85rem' }}
              >
                <Plus size={16} /> Add Template
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
              {templates.map(tpl => (
                <div
                  key={tpl.id}
                  style={{
                    padding: '18px',
                    borderRadius: '12px',
                    background: 'var(--bg-main)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '12px'
                  }}
                >
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <strong style={{ fontSize: '0.96rem', color: 'var(--text-main)' }}>{tpl.title}</strong>
                      <span className="badge badge-secondary" style={{ fontSize: '0.72rem' }}>{tpl.category || 'General'}</span>
                    </div>
                    <p style={{
                      margin: 0,
                      fontSize: '0.84rem',
                      color: 'var(--text-muted)',
                      lineHeight: '1.45',
                      whiteSpace: 'pre-wrap'
                    }}>
                      {tpl.text}
                    </p>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '10px' }}>
                    <button
                      onClick={() => {
                        setMessageText(tpl.text);
                        setSelectedTemplateId(tpl.id);
                        setActiveTab('composer');
                        showToast(`Template "${tpl.title}" loaded in composer`, 'info');
                      }}
                      className="btn btn-secondary btn-sm"
                      style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      Use in Broadcast <ArrowRight size={13} />
                    </button>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={() => { setTemplateEditing(tpl); setShowTemplateModal(true); }}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px' }}
                        title="Edit Template"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => handleDeleteTemplate(tpl.id)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '4px 8px', color: '#ef4444' }}
                        title="Delete Template"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: CAMPAIGN HISTORY */}
      {/* ===================================================================== */}
      {activeTab === 'history' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800' }}>Broadcast Campaign History</h3>
                <p className="text-muted" style={{ fontSize: '0.86rem', margin: '4px 0 0 0' }}>
                  Track past delivery metrics, success rates, and campaign dispatches.
                </p>
              </div>

              {campaignHistory.length > 0 && (
                <button
                  onClick={clearHistory}
                  className="btn btn-secondary btn-sm"
                  style={{ color: '#ef4444' }}
                >
                  Clear History
                </button>
              )}
            </div>

            {campaignHistory.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                <Megaphone size={40} style={{ opacity: 0.3, marginBottom: '10px' }} />
                <h4>No broadcast campaigns recorded yet</h4>
                <p style={{ fontSize: '0.84rem' }}>Launch your first campaign from the Composer tab above!</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {campaignHistory.map(camp => (
                  <div
                    key={camp.id}
                    style={{
                      padding: '14px 18px',
                      borderRadius: '10px',
                      background: 'var(--bg-main)',
                      border: '1px solid var(--border-color)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '12px'
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '0.94rem', color: 'var(--text-main)' }}>{camp.title}</strong>
                      <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: '3px' }}>
                        {new Date(camp.timestamp).toLocaleString('id-ID')} • Message: "{camp.messageSnippet}..."
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.86rem', fontWeight: '700', color: '#10b981' }}>
                          {camp.success} / {camp.total} Sent
                        </div>
                        {camp.failed > 0 && (
                          <div style={{ fontSize: '0.74rem', color: '#ef4444' }}>
                            {camp.failed} Failed
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: ADD / EDIT TEMPLATE */}
      {/* ===================================================================== */}
      {showTemplateModal && templateEditing && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, padding: '20px'
        }}>
          <div className="card" style={{ maxWidth: '560px', width: '100%', padding: '24px', borderRadius: '16px', background: 'var(--card-bg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: '800' }}>
                {templateEditing.id ? 'Edit Template' : 'New Message Template'}
              </h3>
              <button
                onClick={() => { setShowTemplateModal(false); setTemplateEditing(null); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">
                  <span>Template Title</span>
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. 👋 Promo Ramadhan / Pengingat Tagihan"
                  value={templateEditing.title}
                  onChange={e => setTemplateEditing(prev => ({ ...prev, title: e.target.value }))}
                />
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">
                  <span>Category</span>
                </label>
                <select
                  className="form-input form-select"
                  value={templateEditing.category || 'General'}
                  onChange={e => setTemplateEditing(prev => ({ ...prev, category: e.target.value }))}
                >
                  <option value="General">General</option>
                  <option value="Marketing">Marketing & Promo</option>
                  <option value="Sales">Sales & Follow-Up</option>
                  <option value="Support">Customer Support</option>
                  <option value="Billing">Billing & Invoice</option>
                </select>
              </div>

              <div className="form-group" style={{ margin: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ margin: 0 }}>
                    <span>Message Content</span>
                  </label>
                </div>

                {/* Variable inserter */}
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-dimmed)', alignSelf: 'center' }}>Insert:</span>
                  {TEMPLATE_VARIABLES.map(v => (
                    <button
                      key={v.key}
                      type="button"
                      className="var-pill-btn"
                      onClick={() => setTemplateEditing(prev => ({ ...prev, text: (prev.text || '') + ` ${v.label} ` }))}
                    >
                      + {v.label}
                    </button>
                  ))}
                </div>

                <textarea
                  className="form-input form-textarea"
                  rows={4}
                  placeholder="Type message content... Example: Halo Kak {{name}}, terima kasih telah berbelanja..."
                  value={templateEditing.text}
                  onChange={e => setTemplateEditing(prev => ({ ...prev, text: e.target.value }))}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => { setShowTemplateModal(false); setTemplateEditing(null); }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveTemplate(templateEditing)}
                  disabled={!templateEditing.title?.trim() || !templateEditing.text?.trim()}
                  className="btn btn-primary"
                >
                  Save Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
