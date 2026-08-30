# Hold Agent — API reference

Endpoints for pausing automated replies in a single WhatsApp conversation so a
human can take over, and for sending messages under that rule.

**Base URL:** `https://app.omnireach.my.id`

Every endpoint here requires `Authorization: Bearer <accessToken>`.

---

## Endpoint summary

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | `POST` | `/api/auth/login` | Obtain an access token |
| 2 | `POST` | `/api/auth/refresh` | Renew an expired access token |
| 3 | `GET`  | `/api/chats/hold` | List every held conversation in a session |
| 4 | `GET`  | `/api/chats/{jid}/hold` | Read the hold state of one conversation |
| 5 | `PUT`  | `/api/chats/{jid}/hold` | Hold or release one conversation |
| 6 | `POST` | `/api/messages/send` | Send a message; refused for held chats when marked automated |

> **`{jid}` must be URL-encoded.** `628123456789@s.whatsapp.net` becomes
> `628123456789%40s.whatsapp.net`. Forgetting this is the most common mistake.

---

## 1. `POST /api/auth/login`

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "you@example.com", "password": "…" }
```

**200**

```json
{
  "user": { "uid": "…", "email": "…", "role": "admin", "isApproved": true, "…": "…" },
  "accessToken": "eyJ…",
  "refreshToken": "…",
  "expiresIn": 900
}
```

`expiresIn` is seconds — the access token is valid for **15 minutes**.

| Status | Meaning |
|---|---|
| `400` | Email or password missing |
| `401` | Wrong email or password (deliberately indistinguishable, to prevent account enumeration) |
| `403` | `code: password_reset_required` — account imported from Firebase, needs a new password |
| `429` | Too many attempts. 20 per 15 minutes per IP |

## 2. `POST /api/auth/refresh`

```http
POST /api/auth/refresh
Content-Type: application/json

{ "refreshToken": "…" }
```

Returns the same shape as login. **Refresh tokens are single-use and rotate**:
the token you send is revoked and a new one is issued, so you must persist the new
value. Replaying an old one returns `401 refresh_invalid`, which is how token
theft surfaces.

---

## 3. `GET /api/chats/hold`

Every held conversation in a session. Use this to badge a chat list, or to
reconcile state after a restart.

```http
GET /api/chats/hold?sessionId=default
Authorization: Bearer <token>
```

**200**

```json
{
  "held": [
    {
      "chatJid": "628123456789@s.whatsapp.net",
      "pausedAt": "2026-08-30T10:41:24.408Z",
      "pausedBy": "Omni Reach Admin",
      "note": "Agent Dani taking over"
    }
  ]
}
```

`held` is `[]` when nothing is held. Only the caller's own conversations are ever
returned.

| Query | Default | Notes |
|---|---|---|
| `sessionId` | `default` | Which WhatsApp device/session |

## 4. `GET /api/chats/{jid}/hold`

State of one conversation.

```http
GET /api/chats/628123456789%40s.whatsapp.net/hold?sessionId=default
Authorization: Bearer <token>
```

**200**

```json
{
  "sessionId": "default",
  "chatJid": "628123456789@s.whatsapp.net",
  "botPaused": false,
  "pausedAt": null,
  "pausedBy": null,
  "note": null
}
```

Never returns `404`. A conversation that has never been held has no database row,
and this reports it as `botPaused: false` so callers can treat every chat alike.

## 5. `PUT /api/chats/{jid}/hold`

Hold or release.

```http
PUT /api/chats/628123456789%40s.whatsapp.net/hold
Authorization: Bearer <token>
Content-Type: application/json

