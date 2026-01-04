---
summary: "Routing rules per surface (WhatsApp, Telegram, Discord, web) and shared context"
read_when:
  - Changing surface routing or inbox behavior
---
# Surfaces & Routing

Updated: 2025-12-07

Goal: make replies deterministic per channel while keeping one shared context for direct chats.

- **Surfaces** (channel labels): `whatsapp`, `webchat`, `telegram`, `discord`, `slack`, `imessage`, `voice`, etc. Add `Surface` to inbound `MsgContext` so templates/agents can log which channel a turn came from. Routing is fixed: replies go back to the origin surface; the model doesn’t choose.
- **Reply context:** inbound replies include `ReplyToId`, `ReplyToBody`, and `ReplyToSender`, and the quoted context is appended to `Body` as a `[Replying to ...]` block.
- **Canonical direct session:** All direct chats collapse into the single `main` session by default (no config needed). Groups stay `surface:group:<id>` (rooms: `surface:channel:<id>`), so they remain isolated.
- **Session store:** Keys are resolved via `resolveSessionKey(scope, ctx, mainKey)`; the agent JSONL path lives under `~/.clawdis/sessions/<SessionId>.jsonl`.
- **WebChat:** Always attaches to `main`, loads the full session transcript so desktop reflects cross-surface history, and writes new turns back to the same session.
- **Implementation hints:**
  - Set `Surface` in each ingress (WhatsApp gateway, WebChat bridge, Telegram, Discord, iMessage).
  - Keep routing deterministic: originate → same surface. Use the gateway WebSocket for sends; avoid side channels.
  - Do not let the agent emit “send to X” decisions; keep that policy in the host code.
