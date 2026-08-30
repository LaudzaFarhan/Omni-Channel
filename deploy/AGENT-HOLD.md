# Agent hold

Lets a human take over one conversation while automation keeps handling the rest.
Pressing **Hold Agent** in a chat suppresses automated replies for that
conversation only; **Resume Agent** puts it back.

The hold is per `(user, session, chat)`. Holding Budi Kartono's thread does not
affect any other customer, and holding it on one WhatsApp number does not affect
the same contact on another.

---

## How it works

State lives in the `chat_settings` table. A row exists only once a chat has been
held at least once, so absence means "not held".

```sql
SELECT chat_jid, bot_paused, paused_at, paused_by
  FROM chat_settings
 WHERE user_id = '<uid>' AND session_id = 'default';
```

The dashboard reads and writes it through three endpoints, all scoped to the
caller's own account:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/chats/hold?sessionId=default` | Every held chat in a session, for badging a list |
| `GET` | `/api/chats/:jid/hold?sessionId=default` | State of one conversation |
| `PUT` | `/api/chats/:jid/hold` | Hold or release. Body: `{ "botPaused": true, "sessionId": "default", "note": "optional" }` |

A change emits `chat-hold-updated` over Socket.IO to the account's room, so other
open tabs follow along without polling.

---

## Wiring your bot to it

Whatever generates automated replies has to identify itself as automated. Send
either the header or the body field:

```http
POST /api/messages/send
Authorization: Bearer <token>
X-Agent-Source: bot
Content-Type: application/json

{ "to": "628123456789", "text": "...", "sessionId": "default" }
```

or

```json
{ "to": "628123456789", "text": "...", "sessionId": "default", "source": "bot" }
```

When the target conversation is held, the request is refused:

```
409 Conflict
{
  "error": "This conversation is on hold. A human agent has taken over, so automated replies are suppressed.",
  "code": "chat_on_hold",
  "chatJid": "628123456789@s.whatsapp.net"
}
```

Treat `409` with `code: "chat_on_hold"` as "drop this reply", not as an error to
retry. Retrying will keep failing until a human releases the hold.

Requests without the marker are treated as human and always go through — that is
the point of the feature, since the operator needs to reply while the bot is
paused.

Alternatively the bot can check first, which avoids burning message quota on a
reply that would be rejected:

```
GET /api/chats/<jid>/hold?sessionId=default  ->  { "botPaused": true, ... }
```

Prefer relying on the `409` as the source of truth even if you do check, because
a human can press Hold between your check and your send.

---

## An honest limitation

This is **cooperative**, not airtight. Any caller can omit `X-Agent-Source` and
be treated as human, so the hold depends on your bot being well behaved. That is
acceptable when the bot is your own code, and it is not a security boundary — it
only affects your own conversations.

Making it enforceable needs the bot to authenticate as itself with its own
credential rather than borrowing a user's token. That is the API-key feature
that does not exist yet. The check is deliberately placed in
`/api/messages/send`, so when API keys land, a key can carry
`source: bot` implicitly and no other code has to move.

## What this does not do

- **It does not stop incoming messages.** Messages from the customer still arrive
  and appear in the chat as normal. Only outbound automated replies are affected.
- **It does not expire.** A conversation stays held until someone releases it. If
  you want holds to lapse after a period of inactivity, that needs a scheduled
  job comparing `paused_at` against now, plus a decision about what "inactive"
  means.
- **It does not notify anyone.** Nothing alerts a supervisor that a thread has
  been sitting on hold. `paused_at` and `paused_by` are recorded so a report or
  an admin view could surface it later.