{ "botPaused": true, "sessionId": "default", "note": "Agent Dani taking over" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `botPaused` | boolean | yes | `true` holds, `false` releases |
| `sessionId` | string | no | Defaults to `default` |
| `note` | string | no | Max 300 chars. Cleared on release |

**200** — returns the new state, same shape as endpoint 4.

```json
{
  "sessionId": "default",
  "chatJid": "628123456789@s.whatsapp.net",
  "botPaused": true,
  "pausedAt": "2026-08-30T10:41:24.408Z",
  "pausedBy": "Omni Reach Admin",
  "note": "Agent Dani taking over"
}
```

`pausedBy` is filled in from the calling account, not the request body. On release
`pausedAt`, `pausedBy` and `note` are all set to `null`. Re-holding an
already-held chat preserves the original `pausedAt`.

Side effect: emits `chat-hold-updated` over Socket.IO to the account's room, so
open dashboard tabs update without polling.

| Status | Meaning |
|---|---|
| `400` | Missing or oversized chat id |
| `401` | Bad or expired token |

---

## 6. `POST /api/messages/send`

The endpoint the hold actually governs.

```http
POST /api/messages/send
Authorization: Bearer <token>
X-Agent-Source: bot
Content-Type: application/json

{ "to": "628123456789", "text": "Automated reply", "sessionId": "default" }
```

| Field | Type | Notes |
|---|---|---|
| `to` | string | Phone number or full JID. Bare numbers get `@s.whatsapp.net` appended |
| `text` | string | Message body. Optional when sending `file` |
| `sessionId` | string | Defaults to `default` |
| `file` | object | `{ base64, type, name }` for media |
| `source` | string | Alternative to the header. `"bot"` or `"agent"` |

### Declaring yourself automated

A request counts as automated when **either** is present:

- header `X-Agent-Source: bot` (or `agent`)
- body field `"source": "bot"` (or `"agent"`)

Anything else is treated as human. **Automated requests are refused for held
chats; human requests are never blocked** — being able to reply is the entire
point of holding.

### Responses

| Status | `code` | Meaning | What a bot should do |
|---|---|---|---|
| `200` | — | Sent | Continue |
| `400` | — | `to` missing | Fix the request |
| `401` | `token_invalid` | Access token expired | Refresh once, retry |
| `403` | `not_approved` | Account revoked or unapproved | Stop |
| `409` | `chat_on_hold` | A human took over | **Drop the reply. Do not retry** |
| `429` | `quota_exceeded` | Message quota spent | Stop; needs a plan change |
| `503` | `wa_not_initialized` | No WhatsApp device paired | Retry later |
| `503` | `wa_not_connected` | Session exists but isn't connected | Retry later |

`409` body:

```json
{
  "error": "This conversation is on hold. A human agent has taken over, so automated replies are suppressed.",
  "code": "chat_on_hold",
  "chatJid": "628123456789@s.whatsapp.net"
}
```

Retrying a `409` will keep failing until a human releases the hold.

### Guard order

Checks run in this sequence, which matters for interpreting errors:

1. `to` present
2. **hold** — so a held chat reports as held regardless of device state
3. WhatsApp connectivity
4. Message quota — so a send that cannot happen never consumes quota
5. Deliver

---

## Worked example

Verified against production on 2026-08-30.

```bash
BASE=https://app.omnireach.my.id
JID='628123456789@s.whatsapp.net'
ENC=$(JID="$JID" node -e 'console.log(encodeURIComponent(process.env.JID))')
AUTH="Authorization: Bearer $TOKEN"

# hold
curl -s -X PUT "$BASE/api/chats/$ENC/hold" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"botPaused":true,"sessionId":"default"}'
# {"botPaused":true,"pausedAt":"2026-08-30T10:41:24.408Z","pausedBy":"Omni Reach Admin",...}

# automated send -> refused
curl -s -w '\n%{http_code}\n' -X POST "$BASE/api/messages/send" -H "$AUTH" \
  -H 'X-Agent-Source: bot' -H 'Content-Type: application/json' \
  -d '{"to":"628123456789","text":"blocked?","sessionId":"default"}'
# {"code":"chat_on_hold",...}
# 409

# human send -> passes the hold
curl -s -w '\n%{http_code}\n' -X POST "$BASE/api/messages/send" -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d '{"to":"628123456789","text":"human reply","sessionId":"default"}'
# {"code":"wa_not_initialized",...}   <- reached connectivity, so the hold let it through
# 503

# release
curl -s -X PUT "$BASE/api/chats/$ENC/hold" -H "$AUTH" \
  -H 'Content-Type: application/json' -d '{"botPaused":false,"sessionId":"default"}'
```

The two send calls are identical apart from `X-Agent-Source: bot`. That single
header is the whole mechanism.

---

## Receiving incoming messages

There is **no outbound webhook**. To know a customer has written, either connect
a Socket.IO client or poll.

```js
import { io } from 'socket.io-client';

const socket = io('https://app.omnireach.my.id', { auth: { token: accessToken } });

socket.on('new-message', ({ sessionId, jid, message }) => {
  if (message.key.fromMe) return;   // your own sends echo back here too
  // message is the raw Baileys message object
});
```

Events on that connection:

| Event | Payload | Meaning |
|---|---|---|
| `new-message` | `{ sessionId, jid, message }` | A message arrived or was sent |
| `message-update` | `{ sessionId, jid, … }` | Delivery/read receipt |
| `status-change` | `{ sessionId, status, qr?, user?, reason? }` | `qr` carries a data-URL QR image |
| `chat-hold-updated` | hold state object | Someone held or released a chat |
| `quota-updated` | `{ messagesSent, limit }` | After a successful send |
| `all-sessions` | array | Sent once on connect |
| `session-blocked` | `{ message }` | Device limit reached; socket then closes |

Two constraints:

- The handshake is rejected unless the account is approved.
- **A socket counts against the plan's device limit.** Free allows one, so if a
  browser tab is open, a second client may be refused with `session-blocked`.
  Raise `sessionLimit` for the account, or give the bot its own account.

Polling alternative:

```
GET /api/chats?sessionId=default
GET /api/chats/{jid}/messages?sessionId=default
```

---

## Known limitations

**The hold is cooperative, not enforced.** Any caller can omit
`X-Agent-Source` and be treated as human. It works because the bot is your own
code, and it is not a security boundary — it only affects your own
conversations. Enforcing it requires the bot to authenticate with its own
credential instead of borrowing a user's login, which is the API-key feature that
does not exist yet. The check is deliberately placed in `/api/messages/send` so a
key can later imply the source without moving any other code.

**Access tokens expire every 15 minutes.** An automated client has to refresh,
storing the rotated refresh token each time.

**Holds never expire.** A conversation stays held until someone releases it.
`pausedAt` is recorded, so a timeout job or a stale-hold report could be added.

**Nothing is notified.** No alert when a thread sits on hold. `pausedAt` and
`pausedBy` are stored for a future report or admin view.

**Incoming messages are unaffected.** Holding suppresses outbound automated
replies only; customer messages still arrive and appear normally.

---

## Data model

`chat_settings`, added by `server/migrations/002_chat_settings.sql`.

| Column | Type | Notes |
|---|---|---|
| `user_id` | text | FK to `users`, cascade delete |
| `session_id` | text | WhatsApp session |
| `chat_jid` | text | Conversation |
| `bot_paused` | boolean | The hold flag |
| `paused_at` | timestamptz | When held; `NULL` when released |
| `paused_by` | text | Who held it |
| `note` | text | Optional operator note |

Primary key is `(user_id, session_id, chat_jid)`, so a hold is scoped to one
conversation on one device for one account. A row exists only once a chat has been
held, so absence means "not held".

```sql
SELECT chat_jid, bot_paused, paused_at, paused_by
  FROM chat_settings
 WHERE user_id = '<uid>' AND session_id = 'default';
```
