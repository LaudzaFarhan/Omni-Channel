// Developer routes: API keys, Webhooks management, test trigger, and delivery logs.
import crypto from 'crypto';
import {
  listApiKeys, createApiKey, revokeApiKey,
  getWebhookConfig, saveWebhookConfig, listWebhookLogs, clearWebhookLogs,
  logWebhookDelivery,
} from './data.js';
import { approved, supervisor } from './middleware.js';

export function mountDeveloperRoutes(app, io) {
  // ---------------------------------------------------------------------------
  // API Keys
  // ---------------------------------------------------------------------------

  // GET /api/developer/keys
  app.get('/api/developer/keys', approved, async (req, res) => {
    try {
      const keys = await listApiKeys(req.workspaceId);
      res.json(keys);
    } catch (err) {
      console.error('[Developer] List API keys failed:', err.message);
      res.status(500).json({ error: 'Failed to list API keys' });
    }
  });

  // POST /api/developer/keys - create a new API key (supervisor only)
  app.post('/api/developer/keys', supervisor, async (req, res) => {
    try {
      const { name, scopes, expiresAt } = req.body || {};
      if (name && typeof name !== 'string') {
        return res.status(400).json({ error: 'Invalid key name' });
      }

      const newKey = await createApiKey(req.workspaceId, {
        name: (name || 'API Key').trim().slice(0, 100),
        scopes: Array.isArray(scopes) && scopes.length > 0 ? scopes : undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });

      res.status(201).json(newKey);
    } catch (err) {
      console.error('[Developer] Create API key failed:', err.message);
      res.status(500).json({ error: 'Failed to create API key' });
    }
  });

  // DELETE /api/developer/keys/:id - revoke an API key
  app.delete('/api/developer/keys/:id', supervisor, async (req, res) => {
    try {
      const revoked = await revokeApiKey(req.workspaceId, req.params.id);
      if (!revoked) {
        return res.status(404).json({ error: 'API key not found or already revoked' });
      }
      res.json({ success: true, key: revoked });
    } catch (err) {
      console.error('[Developer] Revoke API key failed:', err.message);
      res.status(500).json({ error: 'Failed to revoke API key' });
    }
  });

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  // GET /api/developer/webhook - get current webhook settings
  app.get('/api/developer/webhook', approved, async (req, res) => {
    try {
      const config = await getWebhookConfig(req.workspaceId);
      res.json(config);
    } catch (err) {
      console.error('[Developer] Get webhook config failed:', err.message);
      res.status(500).json({ error: 'Failed to get webhook configuration' });
    }
  });

  // POST /api/developer/webhook - save webhook settings
  app.post('/api/developer/webhook', supervisor, async (req, res) => {
    try {
      const { webhookUrl, secret, events, isActive } = req.body || {};
      const saved = await saveWebhookConfig(req.workspaceId, {
        webhookUrl: typeof webhookUrl === 'string' ? webhookUrl.trim() : '',
        secret: typeof secret === 'string' ? secret.trim() : '',
        events: Array.isArray(events) ? events : undefined,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      });
      res.json(saved);
    } catch (err) {
      console.error('[Developer] Save webhook config failed:', err.message);
      res.status(500).json({ error: 'Failed to save webhook configuration' });
    }
  });

  // POST /api/developer/webhook/test - dispatch a test ping event
  app.post('/api/developer/webhook/test', approved, async (req, res) => {
    try {
      const config = await getWebhookConfig(req.workspaceId);
      const targetUrl = (req.body?.webhookUrl || config?.webhookUrl || '').trim();
      const secret = (req.body?.secret || config?.secret || '').trim();

      if (!targetUrl) {
        return res.status(400).json({ error: 'Webhook URL is required for testing' });
      }

      const samplePayload = {
        event: 'ping',
        timestamp: new Date().toISOString(),
        workspaceId: req.workspaceId,
        data: {
          test: true,
          message: 'Hello from WhatsApp UAPI Developer Webhook Test!',
          source: 'customer_dashboard',
          sender: {
            jid: '6281234567890@s.whatsapp.net',
            phone: '6281234567890',
            name: 'John Doe (Test Contact)',
          },
          sampleMessage: {
            id: `TEST_${Date.now()}`,
            type: 'text',
            text: 'This is a sample incoming message sent to verify your webhook integration.',
            timestamp: Math.floor(Date.now() / 1000),
          },
        },
      };

      const bodyStr = JSON.stringify(samplePayload);
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsApp-UAPI-Webhook-Tester/1.0',
      };

      if (secret) {
        const signature = crypto.createHmac('sha256', secret).update(bodyStr).digest('hex');
        headers['X-Webhook-Signature-256'] = `sha256=${signature}`;
      }

      const start = Date.now();
      let responseStatus = 0;
      let responseBody = '';
      let status = 'SUCCESS';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const resp = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: bodyStr,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        responseStatus = resp.status;
        responseBody = await resp.text().catch(() => '');
        if (!resp.ok) {
          status = 'FAILED';
        }
      } catch (fetchErr) {
        clearTimeout(timeout);
        status = fetchErr.name === 'AbortError' ? 'TIMEOUT' : 'FAILED';
        responseBody = fetchErr.message;
      }

      const latencyMs = Date.now() - start;

      // Log the test delivery
      await logWebhookDelivery(req.workspaceId, {
        eventType: 'ping',
        url: targetUrl,
        payload: samplePayload,
        responseStatus,
        responseBody,
        latencyMs,
        status,
      });

      res.json({
        success: status === 'SUCCESS',
        status,
        responseStatus,
        responseBody: responseBody.slice(0, 500),
        latencyMs,
        sentPayload: samplePayload,
      });
    } catch (err) {
      console.error('[Developer] Webhook test failed:', err.message);
      res.status(500).json({ error: `Test dispatch error: ${err.message}` });
    }
  });

  // GET /api/developer/webhook/logs - list recent delivery logs
  app.get('/api/developer/webhook/logs', approved, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit, 10) || 50;
      const logs = await listWebhookLogs(req.workspaceId, limit);
      res.json(logs);
    } catch (err) {
      console.error('[Developer] List webhook logs failed:', err.message);
      res.status(500).json({ error: 'Failed to list webhook logs' });
    }
  });

  // DELETE /api/developer/webhook/logs - clear logs
  app.delete('/api/developer/webhook/logs', supervisor, async (req, res) => {
    try {
      const deletedCount = await clearWebhookLogs(req.workspaceId);
      res.json({ success: true, count: deletedCount });
    } catch (err) {
      console.error('[Developer] Clear webhook logs failed:', err.message);
      res.status(500).json({ error: 'Failed to clear webhook logs' });
    }
  });
}
