import React, { useState, useEffect } from 'react';
import {
  Key, Webhook, Play, FileCode, Bot, Copy, Check, Plus, Trash2, RefreshCw,
  Send, Shield, CheckCircle2, XCircle, Clock, AlertTriangle, ExternalLink,
  Code2, Eye, EyeOff, Layers, Radio, Sparkles, Terminal, Activity, ArrowRight
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
  const [newKeyScopes, setNewKeyScopes] = useState(['messages:send', 'messages:read', 'contacts:sync', 'sessions:read', 'agent:hold']);
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

  const availableScopes = [
    { id: 'messages:send', label: 'Send Messages', desc: 'Send text, media, documents, and templates' },
    { id: 'messages:read', label: 'Read Messages & History', desc: 'Fetch conversation logs and message history' },
    { id: 'contacts:sync', label: 'Contacts Sync', desc: 'Read and update saved CRM contacts' },
    { id: 'sessions:read', label: 'Sessions & QR', desc: 'Check device connection state and QR codes' },
    { id: 'agent:hold', label: 'AI Bot Hold / Resume', desc: 'Pause and resume automated replies for chats' },
  ];

  const availableEvents = [
    { id: 'message.received', label: 'message.received', desc: 'Incoming customer messages (text, media, location, buttons)' },
    { id: 'message.sent', label: 'message.sent', desc: 'Outbound messages dispatched by human agents or API' },
    { id: 'message.status', label: 'message.status', desc: 'Delivery receipts, double-ticks, and read receipts' },
    { id: 'session.status', label: 'session.status', desc: 'Connection updates (QR ready, connected, disconnected)' },
    { id: 'agent.hold', label: 'agent.hold', desc: 'Fired when a human agent takes over and pauses bot replies' },
    { id: 'agent.resume', label: 'agent.resume', desc: 'Fired when bot auto-reply is resumed for a conversation' },
  ];

  // Base API URL
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5000';

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
            events: Array.isArray(data.events) && data.events.length > 0 ? data.events : ['message.received', 'message.status', 'session.status', 'agent.hold', 'agent.resume'],
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
    <div className="view-container" style={{ paddingBottom: '60px' }}>
      {/* Top Header */}
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Code2 className="text-primary" size={26} />
              API & Webhook Integration
            </h2>
            <span className="badge" style={{ backgroundColor: 'var(--primary-subtle)', color: 'var(--primary)', fontWeight: '600', fontSize: '0.75rem' }}>
              Developer Portal
            </span>
          </div>
          <p className="text-muted" style={{ marginTop: '4px', maxWidth: '680px' }}>
            Connect external CRMs, dispatch real-time webhooks, orchestrate AI Chatbots with human-agent takeover, and test live API endpoints.
          </p>
        </div>

        {/* Quick Info Badges */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ padding: '8px 14px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
            <span className="text-muted">Base URL: </span>
            <code style={{ color: 'var(--primary)', fontWeight: '600' }}>{baseUrl}</code>
          </div>
          <div style={{ padding: '8px 14px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', fontSize: '0.8rem' }}>
            <span className="text-muted">Session: </span>
            <strong style={{ color: 'var(--text-main)' }}>{activeSessionId}</strong>
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '2px', marginBottom: '24px', overflowX: 'auto' }}>
        <button
          onClick={() => setActiveSubTab('keys')}
          className={`btn-tab ${activeSubTab === 'keys' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            borderRadius: '8px 8px 0 0',
            border: 'none',
            background: activeSubTab === 'keys' ? 'var(--primary-subtle)' : 'transparent',
            color: activeSubTab === 'keys' ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: activeSubTab === 'keys' ? '700' : '500',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: activeSubTab === 'keys' ? '2px solid var(--primary)' : '2px solid transparent',
          }}
        >
          <Key size={16} />
          API Keys & Auth
        </button>

        <button
          onClick={() => setActiveSubTab('webhook')}
          className={`btn-tab ${activeSubTab === 'webhook' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            borderRadius: '8px 8px 0 0',
            border: 'none',
            background: activeSubTab === 'webhook' ? 'var(--primary-subtle)' : 'transparent',
            color: activeSubTab === 'webhook' ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: activeSubTab === 'webhook' ? '700' : '500',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: activeSubTab === 'webhook' ? '2px solid var(--primary)' : '2px solid transparent',
          }}
        >
          <Webhook size={16} />
          Realtime Webhooks
        </button>

        <button
          onClick={() => setActiveSubTab('playground')}
          className={`btn-tab ${activeSubTab === 'playground' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            borderRadius: '8px 8px 0 0',
            border: 'none',
            background: activeSubTab === 'playground' ? 'var(--primary-subtle)' : 'transparent',
            color: activeSubTab === 'playground' ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: activeSubTab === 'playground' ? '700' : '500',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: activeSubTab === 'playground' ? '2px solid var(--primary)' : '2px solid transparent',
          }}
        >
          <Play size={16} />
          API Playground
        </button>

        <button
          onClick={() => setActiveSubTab('sdks')}
          className={`btn-tab ${activeSubTab === 'sdks' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            borderRadius: '8px 8px 0 0',
            border: 'none',
            background: activeSubTab === 'sdks' ? 'var(--primary-subtle)' : 'transparent',
            color: activeSubTab === 'sdks' ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: activeSubTab === 'sdks' ? '700' : '500',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: activeSubTab === 'sdks' ? '2px solid var(--primary)' : '2px solid transparent',
          }}
        >
          <FileCode size={16} />
          Code Snippets
        </button>

        <button
          onClick={() => setActiveSubTab('bot_handoff')}
          className={`btn-tab ${activeSubTab === 'bot_handoff' ? 'active' : ''}`}
          style={{
            padding: '10px 18px',
            borderRadius: '8px 8px 0 0',
            border: 'none',
            background: activeSubTab === 'bot_handoff' ? 'var(--primary-subtle)' : 'transparent',
            color: activeSubTab === 'bot_handoff' ? 'var(--primary)' : 'var(--text-muted)',
            fontWeight: activeSubTab === 'bot_handoff' ? '700' : '500',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            borderBottom: activeSubTab === 'bot_handoff' ? '2px solid var(--primary)' : '2px solid transparent',
          }}
        >
          <Bot size={16} />
          AI Bot & Workflow Guide
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: API KEYS & AUTH */}
      {/* ========================================================================= */}
      {activeSubTab === 'keys' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Newly Created Key Alert (One-time Reveal) */}
          {revealedKey && (
            <div style={{
              padding: '16px 20px',
              borderRadius: '10px',
              backgroundColor: '#064e3b',
              border: '1px solid #059669',
              color: '#d1fae5',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={18} style={{ color: '#34d399' }} />
                  <strong style={{ fontSize: '0.95rem' }}>New API Key Created: {revealedKey.name}</strong>
                </div>
                <button
                  onClick={() => setRevealedKey(null)}
                  style={{ background: 'none', border: 'none', color: '#a7f3d0', cursor: 'pointer', fontSize: '0.8rem' }}
                >
                  Dismiss
                </button>
              </div>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#a7f3d0' }}>
                Please copy your API key now. For your security, you will not be able to view the full secret key again.
              </p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'rgba(0,0,0,0.3)', padding: '8px 12px', borderRadius: '6px' }}>
                <code style={{ flex: 1, fontFamily: 'monospace', color: '#6ee7b7', fontSize: '0.9rem', wordBreak: 'break-all' }}>
                  {revealedKey.rawKey}
                </code>
                <button
                  onClick={() => copyToClipboard(revealedKey.rawKey, 'revealed')}
                  className="btn btn-sm"
                  style={{ backgroundColor: '#10b981', color: 'white', border: 'none', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px' }}
                >
                  {copiedKeyId === 'revealed' ? <Check size={14} /> : <Copy size={14} />}
                  Copy
                </button>
              </div>
            </div>
          )}

          {/* Top Actions & Keys List */}
          <div className="card glass" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Active API Keys</h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Authenticate server-to-server requests using Bearer tokens or <code>X-API-Key</code> headers.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={loadKeys}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  disabled={loadingKeys}
                >
                  <RefreshCw size={15} className={loadingKeys ? 'spin' : ''} />
                  Refresh
                </button>
                <button
                  onClick={() => setShowNewKeyModal(true)}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Plus size={16} />
                  Create API Key
                </button>
              </div>
            </div>

            {/* Keys Table */}
            {loadingKeys ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 10px auto', display: 'block' }} />
                Loading API keys...
              </div>
            ) : keys.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                <Key size={36} style={{ color: 'var(--text-dimmed)', margin: '0 auto 12px auto', display: 'block' }} />
                <h4 style={{ margin: 0 }}>No API Keys Created Yet</h4>
                <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: '6px', maxWidth: '400px', margin: '6px auto 16px auto' }}>
                  Generate an API key to allow your backend, chatbot engine, or CRM to send WhatsApp messages automatically.
                </p>
                <button onClick={() => setShowNewKeyModal(true)} className="btn btn-primary">
                  <Plus size={16} style={{ marginRight: '6px' }} />
                  Generate First API Key
                </button>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '12px 14px' }}>Name / Label</th>
                      <th style={{ padding: '12px 14px' }}>Key Token</th>
                      <th style={{ padding: '12px 14px' }}>Scopes</th>
                      <th style={{ padding: '12px 14px' }}>Last Used</th>
                      <th style={{ padding: '12px 14px' }}>Created</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '14px' }}>
                          <strong style={{ color: 'var(--text-main)' }}>{k.name}</strong>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-dimmed)' }}>ID: {k.id}</div>
                        </td>
                        <td style={{ padding: '14px' }}>
                          <code style={{ background: 'var(--bg-main)', padding: '4px 8px', borderRadius: '4px', color: 'var(--primary)' }}>
                            {k.keyPrefix}
                          </code>
                        </td>
                        <td style={{ padding: '14px' }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {k.scopes.slice(0, 3).map((s) => (
                              <span key={s} style={{ fontSize: '0.72rem', background: 'var(--bg-main)', border: '1px solid var(--border-color)', padding: '2px 6px', borderRadius: '4px', color: 'var(--text-muted)' }}>
                                {s}
                              </span>
                            ))}
                            {k.scopes.length > 3 && (
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-dimmed)' }}>
                                +{k.scopes.length - 3} more
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '14px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : 'Never'}
                        </td>
                        <td style={{ padding: '14px', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                          {new Date(k.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: '14px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleRevokeKey(k.id)}
                            className="btn btn-sm"
                            style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                            title="Revoke Key"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quick Authentication Card */}
          <div className="card glass" style={{ padding: '20px' }}>
            <h4 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Shield size={18} className="text-primary" />
              How to Authenticate API Requests
            </h4>
            <p className="text-muted" style={{ fontSize: '0.85rem', margin: '0 0 14px 0' }}>
              Pass your API key in the HTTP request header using standard Bearer authorization:
            </p>
            <pre style={{ margin: 0, padding: '12px 16px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)', overflowX: 'auto', fontSize: '0.84rem' }}>
              <code>{`Authorization: Bearer ${sampleApiKey}\n# Or via custom header:\nX-API-Key: ${sampleApiKey}`}</code>
            </pre>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: REALTIME WEBHOOKS & LOGS */}
      {/* ========================================================================= */}
      {activeSubTab === 'webhook' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Webhook Settings Card */}
          <div className="card glass" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Webhook Configuration</h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Receive live HTTP POST payloads whenever new WhatsApp messages arrive or statuses update.
                </p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={handleTestWebhook}
                  className="btn btn-secondary"
                  disabled={testingWebhook || !webhookConfig.webhookUrl}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Send size={14} className={testingWebhook ? 'spin' : ''} />
                  {testingWebhook ? 'Testing...' : 'Send Test Ping'}
                </button>
                <button
                  onClick={handleSaveWebhook}
                  className="btn btn-primary"
                  disabled={savingWebhook}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <Check size={16} />
                  {savingWebhook ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>

            <form onSubmit={handleSaveWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {/* Webhook URL Input */}
              <div className="form-group">
                <label style={{ fontWeight: '600', fontSize: '0.88rem', marginBottom: '6px', display: 'block' }}>
                  Webhook Destination URL
                </label>
                <input
                  type="url"
                  className="form-input"
                  placeholder="https://your-domain.com/api/whatsapp-webhook"
                  value={webhookConfig.webhookUrl}
                  onChange={(e) => setWebhookConfig({ ...webhookConfig, webhookUrl: e.target.value })}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.9rem' }}
                  required
                />
                <small className="text-muted" style={{ marginTop: '4px', display: 'block' }}>
                  Must be an accessible HTTPS endpoint ready to accept JSON POST requests.
                </small>
              </div>

              {/* Signing Secret */}
              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ fontWeight: '600', fontSize: '0.88rem' }}>
                    Webhook Signing Secret (HMAC-SHA256)
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateSecret}
                    style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                  >
                    Generate Secret
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="whsec_..."
                    value={webhookConfig.secret}
                    onChange={(e) => setWebhookConfig({ ...webhookConfig, secret: e.target.value })}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.9rem' }}
                  />
                  {webhookConfig.secret && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(webhookConfig.secret, 'secret')}
                      className="btn btn-secondary"
                      style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                      {copiedKeyId === 'secret' ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  )}
                </div>
                <small className="text-muted" style={{ marginTop: '4px', display: 'block' }}>
                  Used to sign outgoing payloads via header <code>X-Webhook-Signature-256: sha256=&lt;hmac&gt;</code> to verify authenticity.
                </small>
              </div>

              {/* Event Subscriptions Checklist */}
              <div>
                <label style={{ fontWeight: '600', fontSize: '0.88rem', marginBottom: '8px', display: 'block' }}>
                  Subscribed Events
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                  {availableEvents.map((evt) => {
                    const isChecked = webhookConfig.events.includes(evt.id);
                    return (
                      <label
                        key={evt.id}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '10px',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          border: isChecked ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                          background: isChecked ? 'var(--primary-subtle)' : 'var(--bg-main)',
                          cursor: 'pointer'
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
                          style={{ marginTop: '3px' }}
                        />
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '0.85rem', color: isChecked ? 'var(--primary)' : 'var(--text-main)' }}>
                            {evt.label}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
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

          {/* Test Result Inspector (if executed) */}
          {testResult && (
            <div className="card glass" style={{
              padding: '18px 22px',
              borderLeft: testResult.success ? '4px solid #10b981' : '4px solid #ef4444'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {testResult.success ? <CheckCircle2 size={20} style={{ color: '#10b981' }} /> : <XCircle size={20} style={{ color: '#ef4444' }} />}
                  <strong style={{ fontSize: '1rem' }}>
                    Webhook Test: {testResult.status} ({testResult.responseStatus ? `HTTP ${testResult.responseStatus}` : 'Network Failure'})
                  </strong>
                </div>
                <span className="badge" style={{ backgroundColor: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                  Latency: {testResult.latencyMs}ms
                </span>
              </div>
              <div style={{ fontSize: '0.82rem', marginBottom: '8px' }}>
                <span className="text-muted">Response Body: </span>
                <code style={{ background: 'var(--bg-main)', padding: '2px 6px', borderRadius: '4px' }}>
                  {testResult.responseBody || '(empty body)'}
                </code>
              </div>
              <details style={{ marginTop: '8px', fontSize: '0.82rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--primary)' }}>View Sent Test Payload</summary>
                <pre style={{ marginTop: '8px', padding: '10px', background: 'var(--bg-main)', borderRadius: '6px', overflowX: 'auto' }}>
                  {JSON.stringify(testResult.sentPayload, null, 2)}
                </pre>
              </details>
            </div>
          )}

          {/* Webhook Delivery Logs */}
          <div className="card glass" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Recent Webhook Delivery Logs</h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Inspect real-time event dispatch history, status codes, and latency.
                </p>
              </div>
              <button onClick={loadWebhookLogs} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <RefreshCw size={14} className={loadingLogs ? 'spin' : ''} />
                Refresh Logs
              </button>
            </div>

            {loadingLogs ? (
              <div style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                <RefreshCw size={20} className="spin" style={{ margin: '0 auto 8px auto', display: 'block' }} />
                Loading logs...
              </div>
            ) : webhookLogs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '36px', border: '1px dashed var(--border-color)', borderRadius: '8px', color: 'var(--text-muted)' }}>
                <Radio size={28} style={{ color: 'var(--text-dimmed)', margin: '0 auto 8px auto', display: 'block' }} />
                No webhook events dispatched yet. Click "Send Test Ping" to test your endpoint.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left', color: 'var(--text-muted)' }}>
                      <th style={{ padding: '10px 12px' }}>Event</th>
                      <th style={{ padding: '10px 12px' }}>Status</th>
                      <th style={{ padding: '10px 12px' }}>HTTP Code</th>
                      <th style={{ padding: '10px 12px' }}>Latency</th>
                      <th style={{ padding: '10px 12px' }}>Timestamp</th>
                      <th style={{ padding: '10px 12px', textAlign: 'right' }}>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhookLogs.map((log) => (
                      <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                        <td style={{ padding: '12px' }}>
                          <code style={{ color: 'var(--primary)', fontWeight: '600' }}>{log.eventType}</code>
                        </td>
                        <td style={{ padding: '12px' }}>
                          <span className={`badge ${log.status === 'SUCCESS' ? 'badge-success' : 'badge-danger'}`} style={{
                            fontSize: '0.72rem',
                            padding: '2px 8px',
                            borderRadius: '12px',
                            backgroundColor: log.status === 'SUCCESS' ? '#065f46' : '#991b1b',
                            color: 'white',
                          }}>
                            {log.status}
                          </span>
                        </td>
                        <td style={{ padding: '12px', color: 'var(--text-muted)' }}>
                          {log.responseStatus ? `HTTP ${log.responseStatus}` : 'N/A'}
                        </td>
                        <td style={{ padding: '12px', color: 'var(--text-muted)' }}>
                          {log.latencyMs}ms
                        </td>
                        <td style={{ padding: '12px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'right' }}>
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="btn btn-secondary btn-sm"
                            style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                          >
                            Inspect
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
      {/* TAB 3: LIVE API PLAYGROUND */}
      {/* ========================================================================= */}
      {activeSubTab === 'playground' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 440px) 1fr', gap: '20px', alignItems: 'start' }}>
          {/* Left: Request Form */}
          <div className="card glass" style={{ padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Terminal size={18} className="text-primary" />
              API Request Builder
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Endpoint Selector */}
              <div className="form-group">
                <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                  Target Endpoint
                </label>
                <select
                  className="form-input"
                  value={playgroundEndpoint}
                  onChange={(e) => setPlaygroundEndpoint(e.target.value)}
                  style={{ width: '100%', fontSize: '0.88rem' }}
                >
                  <option value="send_text">POST /api/messages/send (Send Text Message)</option>
                  <option value="send_media">POST /api/messages/send (Send Media File)</option>
                  <option value="hold_toggle">POST /api/chats/:chatJid/settings (Hold / Resume Bot)</option>
                  <option value="list_chats">GET /api/chats (Fetch Recent Chats)</option>
                  <option value="list_contacts">GET /api/contacts (Fetch CRM Contacts)</option>
                </select>
              </div>

              {/* Session ID */}
              <div className="form-group">
                <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                  Session ID
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={playgroundSessionId}
                  onChange={(e) => setPlaygroundSessionId(e.target.value)}
                  placeholder="default"
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.88rem' }}
                />
              </div>

              {/* Recipient / Chat JID */}
              {(playgroundEndpoint === 'send_text' || playgroundEndpoint === 'send_media' || playgroundEndpoint === 'hold_toggle') && (
                <div className="form-group">
                  <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                    Recipient Phone / Chat JID
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. 6281234567890 or 6281234567890@s.whatsapp.net"
                    value={playgroundTo}
                    onChange={(e) => setPlaygroundTo(e.target.value)}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.88rem' }}
                  />
                </div>
              )}

              {/* Message Text */}
              {(playgroundEndpoint === 'send_text' || playgroundEndpoint === 'send_media') && (
                <div className="form-group">
                  <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                    {playgroundEndpoint === 'send_media' ? 'Media Caption' : 'Message Text'}
                  </label>
                  <textarea
                    className="form-input"
                    rows={3}
                    value={playgroundText}
                    onChange={(e) => setPlaygroundText(e.target.value)}
                    style={{ width: '100%', fontSize: '0.88rem' }}
                  />
                </div>
              )}

              {/* Media URL */}
              {playgroundEndpoint === 'send_media' && (
                <div className="form-group">
                  <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                    Media Public URL (Image/PDF/Audio)
                  </label>
                  <input
                    type="url"
                    className="form-input"
                    value={playgroundMediaUrl}
                    onChange={(e) => setPlaygroundMediaUrl(e.target.value)}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '0.85rem' }}
                  />
                </div>
              )}

              {/* Hold Settings */}
              {playgroundEndpoint === 'hold_toggle' && (
                <>
                  <div className="form-group">
                    <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                      Bot Status (Hold / Resume)
                    </label>
                    <select
                      className="form-input"
                      value={playgroundHoldPaused ? 'true' : 'false'}
                      onChange={(e) => setPlaygroundHoldPaused(e.target.value === 'true')}
                      style={{ width: '100%' }}
                    >
                      <option value="true">Hold (Pause AI Bot replies for Human Takeover)</option>
                      <option value="false">Resume (Enable Bot automated replies)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
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
                style={{ marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}
              >
                <Play size={16} className={runningPlayground ? 'spin' : ''} />
                {runningPlayground ? 'Sending Request...' : 'Send Live Request'}
              </button>
            </div>
          </div>

          {/* Right: Response Console */}
          <div className="card glass" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: '480px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Response Console</h3>
                {playgroundResponse && (
                  <span className={`badge ${playgroundResponse.ok ? 'badge-success' : 'badge-danger'}`} style={{
                    fontSize: '0.78rem',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    backgroundColor: playgroundResponse.ok ? '#065f46' : '#991b1b',
                    color: 'white',
                  }}>
                    {playgroundResponse.status} {playgroundResponse.statusText}
                  </span>
                )}
              </div>
              {playgroundResponse && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="text-muted" style={{ fontSize: '0.8rem' }}>
                    ⏱ {playgroundResponse.latency}ms
                  </span>
                  <button
                    onClick={() => copyToClipboard(JSON.stringify(playgroundResponse.data, null, 2), 'response')}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem' }}
                  >
                    {copiedKeyId === 'response' ? <Check size={13} /> : <Copy size={13} />}
                    Copy JSON
                  </button>
                </div>
              )}
            </div>

            <div style={{
              flex: 1,
              background: '#0d1117',
              borderRadius: '8px',
              padding: '16px',
              fontFamily: 'monospace',
              fontSize: '0.85rem',
              overflowX: 'auto',
              border: '1px solid #30363d',
              color: '#c9d1d9',
              minHeight: '340px'
            }}>
              {playgroundResponse ? (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {JSON.stringify(playgroundResponse.data, null, 2)}
                </pre>
              ) : (
                <div style={{ color: '#8b949e', textAlign: 'center', padding: '60px 20px' }}>
                  <Terminal size={32} style={{ margin: '0 auto 12px auto', display: 'block', opacity: 0.5 }} />
                  Configure parameters on the left and click "Send Live Request" to execute against your connected WhatsApp device.
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="card glass" style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Multi-Language Code Snippets</h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Copy-paste working examples with your active API key and endpoint configuration.
                </p>
              </div>

              {/* Language Selector Tabs */}
              <div style={{ display: 'flex', gap: '6px', background: 'var(--bg-main)', padding: '4px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
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
                      padding: '6px 14px',
                      borderRadius: '6px',
                      border: 'none',
                      background: selectedSnippetLang === lang.id ? 'var(--primary)' : 'transparent',
                      color: selectedSnippetLang === lang.id ? 'white' : 'var(--text-muted)',
                      fontSize: '0.82rem',
                      fontWeight: '600',
                      cursor: 'pointer'
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
                padding: '20px',
                borderRadius: '8px',
                background: '#0d1117',
                color: '#e6edf3',
                fontFamily: 'Consolas, Monaco, monospace',
                fontSize: '0.88rem',
                lineHeight: '1.5',
                overflowX: 'auto',
                border: '1px solid #30363d'
              }}>
                <code>{getCodeSnippet(selectedSnippetLang)}</code>
              </pre>

              <button
                onClick={() => copyToClipboard(getCodeSnippet(selectedSnippetLang), 'snippet')}
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
                  gap: '6px',
                  cursor: 'pointer',
                  backdropFilter: 'blur(4px)'
                }}
              >
                {copiedSnippet ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Architecture Concept Card */}
          <div className="card glass" style={{ padding: '24px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Bot size={22} className="text-primary" />
              AI Bot & Human Agent Takeover Workflow
            </h3>
            <p style={{ fontSize: '0.9rem', lineHeight: '1.5', color: 'var(--text-muted)' }}>
              When building AI Chatbots (OpenAI, Claude, LangChain, Flowise, n8n), a seamless handoff between AI automation and human customer support agents is critical.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginTop: '20px' }}>
              <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: '700' }}>1</span>
                  <strong style={{ fontSize: '0.95rem' }}>Incoming Message Webhook</strong>
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Customer sends a message. The platform dispatches <code>message.received</code> to your webhook URL with the customer's text or media.
                </p>
              </div>

              <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: '700' }}>2</span>
                  <strong style={{ fontSize: '0.95rem' }}>AI Bot Generates Reply</strong>
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  Your AI server processes the prompt and sends a response via <code>POST /api/messages/send</code> with header <code>X-Agent-Source: bot</code>.
                </p>
              </div>

              <div style={{ padding: '16px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <span style={{ width: '24px', height: '24px', borderRadius: '50%', background: '#f59e0b', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: '700' }}>3</span>
                  <strong style={{ fontSize: '0.95rem' }}>Human Agent Hold (Takeover)</strong>
                </div>
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  If a human operator intervenes or customer asks for a person, clicking "Hold" automatically blocks bot replies and fires an <code>agent.hold</code> event.
                </p>
              </div>
            </div>
          </div>

          {/* Third-Party Integrations */}
          <div className="card glass" style={{ padding: '24px' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '1.15rem' }}>Connecting with No-Code & Automation Tools</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
              <div style={{ padding: '18px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                <h4 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Layers size={18} style={{ color: '#ea580c' }} />
                  n8n & Make.com
                </h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.4', margin: '0 0 12px 0' }}>
                  1. Create a <strong>Webhook Trigger node</strong> in n8n and copy the Webhook URL into the Webhooks tab.
                  <br />2. Add an <strong>HTTP Request node</strong> with method <code>POST</code> and URL <code>{baseUrl}/api/messages/send</code>.
                  <br />3. Set header <code>Authorization: Bearer &lt;API_KEY&gt;</code>.
                </p>
              </div>

              <div style={{ padding: '18px', borderRadius: '8px', background: 'var(--bg-main)', border: '1px solid var(--border-color)' }}>
                <h4 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={18} style={{ color: '#8b5cf6' }} />
                  Flowise AI & LangChain
                </h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: '1.4', margin: '0 0 12px 0' }}>
                  1. Point the WhatsApp Webhook to your Flowise prediction endpoint.
                  <br />2. In Flowise custom tool, call the Send Message API with your API Key.
                  <br />3. Pass <code>"source": "bot"</code> in the request body to respect human agent hold states.
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
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '500px', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <h3 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Key size={20} className="text-primary" />
              Create New API Key
            </h3>
            <p className="text-muted" style={{ fontSize: '0.85rem', margin: '0 0 16px 0' }}>
              Assign a recognizable name and grant specific permissions for this key.
            </p>

            <form onSubmit={handleCreateKey} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div className="form-group">
                <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '6px', display: 'block' }}>
                  Key Name / Description
                </label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Production CRM, AI Bot Engine"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  style={{ width: '100%' }}
                  required
                />
              </div>

              <div>
                <label style={{ fontWeight: '600', fontSize: '0.85rem', marginBottom: '8px', display: 'block' }}>
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
                          gap: '10px',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          background: 'var(--bg-main)',
                          border: '1px solid var(--border-color)',
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
                        />
                        <div>
                          <div style={{ fontWeight: '600', fontSize: '0.82rem' }}>{scope.label}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{scope.desc}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowNewKeyModal(false)}
                  className="btn btn-secondary"
                  disabled={creatingKey}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingKey || !newKeyName.trim()}
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
          backgroundColor: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}>
          <div className="card glass" style={{ width: '100%', maxWidth: '640px', padding: '24px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Webhook Delivery Inspector</h3>
              <button onClick={() => setSelectedLog(null)} className="btn btn-secondary btn-sm">Close</button>
            </div>

            <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', fontSize: '0.82rem' }}>
              <span className="badge badge-success">{selectedLog.eventType}</span>
              <span className="text-muted">HTTP {selectedLog.responseStatus || 'N/A'}</span>
              <span className="text-muted">Latency: {selectedLog.latencyMs}ms</span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)' }}>Target URL</label>
                <div style={{ fontFamily: 'monospace', fontSize: '0.82rem', padding: '6px 10px', background: 'var(--bg-main)', borderRadius: '6px' }}>
                  {selectedLog.url}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)' }}>Dispatched Payload</label>
                <pre style={{ margin: 0, padding: '12px', background: '#0d1117', color: '#58a6ff', borderRadius: '6px', fontSize: '0.8rem', overflowX: 'auto' }}>
                  {JSON.stringify(selectedLog.payload, null, 2)}
                </pre>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: '600', color: 'var(--text-muted)' }}>Response Body</label>
                <pre style={{ margin: 0, padding: '12px', background: '#0d1117', color: '#c9d1d9', borderRadius: '6px', fontSize: '0.8rem', overflowX: 'auto' }}>
                  {selectedLog.responseBody || '(empty)'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
