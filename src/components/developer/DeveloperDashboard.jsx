import React, { useState, useEffect } from 'react';
import {
  Key, Webhook, Play, FileCode, Bot, Copy, Check, Plus, Trash2, RefreshCw,
  Send, Shield, CheckCircle2, XCircle, Clock, AlertTriangle, ExternalLink,
  Code2, Eye, EyeOff, Layers, Radio, Sparkles, Terminal, Activity, ArrowRight,
  Zap, Lock, Cpu, Server, CheckCheck, HelpCircle, ChevronRight, Globe,
  Download, Database, Sliders, Smartphone, CornerDownRight
} from 'lucide-react';
import { fetchWithAuth } from '../../utils/api.js';
import { showToast } from '../../utils/toastBus.js';

export default function DeveloperDashboard({ userProfile, activeSessionId = 'default' }) {
  const [activeSubTab, setActiveSubTab] = useState('keys');

  // API Keys state
  const [keys, setKeys] = useState([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [showNewKeyModal, setShowNewKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyScopes, setNewKeyScopes] = useState([
    'messages:send', 'messages:read', 'contacts:sync', 'sessions:read', 'agent:hold'
  ]);
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState(null); // Once generated

  // Webhook state
  const [webhookConfig, setWebhookConfig] = useState({
    webhookUrl: '',
    secret: '',
    events: ['message.received', 'message.status', 'session.status', 'agent.hold', 'agent.resume'],
    isActive: true,
  });
  const [loadingWebhook, setLoadingWebhook] = useState(true);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [webhookLogs, setWebhookLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  // Webhook Tester state
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // API Playground state
  const [playgroundEndpoint, setPlaygroundEndpoint] = useState('send_text');
  const [playgroundSessionId, setPlaygroundSessionId] = useState(activeSessionId || 'default');
  const [playgroundTo, setPlaygroundTo] = useState('');
  const [playgroundText, setPlaygroundText] = useState('Hello from WhatsApp UAPI Playground! 🚀');
  const [playgroundMediaUrl, setPlaygroundMediaUrl] = useState('https://images.unsplash.com/photo-1579202673506-ca3ce28943ef?w=800');
  const [playgroundHoldPaused, setPlaygroundHoldPaused] = useState(true);
  const [playgroundNote, setPlaygroundNote] = useState('Operator stepping in for manual assistance');
  const [runningPlayground, setRunningPlayground] = useState(false);
  const [playgroundResponse, setPlaygroundResponse] = useState(null);

  // SDK / Code Snippet state
  const [selectedSnippetLang, setSelectedSnippetLang] = useState('curl');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [copiedKeyId, setCopiedKeyId] = useState(null);

  // Auth helper format tab
  const [authHeaderFormat, setAuthHeaderFormat] = useState('bearer');

  const availableScopes = [
    { id: 'messages:send', label: 'messages:send', title: 'Send Messages', desc: 'Send text, media, documents, and templates', color: '#3b82f6' },
    { id: 'messages:read', label: 'messages:read', title: 'Read Messages & History', desc: 'Fetch conversation logs and message history', color: '#10b981' },
    { id: 'contacts:sync', label: 'contacts:sync', title: 'Contacts Sync', desc: 'Read and update saved address book & CRM contacts', color: '#8b5cf6' },
    { id: 'sessions:read', label: 'sessions:read', title: 'Sessions & QR', desc: 'Check device connection state and QR codes', color: '#06b6d4' },
    { id: 'agent:hold', label: 'agent:hold', title: 'AI Bot Hold / Resume', desc: 'Pause and resume automated replies for chats', color: '#f59e0b' },
  ];

  const availableEvents = [
    { id: 'message.received', label: 'message.received', title: 'Incoming Message', desc: 'Real-time incoming customer messages (text, media, location, buttons)' },
    { id: 'message.sent', label: 'message.sent', title: 'Outbound Message', desc: 'Messages sent by operators, bots, or external REST API' },
    { id: 'message.status', label: 'message.status', title: 'Delivery Status Update', desc: 'Delivery receipts, double grey ticks, and blue read receipts' },
    { id: 'session.status', label: 'session.status', title: 'Device Connection', desc: 'WhatsApp session updates (QR code ready, connected, disconnected)' },
    { id: 'agent.hold', label: 'agent.hold', title: 'Human Agent Takeover', desc: 'Fired when a human agent takes over and pauses bot replies' },
    { id: 'agent.resume', label: 'agent.resume', title: 'AI Bot Resumed', desc: 'Fired when bot auto-reply is resumed for a conversation' },
  ];

  // Base API URL
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000';

  // Quota details
  const sent = userProfile?.messagesSent || 0;
  const limit = userProfile?.messageLimit ?? 500;
  const quotaPercent = limit > 0 ? Math.min((sent / limit) * 100, 100) : 0;

  // Load API Keys
  const loadKeys = async () => {
    setLoadingKeys(true);
    try {
      const res = await fetchWithAuth('/api/developer/keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(data);
      }
    } catch (e) {
      console.warn('Failed to load API keys:', e);
    } finally {
      setLoadingKeys(false);
    }
  };

  // Load Webhook Config
  const loadWebhookConfig = async () => {
    setLoadingWebhook(true);
    try {
      const res = await fetchWithAuth('/api/developer/webhook');
      if (res.ok) {
        const data = await res.json();
        if (data) {
          setWebhookConfig({
            webhookUrl: data.webhookUrl || '',
            secret: data.secret || '',
            events: Array.isArray(data.events) && data.events.length > 0
              ? data.events
              : ['message.received', 'message.status', 'session.status', 'agent.hold', 'agent.resume'],
            isActive: data.isActive !== undefined ? data.isActive : true,
          });
        }
      }
    } catch (e) {
      console.warn('Failed to load webhook config:', e);
    } finally {
      setLoadingWebhook(false);
    }
  };

  // Load Webhook Logs
  const loadWebhookLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await fetchWithAuth('/api/developer/webhook/logs?limit=30');
      if (res.ok) {
        const data = await res.json();
        setWebhookLogs(data);
      }
    } catch (e) {
      console.warn('Failed to load webhook logs:', e);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadKeys();
    loadWebhookConfig();
  }, []);

  useEffect(() => {
    if (activeSubTab === 'webhook') {
      loadWebhookLogs();
    }
  }, [activeSubTab]);

  // Create API Key
  const handleCreateKey = async (e) => {
    e.preventDefault();
    if (creatingKey) return;
    setCreatingKey(true);
    try {
      const res = await fetchWithAuth('/api/developer/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName || 'API Key',
          scopes: newKeyScopes,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        setRevealedKey(created);
        setKeys(prev => [created, ...prev]);
        setShowNewKeyModal(false);
        setNewKeyName('');
        showToast('API Key created successfully!', 'success');
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || 'Failed to create key', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setCreatingKey(false);
    }
  };

  // Revoke API Key
  const handleRevokeKey = async (keyId) => {
    if (!window.confirm('Are you sure you want to revoke this API key? Applications using it will stop working immediately.')) {
      return;
    }
    try {
      const res = await fetchWithAuth(`/api/developer/keys/${keyId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setKeys(prev => prev.filter(k => k.id !== keyId));
        showToast('API Key revoked', 'info');
      } else {
        showToast('Failed to revoke API key', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  // Save Webhook Config
  const handleSaveWebhook = async (e) => {
    e?.preventDefault();
    if (savingWebhook) return;
    setSavingWebhook(true);
    try {
      const res = await fetchWithAuth('/api/developer/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(webhookConfig),
      });
      if (res.ok) {
        showToast('Webhook configuration saved!', 'success');
      } else {
        showToast('Failed to save webhook configuration', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSavingWebhook(false);
    }
  };

  // Generate random secret
  const handleGenerateSecret = () => {
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    setWebhookConfig(prev => ({ ...prev, secret: `whsec_${randomHex}` }));
  };

  // Send Test Webhook
  const handleTestWebhook = async () => {
    if (!webhookConfig.webhookUrl) {
      showToast('Please enter a Webhook URL first', 'warning');
      return;
    }
    setTestingWebhook(true);
    setTestResult(null);
    try {
      const res = await fetchWithAuth('/api/developer/webhook/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: webhookConfig.webhookUrl,
          secret: webhookConfig.secret,
        }),
      });
      const data = await res.json();
      setTestResult(data);
      if (data.success) {
        showToast(`Webhook ping returned ${data.responseStatus || 200} in ${data.latencyMs}ms`, 'success');
      } else {
        showToast(`Webhook test failed: ${data.status} (Status ${data.responseStatus || 'N/A'})`, 'error');
      }
      loadWebhookLogs();
    } catch (err) {
      showToast(`Test failed: ${err.message}`, 'error');
    } finally {
      setTestingWebhook(false);
    }
  };

  // Run Playground Request
  const handleRunPlayground = async () => {
    setRunningPlayground(true);
    setPlaygroundResponse(null);
    const start = Date.now();

    try {
      let endpoint = '';
      let method = 'POST';
      let body = null;

      if (playgroundEndpoint === 'send_text') {
        if (!playgroundTo.trim()) {
          showToast('Please enter recipient phone / JID', 'warning');
          setRunningPlayground(false);
          return;
        }
        endpoint = `/api/messages/send?sessionId=${encodeURIComponent(playgroundSessionId)}`;
        body = {
          to: playgroundTo.trim(),
          text: playgroundText,
          sessionId: playgroundSessionId,
          source: 'developer_playground',
        };
      } else if (playgroundEndpoint === 'send_media') {
        if (!playgroundTo.trim()) {
          showToast('Please enter recipient phone / JID', 'warning');
          setRunningPlayground(false);
          return;
        }
        endpoint = `/api/messages/send?sessionId=${encodeURIComponent(playgroundSessionId)}`;
        body = {
          to: playgroundTo.trim(),
          file: {
            url: playgroundMediaUrl,
            caption: playgroundText,
            mimetype: 'image/jpeg',
            filename: 'photo.jpg',
          },
          sessionId: playgroundSessionId,
          source: 'developer_playground',
        };
      } else if (playgroundEndpoint === 'hold_toggle') {
        if (!playgroundTo.trim()) {
          showToast('Please enter chat phone / JID', 'warning');
          setRunningPlayground(false);
          return;
        }
        const formattedJid = playgroundTo.includes('@') ? playgroundTo.trim() : `${playgroundTo.replace(/\D/g, '')}@s.whatsapp.net`;
        endpoint = `/api/chats/${encodeURIComponent(formattedJid)}/settings?sessionId=${encodeURIComponent(playgroundSessionId)}`;
        body = {
          botPaused: playgroundHoldPaused,
          note: playgroundNote,
        };
      } else if (playgroundEndpoint === 'list_chats') {
        endpoint = `/api/chats?sessionId=${encodeURIComponent(playgroundSessionId)}`;
        method = 'GET';
      } else if (playgroundEndpoint === 'list_contacts') {
        endpoint = `/api/contacts`;
        method = 'GET';
      }

      const res = await fetchWithAuth(endpoint, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });

      const latency = Date.now() - start;
      const status = res.status;
      const data = await res.json().catch(err => ({ error: 'Non-JSON response', details: err.message }));

      setPlaygroundResponse({
        status,
        statusText: res.statusText,
        ok: res.ok,
        latency,
        data,
      });

      if (res.ok) {
        showToast(`Request executed successfully (${status} in ${latency}ms)`, 'success');
      } else {
        showToast(`Request returned status ${status}`, 'error');
      }
    } catch (err) {
      setPlaygroundResponse({
        status: 0,
        statusText: 'Network / Client Error',
        ok: false,
        latency: Date.now() - start,
        data: { error: err.message },
      });
      showToast(err.message, 'error');
    } finally {
      setRunningPlayground(false);
    }
  };

  // Copy helper
  const copyToClipboard = (text, id = 'default') => {
    navigator.clipboard.writeText(text);
    if (id === 'snippet') {
      setCopiedSnippet(true);
      setTimeout(() => setCopiedSnippet(false), 2000);
    } else {
      setCopiedKeyId(id);
      setTimeout(() => setCopiedKeyId(null), 2000);
    }
    showToast('Copied to clipboard!', 'info');
  };

  // Get sample API key for code snippets
  const sampleApiKey = keys.length > 0 ? (revealedKey?.rawKey || `wapi_live_${keys[0].id.slice(4)}...`) : 'wapi_live_your_secret_api_key_here';

  // Code Snippet generators
  const getCodeSnippet = (lang) => {
    if (lang === 'curl') {
      return `# 1. Send WhatsApp Text Message
curl -X POST "${baseUrl}/api/messages/send" \\
  -H "Authorization: Bearer ${sampleApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "${activeSessionId}",
    "to": "6281234567890@s.whatsapp.net",
    "text": "Hello from external backend! 🚀",
    "source": "bot"
  }'

# 2. Put Chat on Hold (Pause AI Bot for human agent takeover)
curl -X POST "${baseUrl}/api/chats/6281234567890@s.whatsapp.net/settings" \\
  -H "Authorization: Bearer ${sampleApiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "sessionId": "${activeSessionId}",
    "botPaused": true,
    "note": "AI Bot paused: Customer requested human agent"
  }'`;
    }

    if (lang === 'node') {
      return `// Node.js (v18+ native fetch or axios)
const API_KEY = '${sampleApiKey}';
const BASE_URL = '${baseUrl}';

async function sendWhatsAppMessage(recipientPhone, messageText) {
  const jid = recipientPhone.includes('@') ? recipientPhone : \`\${recipientPhone.replace(/\\D/g, '')}@s.whatsapp.net\`;

  const response = await fetch(\`\${BASE_URL}/api/messages/send\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${API_KEY}\`,
      'Content-Type': 'application/json',
      'X-Agent-Source': 'bot'
    },
    body: JSON.stringify({
      sessionId: '${activeSessionId}',
      to: jid,
      text: messageText,
      source: 'bot'
    })
  });

  const data = await response.json();
  console.log('Message status:', data);
  return data;
}

sendWhatsAppMessage('6281234567890', 'Hello from Node.js service!');`;
    }

    if (lang === 'python') {
      return `# Python (requests or httpx)
import requests

API_KEY = "${sampleApiKey}"
BASE_URL = "${baseUrl}"

def send_message(phone_number: str, message: str):
    jid = phone_number if "@" in phone_number else f"{phone_number.strip()}@s.whatsapp.net"
    
    url = f"{BASE_URL}/api/messages/send"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "X-Agent-Source": "bot"
    }
    payload = {
        "sessionId": "${activeSessionId}",
        "to": jid,
        "text": message,
        "source": "bot"
    }
    
    res = requests.post(url, json=payload, headers=headers)
    print("Response:", res.status_code, res.json())
    return res.json()

if __name__ == "__main__":
    send_message("6281234567890", "Hello from Python automation script! 🐍")`;
    }

    if (lang === 'php') {
      return `<?php
// PHP (cURL or Laravel Http Client)
$apiKey = '${sampleApiKey}';
$baseUrl = '${baseUrl}';

$phone = '6281234567890';
$jid = str_contains($phone, '@') ? $phone : preg_replace('/\\D/', '', $phone) . '@s.whatsapp.net';

$payload = [
    'sessionId' => '${activeSessionId}',
    'to' => $jid,
    'text' => 'Hello from PHP Laravel backend! 🐘',
    'source' => 'bot'
];

$ch = curl_init("$baseUrl/api/messages/send");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer $apiKey",
    "Content-Type: application/json",
    "X-Agent-Source: bot"
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "Status: $httpCode\\nResponse: $response\\n";
?>`;
    }

    if (lang === 'go') {
      return `package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

func main() {
	apiKey := "${sampleApiKey}"
	url := "${baseUrl}/api/messages/send"

	payload := map[string]interface{}{
		"sessionId": "${activeSessionId}",
		"to":        "6281234567890@s.whatsapp.net",
		"text":      "Hello from Go service! 🚀",
		"source":    "bot",
	}

	body, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(body))
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Agent-Source", "bot")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	fmt.Println("Status:", resp.Status)
}`;
    }

    return '';
  };

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
        maxWidth: '1360px',
        margin: '0 auto',
        padding: '24px 28px 80px',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {/* ========================================================================= */}
        {/* HERO / DEVELOPER HEADER */}
        {/* ========================================================================= */}
        <div style={{
          position: 'relative',
          borderRadius: '16px',
          padding: '28px 32px',
          marginBottom: '24px',
          background: 'linear-gradient(135deg, rgba(63, 103, 216, 0.08) 0%, rgba(16, 185, 129, 0.04) 100%)',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-card)'
        }}>
          <div style={{
            position: 'absolute',
            top: '-60px',
            right: '-40px',
            width: '240px',
            height: '240px',
            background: 'radial-gradient(circle, var(--primary-glow) 0%, transparent 70%)',
            borderRadius: '50%',
            pointerEvents: 'none',
            opacity: 0.6
          }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '20px', position: 'relative', zIndex: 1 }}>
            <div style={{ maxWidth: '640px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '4px 12px', borderRadius: '20px', background: 'var(--card-bg)', border: '1px solid var(--border-color)', fontSize: '0.78rem', fontWeight: '600', color: 'var(--primary)', marginBottom: '12px' }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981', display: 'inline-block' }} />
                REST API v1 & Realtime Webhooks Engine Active
              </div>
              <h1 style={{ margin: '0 0 8px 0', fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.02em', color: 'var(--text-main)' }}>
                Developer & API Integration
              </h1>
              <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
                Seamlessly connect external CRM systems, dispatch real-time incoming message events, orchestrate AI Chatbots with human operator takeover, and automate WhatsApp workflows.
              </p>
            </div>

            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => {
                  setActiveSubTab('playground');
                }}
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 18px', fontWeight: '600', fontSize: '0.86rem' }}
              >
                <Play size={16} className="text-primary" />
                API Playground
              </button>
              <button
                onClick={() => setShowNewKeyModal(true)}
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px', fontWeight: '700', fontSize: '0.88rem', boxShadow: '0 4px 14px var(--primary-glow)' }}
              >
                <Plus size={18} />
                Create API Key
              </button>
            </div>
          </div>

          {/* Quick KPI Stat Chips */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '14px',
            marginTop: '24px',
            position: 'relative',
            zIndex: 1
          }}>
            {/* Base URL */}
            <div style={{ padding: '14px 16px', borderRadius: '10px', background: 'var(--card-bg)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Server size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dimmed)', fontWeight: '700' }}>API Gateway</div>
                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {baseUrl}
                </div>
              </div>
            </div>

            {/* Active Keys */}
            <div style={{ padding: '14px 16px', borderRadius: '10px', background: 'var(--card-bg)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Key size={18} />
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dimmed)', fontWeight: '700' }}>Active Keys</div>
                <div style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text-main)' }}>
                  {keys.length} <span style={{ fontSize: '0.75rem', fontWeight: '500', color: 'var(--text-muted)' }}>configured</span>
                </div>
              </div>
            </div>

            {/* Webhook Status */}
            <div style={{ padding: '14px 16px', borderRadius: '10px', background: 'var(--card-bg)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Webhook size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dimmed)', fontWeight: '700' }}>Webhook Endpoint</div>
                <div style={{ fontSize: '0.85rem', fontWeight: '600', color: webhookConfig.webhookUrl ? '#10b981' : 'var(--text-dimmed)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {webhookConfig.webhookUrl ? 'Configured & Active' : 'Not Configured'}
                </div>
              </div>
            </div>

            {/* Messages Quota Tracker */}
            <div style={{ padding: '14px 16px', borderRadius: '10px', background: 'var(--card-bg)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Zap size={18} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-dimmed)' }}>
                  <span>QUOTA</span>
                  <span>{sent} / {limit}</span>
                </div>
                <div style={{ height: '5px', borderRadius: '3px', background: 'var(--border-color)', marginTop: '4px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${quotaPercent}%`, background: quotaPercent > 90 ? '#ef4444' : 'var(--primary)', borderRadius: '3px', transition: 'width 0.3s' }} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SEGMENTED NAVIGATION TABS */}
        {/* ========================================================================= */}
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
            { id: 'keys', label: 'API Keys & Auth', icon: Key, badge: keys.length > 0 ? keys.length : null },
            { id: 'webhook', label: 'Realtime Webhooks', icon: Webhook, badge: webhookLogs.length > 0 ? webhookLogs.length : null },
            { id: 'playground', label: 'API Playground', icon: Play },
            { id: 'sdks', label: 'Code Snippets & SDKs', icon: FileCode },
            { id: 'bot_handoff', label: 'AI Bot & Workflows', icon: Bot },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSubTab(tab.id)}
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
                {tab.badge !== null && tab.badge !== undefined && (
                  <span style={{
                    padding: '2px 7px',
                    borderRadius: '10px',
                    fontSize: '0.72rem',
                    fontWeight: '700',
                    background: isActive ? 'rgba(255, 255, 255, 0.25)' : 'var(--primary-subtle)',
                    color: isActive ? '#ffffff' : 'var(--primary)'
                  }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

      {/* ========================================================================= */}
      {/* TAB 1: API KEYS & AUTH (REDESIGNED) */}
      {/* ========================================================================= */}
      {activeSubTab === 'keys' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Newly Created Key Alert (One-time Reveal) */}
          {revealedKey && (
            <div style={{
              padding: '20px 24px',
              borderRadius: '12px',
              backgroundColor: '#064e3b',
              border: '1px solid #059669',
              color: '#d1fae5',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxShadow: '0 8px 24px rgba(5, 150, 105, 0.2)',
              animation: 'fadeIn 0.3s ease-out'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Sparkles size={18} style={{ color: '#ffffff' }} />
                  </div>
                  <div>
                    <strong style={{ fontSize: '1.02rem', color: '#ffffff' }}>New API Key Created: {revealedKey.name}</strong>
                    <div style={{ fontSize: '0.8rem', color: '#a7f3d0' }}>Copy this key now. It will not be shown again!</div>
                  </div>
                </div>
                <button
                  onClick={() => setRevealedKey(null)}
                  style={{ background: 'none', border: 'none', color: '#a7f3d0', cursor: 'pointer', fontSize: '0.82rem', padding: '4px 8px' }}
                >
                  ✕ Dismiss
                </button>
              </div>

              <div style={{
                display: 'flex',
                gap: '10px',
                alignItems: 'center',
                background: 'rgba(0,0,0,0.4)',
                padding: '10px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                <code style={{ flex: 1, fontFamily: 'Consolas, Monaco, monospace', color: '#34d399', fontSize: '0.95rem', wordBreak: 'break-all', fontWeight: '700' }}>
                  {revealedKey.rawKey}
                </code>
                <button
                  onClick={() => copyToClipboard(revealedKey.rawKey, 'revealed')}
                  className="btn btn-sm"
                  style={{
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    fontWeight: '700',
                    fontSize: '0.85rem'
                  }}
                >
                  {copiedKeyId === 'revealed' ? <Check size={16} /> : <Copy size={16} />}
                  {copiedKeyId === 'revealed' ? 'Copied!' : 'Copy Key'}
                </button>
              </div>
            </div>
          )}

          {/* Main API Keys Container */}
          <div className="card glass" style={{ padding: '28px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800', color: 'var(--text-main)' }}>Active API Keys</h3>
                <p className="text-muted" style={{ fontSize: '0.88rem', margin: '4px 0 0 0' }}>
                  API keys allow automated scripts, AI agents, and external servers to interact with your WhatsApp instances.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={loadKeys}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 16px', fontWeight: '600' }}
                  disabled={loadingKeys}
                >
                  <RefreshCw size={15} className={loadingKeys ? 'spin' : ''} />
                  Refresh
                </button>
                <button
                  onClick={() => setShowNewKeyModal(true)}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', fontWeight: '700', boxShadow: '0 4px 12px var(--primary-glow)' }}
                >
                  <Plus size={16} />
                  Create API Key
                </button>
              </div>
            </div>

            {/* Keys Table OR Rich Empty State */}
            {loadingKeys ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
                <RefreshCw size={28} className="spin" style={{ margin: '0 auto 12px auto', display: 'block', color: 'var(--primary)' }} />
                <span style={{ fontWeight: '600' }}>Loading API keys...</span>
              </div>
            ) : keys.length === 0 ? (
              /* PREMIUM EMPTY STATE */
              <div style={{
                borderRadius: '16px',
                padding: '48px 24px',
                background: 'radial-gradient(ellipse at 50% 0%, rgba(63, 103, 216, 0.09) 0%, rgba(0, 0, 0, 0) 70%)',
                border: '1px dashed var(--border-color)',
                textAlign: 'center',
                position: 'relative'
              }}>
                <div style={{
                  width: '68px',
                  height: '68px',
                  borderRadius: '20px',
                  background: 'var(--primary-subtle)',
                  border: '1px solid var(--primary-border)',
                  color: 'var(--primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 18px auto',
                  boxShadow: '0 8px 24px var(--primary-glow)'
                }}>
                  <Key size={32} />
                </div>

                <h3 style={{ margin: '0 0 8px 0', fontSize: '1.35rem', fontWeight: '800', color: 'var(--text-main)' }}>
                  No API Keys Created Yet
                </h3>
                <p className="text-muted" style={{ fontSize: '0.92rem', maxWidth: '520px', margin: '0 auto 24px auto', lineHeight: '1.5' }}>
                  Generate an API secret key to integrate your backend, CRM, chatbot engines (OpenAI/Claude), or automation workflows (n8n, Make).
                </p>

                <button
                  onClick={() => setShowNewKeyModal(true)}
                  className="btn btn-primary"
                  style={{
                    padding: '12px 28px',
                    fontSize: '0.95rem',
                    fontWeight: '700',
                    borderRadius: '10px',
                    boxShadow: '0 6px 20px var(--primary-glow)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  <Plus size={18} />
                  Generate First API Key
                </button>

                {/* 3 Step Quick Onboarding Cards */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '14px',
                  marginTop: '36px',
                  textAlign: 'left'
                }}>
                  <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '800' }}>1</span>
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>Create Scoped Key</strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Name your key and pick granular scopes like <code>messages:send</code> or <code>agent:hold</code>.
                    </p>
                  </div>

                  <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '800' }}>2</span>
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>Authorize Requests</strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Pass the token in <code>Authorization: Bearer &lt;key&gt;</code> or <code>X-API-Key</code> headers.
                    </p>
                  </div>

                  <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <span style={{ width: '22px', height: '22px', borderRadius: '50%', background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: '800' }}>3</span>
                      <strong style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>Automate & Scale</strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                      Send text, media, voice notes, and coordinate human agent takeover in real-time.
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              /* ACTIVE KEYS TABLE */
              <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '14px 18px', fontWeight: '700' }}>Name / Token</th>
                      <th style={{ padding: '14px 18px', fontWeight: '700' }}>Key Token Prefix</th>
                      <th style={{ padding: '14px 18px', fontWeight: '700' }}>Scopes / Permissions</th>
                      <th style={{ padding: '14px 18px', fontWeight: '700' }}>Last Used</th>
                      <th style={{ padding: '14px 18px', fontWeight: '700' }}>Created</th>
                      <th style={{ padding: '14px 18px', textAlign: 'right', fontWeight: '700' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id} style={{ borderBottom: '1px solid var(--border-color)', transition: 'background 0.2s' }}>
                        <td style={{ padding: '16px 18px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Key size={16} />
                            </div>
                            <div>
                              <strong style={{ color: 'var(--text-main)', fontSize: '0.92rem' }}>{k.name}</strong>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)' }}>ID: {k.id}</div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '16px 18px' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--bg-main)', padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                            <code style={{ color: 'var(--primary)', fontWeight: '700', fontSize: '0.85rem', fontFamily: 'Consolas, Monaco, monospace' }}>
                              {k.keyPrefix}
                            </code>
                            <button
                              onClick={() => copyToClipboard(k.keyPrefix, k.id)}
                              style={{ background: 'none', border: 'none', color: 'var(--text-dimmed)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                              title="Copy prefix"
                            >
                              {copiedKeyId === k.id ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '16px 18px' }}>
                          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                            {k.scopes.map((s) => {
                              const scopeMeta = availableScopes.find(as => as.id === s);
                              return (
                                <span
                                  key={s}
                                  style={{
                                    fontSize: '0.72rem',
                                    fontWeight: '600',
                                    padding: '3px 8px',
                                    borderRadius: '6px',
                                    background: scopeMeta ? `${scopeMeta.color}15` : 'var(--bg-main)',
                                    color: scopeMeta ? scopeMeta.color : 'var(--text-muted)',
                                    border: `1px solid ${scopeMeta ? `${scopeMeta.color}30` : 'var(--border-color)'}`
                                  }}
                                >
                                  {s}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td style={{ padding: '16px 18px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          {k.lastUsedAt ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <Clock size={14} className="text-muted" />
                              {new Date(k.lastUsedAt).toLocaleDateString()}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-dimmed)' }}>Never used</span>
                          )}
                        </td>
                        <td style={{ padding: '16px 18px', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          {new Date(k.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '16px 18px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleRevokeKey(k.id)}
                            className="btn btn-sm"
                            style={{
                              color: '#ef4444',
                              background: 'rgba(239, 68, 68, 0.08)',
                              border: '1px solid rgba(239, 68, 68, 0.25)',
                              padding: '6px 12px',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontWeight: '600',
                              fontSize: '0.78rem',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                            title="Revoke Key"
                          >
                            <Trash2 size={14} />
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Authentication Reference Card */}
          <div className="card glass" style={{ padding: '24px', borderRadius: '16px', border: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--primary-subtle)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Shield size={18} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: '800' }}>Authentication Headers Reference</h4>
                  <p className="text-muted" style={{ margin: '2px 0 0 0', fontSize: '0.82rem' }}>
                    Include your API key on every REST request to authenticate as your workspace.
                  </p>
                </div>
              </div>

              {/* Header Format Switcher */}
              <div style={{ display: 'flex', background: 'var(--bg-main)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                <button
                  onClick={() => setAuthHeaderFormat('bearer')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: authHeaderFormat === 'bearer' ? 'var(--primary)' : 'transparent',
                    color: authHeaderFormat === 'bearer' ? 'white' : 'var(--text-muted)',
                    fontSize: '0.78rem',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  Bearer Token
                </button>
                <button
                  onClick={() => setAuthHeaderFormat('xapikey')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    background: authHeaderFormat === 'xapikey' ? 'var(--primary)' : 'transparent',
                    color: authHeaderFormat === 'xapikey' ? 'white' : 'var(--text-muted)',
                    fontSize: '0.78rem',
                    fontWeight: '700',
                    cursor: 'pointer'
                  }}
                >
                  X-API-Key Header
                </button>
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <pre style={{
                margin: 0,
                padding: '16px 20px',
                borderRadius: '10px',
                background: '#0d1117',
                color: '#e6edf3',
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: '0.88rem',
                lineHeight: '1.6',
                overflowX: 'auto',
                border: '1px solid #30363d'
              }}>
                <code>
                  {authHeaderFormat === 'bearer'
                    ? `# HTTP Authorization Header Format\nAuthorization: Bearer ${sampleApiKey}\nContent-Type: application/json`
                    : `# Custom Header Format\nX-API-Key: ${sampleApiKey}\nContent-Type: application/json`}
                </code>
              </pre>

              <button
                onClick={() => copyToClipboard(authHeaderFormat === 'bearer' ? `Authorization: Bearer ${sampleApiKey}` : `X-API-Key: ${sampleApiKey}`, 'authHeader')}
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '6px',
                  padding: '6px 12px',
                  fontSize: '0.78rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  cursor: 'pointer',
                  fontWeight: '600'
                }}
              >
                {copiedKeyId === 'authHeader' ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
                {copiedKeyId === 'authHeader' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: REALTIME WEBHOOKS & LOGS */}
      {/* ========================================================================= */}
      {activeSubTab === 'webhook' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Webhook Configuration Card */}
          <div className="card glass" style={{ padding: '28px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800' }}>Webhook Endpoint & Subscriptions</h3>
                <p className="text-muted" style={{ fontSize: '0.88rem', margin: '4px 0 0 0' }}>
                  The server pushes real-time JSON payloads to your destination URL whenever events occur.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={handleTestWebhook}
                  className="btn btn-secondary"
                  disabled={testingWebhook || !webhookConfig.webhookUrl}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 16px', fontWeight: '600' }}
                >
                  <Send size={15} className={testingWebhook ? 'spin' : ''} />
                  {testingWebhook ? 'Pinging...' : 'Send Test Ping'}
                </button>
                <button
                  onClick={handleSaveWebhook}
                  className="btn btn-primary"
                  disabled={savingWebhook}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '9px 18px', fontWeight: '700', boxShadow: '0 4px 12px var(--primary-glow)' }}
                >
                  <Check size={16} />
                  {savingWebhook ? 'Saving...' : 'Save Configuration'}
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
                {/* Webhook URL Input */}
                <div className="form-group">
                  <label style={{ fontWeight: '700', fontSize: '0.88rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Globe size={15} className="text-primary" />
                    Webhook Destination URL
                  </label>
                  <input
                    type="url"
                    className="form-input"
                    placeholder="https://api.yourdomain.com/webhooks/whatsapp"
                    value={webhookConfig.webhookUrl}
                    onChange={(e) => setWebhookConfig({ ...webhookConfig, webhookUrl: e.target.value })}
                    style={{ width: '100%', fontFamily: 'Consolas, Monaco, monospace', fontSize: '0.88rem', padding: '10px 14px' }}
                    required
                  />
                  <small className="text-muted" style={{ marginTop: '5px', display: 'block', fontSize: '0.78rem' }}>
                    Must be an accessible HTTPS endpoint ready to accept JSON POST requests.
                  </small>
                </div>

                {/* Signing Secret */}
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <label style={{ fontWeight: '700', fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Lock size={15} className="text-primary" />
                      Signing Secret (HMAC-SHA256)
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateSecret}
                      style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '700' }}
                    >
                      ✨ Generate Secret
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="whsec_..."
                      value={webhookConfig.secret}
                      onChange={(e) => setWebhookConfig({ ...webhookConfig, secret: e.target.value })}
                      style={{ flex: 1, fontFamily: 'Consolas, Monaco, monospace', fontSize: '0.88rem', padding: '10px 14px' }}
                    />
                    {webhookConfig.secret && (
                      <button
                        type="button"
                        onClick={() => copyToClipboard(webhookConfig.secret, 'secret')}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '0 14px' }}
                      >
                        {copiedKeyId === 'secret' ? <Check size={15} style={{ color: '#10b981' }} /> : <Copy size={15} />}
                      </button>
                    )}
                  </div>
                  <small className="text-muted" style={{ marginTop: '5px', display: 'block', fontSize: '0.78rem' }}>
                    Signed via header <code>X-Webhook-Signature-256: sha256=&lt;hmac&gt;</code> to verify authenticity.
                  </small>
                </div>
              </div>

              {/* Event Subscriptions Matrix */}
              <div>
                <label style={{ fontWeight: '700', fontSize: '0.92rem', marginBottom: '10px', display: 'block' }}>
                  Subscribe to Realtime Events
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                  {availableEvents.map((evt) => {
                    const isChecked = webhookConfig.events.includes(evt.id);
                    return (
                      <label
                        key={evt.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '12px',
                          padding: '12px 16px',
                          borderRadius: '10px',
                          border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                          background: isChecked ? 'var(--primary-subtle)' : 'var(--card-bg)',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setWebhookConfig({ ...webhookConfig, events: [...webhookConfig.events, evt.id] });
                            } else {
                              setWebhookConfig({ ...webhookConfig, events: webhookConfig.events.filter(id => id !== evt.id) });
                            }
                          }}
                          style={{ marginTop: '3px', accentColor: 'var(--primary)', transform: 'scale(1.15)' }}
                        />
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '0.88rem', color: isChecked ? 'var(--primary)' : 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            {evt.title}
                          </div>
                          <code style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)', display: 'block', marginTop: '2px' }}>{evt.label}</code>
                          <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '4px', lineHeight: '1.3' }}>
                            {evt.desc}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </form>
          </div>

          {/* Test Result Inspector (if triggered) */}
          {testResult && (
            <div className="card glass" style={{
              padding: '20px 24px',
              borderRadius: '14px',
              borderLeft: testResult.success ? '5px solid #10b981' : '5px solid #ef4444',
              boxShadow: 'var(--shadow-card)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {testResult.success ? <CheckCircle2 size={22} style={{ color: '#10b981' }} /> : <XCircle size={22} style={{ color: '#ef4444' }} />}
                  <div>
                    <strong style={{ fontSize: '1.02rem', color: 'var(--text-main)' }}>
                      Webhook Ping: {testResult.status} ({testResult.responseStatus ? `HTTP ${testResult.responseStatus}` : 'Connection Failed'})
                    </strong>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Target: {testResult.sentPayload?.workspaceId || 'Endpoint'}</div>
                  </div>
                </div>
                <span style={{
                  padding: '4px 12px',
                  borderRadius: '20px',
                  background: 'var(--bg-main)',
                  border: '1px solid var(--border-color)',
                  fontWeight: '700',
                  fontSize: '0.82rem',
                  color: 'var(--text-main)'
                }}>
                  ⏱ {testResult.latencyMs}ms latency
                </span>
              </div>
              <div style={{ fontSize: '0.84rem', marginBottom: '10px' }}>
                <span className="text-muted" style={{ fontWeight: '600' }}>Server Response: </span>
                <code style={{ background: 'var(--bg-main)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                  {testResult.responseBody || '(empty response body)'}
                </code>
              </div>
              <details style={{ marginTop: '10px', fontSize: '0.82rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--primary)', fontWeight: '600' }}>View Dispatched Test Payload</summary>
                <pre style={{ marginTop: '8px', padding: '12px', background: '#0d1117', color: '#58a6ff', borderRadius: '8px', overflowX: 'auto', border: '1px solid #30363d' }}>
                  {JSON.stringify(testResult.sentPayload, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {/* Webhook Delivery Logs */}
          <div className="card glass" style={{ padding: '28px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800' }}>Recent Event Delivery Logs</h3>
                <p className="text-muted" style={{ fontSize: '0.88rem', margin: '4px 0 0 0' }}>
                  Inspect real-time event dispatch history, status codes, and latency.
                </p>
              </div>
              <button onClick={loadWebhookLogs} className="btn btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontWeight: '600', fontSize: '0.85rem' }}>
                <RefreshCw size={14} className={loadingLogs ? 'spin' : ''} />
                Refresh Logs
              </button>
            </div>

            {loadingLogs ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px auto', display: 'block', color: 'var(--primary)' }} />
                Loading logs...
              </div>
            ) : webhookLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '48px', border: '1px dashed var(--border-color)', borderRadius: '12px', color: 'var(--text-muted)' }}>
                <Radio size={32} style={{ color: 'var(--text-dimmed)', margin: '0 auto 10px auto', display: 'block' }} />
                <h4 style={{ margin: 0 }}>No Webhook Dispatches Yet</h4>
                <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '6px' }}>
                  Click "Send Test Ping" above to test your destination endpoint.
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 16px', fontWeight: '700' }}>Event</th>
                      <th style={{ padding: '12px 16px', fontWeight: '700' }}>Status</th>
                      <th style={{ padding: '12px 16px', fontWeight: '700' }}>HTTP Response</th>
                      <th style={{ padding: '12px 16px', fontWeight: '700' }}>Latency</th>
                      <th style={{ padding: '12px 16px', fontWeight: '700' }}>Timestamp</th>
                      <th style={{ padding: '12px 16px', textAlign: 'right', fontWeight: '700' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhookLogs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '14px 16px' }}>
                          <code style={{ color: 'var(--primary)', fontWeight: '700', fontSize: '0.85rem' }}>{log.eventType}</code>
                        </td>
                        <td style={{ padding: '14px 16px' }}>
                          <span style={{
                            fontSize: '0.74rem',
                            fontWeight: '700',
                            padding: '3px 8px',
                            borderRadius: '12px',
                            backgroundColor: log.status === 'SUCCESS' ? '#065f46' : '#991b1b',
                            color: 'white',
                          }}>
                            {log.status}
                          </span>
                        </td>
                        <td style={{ padding: '14px 16px', color: 'var(--text-main)', fontWeight: '600' }}>
                          {log.responseStatus ? `HTTP ${log.responseStatus}` : 'N/A'}
                        </td>
                        <td style={{ padding: '14px 16px', color: 'var(--text-muted)' }}>
                          {log.latencyMs}ms
                        </td>
                        <td style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.78rem', padding: '5px 10px', fontWeight: '600' }}
                          >
                            Inspect Payload
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: API PLAYGROUND */}
      {/* ========================================================================= */}
      {activeSubTab === 'playground' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 460px) 1fr', gap: '22px', alignItems: 'start' }}>
          {/* Left: Interactive Request Builder */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 18px 0', fontSize: '1.2rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={20} className="text-primary" />
              API Request Builder
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Endpoint Selector */}
              <div className="form-group">
                <label style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                  Target Endpoint
                </label>
                <select
                  className="form-input"
                  value={playgroundEndpoint}
                  onChange={(e) => setPlaygroundEndpoint(e.target.value)}
                  style={{ width: '100%', fontSize: '0.88rem', fontWeight: '600' }}
                >
                  <option value="send_text">POST /api/messages/send (Send Text Message)</option>
                  <option value="send_media">POST /api/messages/send (Send Media Image/PDF)</option>
                  <option value="hold_toggle">POST /api/chats/:chatJid/settings (Hold / Resume Bot)</option>
                  <option value="list_chats">GET /api/chats (Fetch Recent Chats)</option>
                  <option value="list_contacts">GET /api/contacts (Fetch CRM Contacts)</option>
                </select>
              </div>

              {/* Session ID */}
              <div className="form-group">
                <label style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                  Session ID
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={playgroundSessionId}
                  onChange={(e) => setPlaygroundSessionId(e.target.value)}
                  placeholder="default"
                  style={{ width: '100%', fontFamily: 'Consolas, Monaco, monospace', fontSize: '0.88rem' }}
                />
              </div>

              {/* Recipient / Chat JID */}
              {(playgroundEndpoint === 'send_text' || playgroundEndpoint === 'send_media' || playgroundEndpoint === 'hold_toggle') && (
                <div className="form-group">
                  <label style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                    Recipient Phone Number / WhatsApp JID
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 6281234567890"
                    value={playgroundTo}
                    onChange={(e) => setPlaygroundTo(e.target.value)}
                    style={{ width: '100%', fontFamily: 'Consolas, Monaco, monospace', fontSize: '0.88rem' }}
                  />
                </div>
              )}

              {/* Message Text */}
              {(playgroundEndpoint === 'send_text' || playgroundEndpoint === 'send_media') && (
                <div className="form-group">
                  <label style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                    {playgroundEndpoint === 'send_media' ? 'Media Caption' : 'Message Text'}
                  </label>
                  <textarea
                    className="form-input"
                    rows={3}
                    value={playgroundText}
                    onChange={(e) => setPlaygroundText(e.target.value)}
                    style={{ width: '100%', fontSize: '0.88rem', lineHeight: '1.4' }}
                  />
                </div>
              )}

              {/* Media URL */}
              {playgroundEndpoint === 'send_media' && (
                <div className="form-group">
                  <label style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                    Media Public URL (Image/PDF/Audio)
                  </label>
                  <input
                    type="url"
                    className="form-input"
                    value={playgroundMediaUrl}
                    onChange={(e) => setPlaygroundMediaUrl(e.target.value)}
                    style={{ width: '100%', fontFamily: 'Consolas, Monaco, monospace', fontSize: '0.85rem' }}
                  />
                </div>
              )}

              {/* Hold Settings */}
              {playgroundEndpoint === 'hold_toggle' && (
                <>
                  <div className="form-group">
                    <label style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                      Bot Status (Hold / Resume)
                    </label>
                    <select
                      className="form-input"
                      value={playgroundHoldPaused ? 'true' : 'false'}
                      onChange={(e) => setPlaygroundHoldPaused(e.target.value === 'true')}
                      style={{ width: '100%', fontWeight: '600' }}
                    >
                      <option value="true">Hold (Pause AI Bot replies for Human Takeover)</option>
                      <option value="false">Resume (Enable Bot automated replies)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label style={{ fontWeight: '700', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                      Operator Note
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      value={playgroundNote}
                      onChange={(e) => setPlaygroundNote(e.target.value)}
                      placeholder="Reason for hold..."
                      style={{ width: '100%' }}
                    />
                  </div>
                </>
              )}

              {/* Execute Button */}
              <button
                onClick={handleRunPlayground}
                className="btn btn-primary"
                disabled={runningPlayground}
                style={{
                  marginTop: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '13px',
                  fontWeight: '700',
                  fontSize: '0.92rem',
                  boxShadow: '0 4px 14px var(--primary-glow)'
                }}
              >
                <Play size={16} className={runningPlayground ? 'spin' : ''} />
                {runningPlayground ? 'Sending Request...' : 'Send Live Request'}
              </button>
            </div>
          </div>

          {/* Right: Response Console */}
          <div className="card glass" style={{ padding: '26px', borderRadius: '16px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', minHeight: '520px', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800' }}>Response Console</h3>
                {playgroundResponse && (
                  <span style={{
                    fontSize: '0.78rem',
                    fontWeight: '700',
                    padding: '3px 10px',
                    borderRadius: '8px',
                    backgroundColor: playgroundResponse.ok ? '#065f46' : '#991b1b',
                    color: 'white',
                  }}>
                    {playgroundResponse.status} {playgroundResponse.statusText}
                  </span>
                )}
              </div>
              {playgroundResponse && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-muted)' }}>
                    ⏱ {playgroundResponse.latency}ms
                  </span>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(playgroundResponse.data, null, 2), 'response')}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', padding: '5px 10px' }}
                  >
                    {copiedKeyId === 'response' ? <Check size={13} style={{ color: '#10b981' }} /> : <Copy size={13} />}
                    Copy JSON
                  </button>
                </div>
              )}
            </div>

            <div style={{
              flex: 1,
              background: '#0d1117',
              borderRadius: '12px',
              padding: '20px',
              fontFamily: 'Consolas, Monaco, monospace',
              fontSize: '0.88rem',
              overflowX: 'auto',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              minHeight: '380px'
            }}>
              {playgroundResponse ? (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: playgroundResponse.ok ? '#7ee787' : '#ff7b72' }}>
                  {JSON.stringify(playgroundResponse.data, null, 2)}
                </pre>
              ) : (
                <div style={{ color: '#8b949e', textAlign: 'center', padding: '80px 20px' }}>
                  <Terminal size={40} style={{ margin: '0 auto 14px auto', display: 'block', opacity: 0.4 }} />
                  <div style={{ fontWeight: '600', fontSize: '0.95rem' }}>Awaiting Request</div>
                  <p style={{ fontSize: '0.82rem', maxWidth: '340px', margin: '6px auto 0 auto' }}>
                    Select an endpoint, enter your recipient details on the left, and run live requests against your WhatsApp session.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: CODE SNIPPETS & SDKs */}
      {/* ========================================================================= */}
      {activeSubTab === 'sdks' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          <div className="card glass" style={{ padding: '28px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: '800' }}>Multi-Language Code Snippets</h3>
                <p className="text-muted" style={{ fontSize: '0.88rem', margin: '4px 0 0 0' }}>
                  Ready-to-copy code snippets pre-filled with your workspace API token and session ID.
                </p>
              </div>

              {/* Language Selector Tabs */}
              <div style={{ display: 'flex', gap: '5px', background: 'var(--bg-main)', padding: '4px', borderRadius: '10px', border: '1px solid var(--border-color)' }}>
                {[
                  { id: 'curl', label: 'cURL' },
                  { id: 'node', label: 'Node.js' },
                  { id: 'python', label: 'Python' },
                  { id: 'php', label: 'PHP' },
                  { id: 'go', label: 'Go' },
                ].map((lang) => (
                  <button
                    key={lang.id}
                    onClick={() => setSelectedSnippetLang(lang.id)}
                    style={{
                      padding: '7px 16px',
                      borderRadius: '8px',
                      border: 'none',
                      background: selectedSnippetLang === lang.id ? 'var(--primary)' : 'transparent',
                      color: selectedSnippetLang === lang.id ? 'white' : 'var(--text-muted)',
                      fontSize: '0.84rem',
                      fontWeight: '700',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Code Box */}
            <div style={{ position: 'relative' }}>
              <pre style={{
                margin: 0,
                padding: '24px',
                borderRadius: '12px',
                background: '#0d1117',
                color: '#e6edf3',
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: '0.9rem',
                lineHeight: '1.6',
                overflowX: 'auto',
                border: '1px solid #30363d'
              }}>
                <code>{getCodeSnippet(selectedSnippetLang)}</code>
              </pre>

              <button
                onClick={() => copyToClipboard(getCodeSnippet(selectedSnippetLang), 'snippet')}
                style={{
                  position: 'absolute',
                  top: '14px',
                  right: '14px',
                  backgroundColor: 'rgba(255, 255, 255, 0.12)',
                  color: 'white',
                  border: '1px solid rgba(255, 255, 255, 0.25)',
                  borderRadius: '8px',
                  padding: '7px 14px',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  cursor: 'pointer',
                  fontWeight: '700',
                  backdropFilter: 'blur(8px)'
                }}
              >
                {copiedSnippet ? <Check size={15} style={{ color: '#10b981' }} /> : <Copy size={15} />}
                {copiedSnippet ? 'Copied' : 'Copy Code'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: AI BOT & WORKFLOWS GUIDE */}
      {/* ========================================================================= */}
      {activeSubTab === 'bot_handoff' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          {/* Architecture Concept Card */}
          <div className="card glass" style={{ padding: '28px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '1.25rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bot size={24} className="text-primary" />
              AI Chatbot & Human Agent Takeover Workflow
            </h3>
            <p style={{ fontSize: '0.92rem', lineHeight: '1.6', color: 'var(--text-muted)' }}>
              When building AI Chatbots (OpenAI GPT-4, Claude 3.5, LangChain, Flowise, n8n), a seamless handoff between AI automation and human customer support agents is critical.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '24px' }}>
              <div style={{ padding: '18px', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <span style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: '800' }}>1</span>
                  <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>Incoming Webhook</strong>
                </div>
                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Customer sends a message. The platform dispatches <code>message.received</code> to your webhook URL with the customer's text or media.
                </p>
              </div>

              <div style={{ padding: '18px', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <span style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: '800' }}>2</span>
                  <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>AI Bot Reply</strong>
                </div>
                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  Your AI server processes the prompt and sends a response via <code>POST /api/messages/send</code> with header <code>X-Agent-Source: bot</code>.
                </p>
              </div>

              <div style={{ padding: '18px', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <span style={{ width: '26px', height: '26px', borderRadius: '50%', background: '#f59e0b', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: '800' }}>3</span>
                  <strong style={{ fontSize: '0.95rem', color: 'var(--text-main)' }}>Human Agent Hold</strong>
                </div>
                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                  If a human operator clicks "Hold" or customer asks for a person, bot replies are automatically blocked and an <code>agent.hold</code> event is fired.
                </p>
              </div>
            </div>
          </div>

          {/* Third-Party Integrations */}
          <div className="card glass" style={{ padding: '28px', borderRadius: '16px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-card)' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.25rem', fontWeight: '800' }}>Connecting with Automation Platforms</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '18px' }}>
              <div style={{ padding: '20px', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                <h4 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                  <Layers size={20} style={{ color: '#ea580c' }} />
                  n8n & Make.com
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.5', margin: '0 0 12px 0' }}>
                  1. Create a <strong>Webhook Trigger node</strong> in n8n and paste the Webhook URL into the Webhooks tab.
                  <br />2. Add an <strong>HTTP Request node</strong> with method <code>POST</code> and URL <code>{baseUrl}/api/messages/send</code>.
                  <br />3. Add header <code>Authorization: Bearer &lt;API_KEY&gt;</code>.
                </p>
              </div>

              <div style={{ padding: '20px', borderRadius: '12px', background: 'var(--card-bg)', border: '1px solid var(--border-color)' }}>
                <h4 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                  <Sparkles size={20} style={{ color: '#8b5cf6' }} />
                  Flowise AI & LangChain
                </h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: '1.5', margin: '0 0 12px 0' }}>
                  1. Route incoming message webhooks to your Flowise prediction endpoint.
                  <br />2. In Flowise custom tool, call Send Message API with your API Key.
                  <br />3. Pass <code>"source": "bot"</code> in the body to respect human agent hold states.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: CREATE API KEY */}
      {/* ========================================================================= */}
      {showNewKeyModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(6px)',
          padding: '20px'
        }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '520px', padding: '28px', borderRadius: '16px', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.25rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Key size={22} className="text-primary" />
              Create New API Key
            </h3>
            <p className="text-muted" style={{ fontSize: '0.86rem', margin: '0 0 20px 0' }}>
              Generate a unique secret token and configure granular access scopes.
            </p>

            <form onSubmit={handleCreateKey} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div className="form-group">
                <label style={{ fontWeight: '700', fontSize: '0.88rem', marginBottom: '6px', display: 'block' }}>
                  Key Name / Description
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Production CRM, AI Bot Engine"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  style={{ width: '100%', padding: '10px 14px' }}
                  required
                />
              </div>

              <div>
                <label style={{ fontWeight: '700', fontSize: '0.88rem', marginBottom: '10px', display: 'block' }}>
                  Key Permissions / Scopes
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {availableScopes.map((scope) => {
                    const isChecked = newKeyScopes.includes(scope.id);
                    return (
                      <label
                        key={scope.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          background: isChecked ? 'var(--primary-subtle)' : 'var(--bg-main)',
                          border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                          cursor: 'pointer'
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewKeyScopes([...newKeyScopes, scope.id]);
                            } else {
                              setNewKeyScopes(newKeyScopes.filter(s => s !== scope.id));
                            }
                          }}
                          style={{ accentColor: 'var(--primary)' }}
                        />
                        <div>
                          <div style={{ fontWeight: '700', fontSize: '0.85rem', color: isChecked ? 'var(--primary)' : 'var(--text-main)' }}>{scope.title}</div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{scope.desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewKeyModal(false)}
                  className="btn btn-secondary"
                  disabled={creatingKey}
                  style={{ padding: '9px 18px', fontWeight: '600' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingKey || !newKeyName.trim()}
                  style={{ padding: '9px 22px', fontWeight: '700', boxShadow: '0 4px 12px var(--primary-glow)' }}
                >
                  {creatingKey ? 'Creating...' : 'Create API Key'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: INSPECT WEBHOOK LOG */}
      {/* ========================================================================= */}
      {selectedLog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(6px)',
          padding: '20px'
        }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '680px', padding: '28px', borderRadius: '16px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '800' }}>Webhook Delivery Inspector</h3>
              <button onClick={() => setSelectedLog(null)} className="btn btn-secondary btn-sm" style={{ padding: '6px 12px' }}>✕ Close</button>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', fontSize: '0.84rem' }}>
              <span className="badge badge-success" style={{ fontWeight: '700' }}>{selectedLog.eventType}</span>
              <span style={{ fontWeight: '600', color: 'var(--text-main)' }}>HTTP {selectedLog.responseStatus || 'N/A'}</span>
              <span style={{ color: 'var(--text-muted)' }}>⏱ {selectedLog.latencyMs}ms latency</span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-muted)' }}>Destination Target URL</label>
                <div style={{ fontFamily: 'Consolas, Monaco, monospace', fontSize: '0.85rem', padding: '8px 12px', background: 'var(--bg-main)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  {selectedLog.url}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-muted)' }}>Dispatched JSON Payload</label>
                <pre style={{ margin: 0, padding: '14px', background: '#0d1117', color: '#58a6ff', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', border: '1px solid #30363d' }}>
                  {JSON.stringify(selectedLog.payload, null, 2)}
                </pre>
              </div>

              <div>
                <label style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-muted)' }}>Response Body Returned</label>
                <pre style={{ margin: 0, padding: '14px', background: '#0d1117', color: '#c9d1d9', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', border: '1px solid #30363d' }}>
                  {selectedLog.responseBody || '(empty body)'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
