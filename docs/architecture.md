---
summary: "Target WebSocket gateway architecture, components, and client flows"
read_when:
  - Working on gateway protocol, clients, or transports
---
# Gateway Architecture (target state)

Last updated: 2025-12-09

## Overview
- A single long-lived **Gateway** process owns all messaging surfaces (WhatsApp via Baileys, Telegram via grammY, Discord via discord.js, Slack via Socket Mode) and the control/event plane.
- All clients (macOS app, CLI, web UI, automations) connect to the Gateway over one transport: **WebSocket on 127.0.0.1:18789** (tunnel or VPN for remote).
- One Gateway per host; it is the only place that is allowed to open a WhatsApp session. All sends/agent runs go through it.
- By default: the Gateway exposes a Canvas host on `canvasHost.port` (default `18793`), serving `~/clawd/canvas` at `/__clawdis__/canvas/` with live-reload; disable via `canvasHost.enabled=false` or `CLAWDIS_SKIP_CANVAS_HOST=1`.

## Components and flows
- **Gateway (daemon)**  
  - Maintains Baileys/Telegram/Discord connections.  
  - Exposes a typed WS API (req/resp + server push events).  
  - Validates every inbound frame against JSON Schema; rejects anything before a mandatory `connect`.
- **Clients (mac app / CLI / web admin)**  
  - One WS connection per client.  
  - Send requests (`health`, `status`, `send`, `agent`, `system-presence`, toggles) and subscribe to events (`tick`, `agent`, `presence`, `shutdown`).
  - On macOS, the app can also be invoked via deep links (`clawdis://agent?...`) which translate into the same Gateway `agent` request path (see `docs/clawdis-mac.md`).
- **Agent process (Pi)**  
  - Spawned by the Gateway on demand for `agent` calls; streams events back over the same WS connection.
- **WebChat**  
  - Serves static assets locally.  
  - Holds a single WS connection to the Gateway for control/data; all sends/agent runs go through the Gateway WS.  
  - Remote use goes through the same SSH/Tailscale tunnel as other clients.

## Connection lifecycle (single client)
```
Client                    Gateway
  |                          |
  |---- req:connect -------->|
  |<------ res (ok) ---------|   (or res error + close)
  |   (payload=hello-ok carries snapshot: presence + health) 
  |                          |
  |<------ event:presence ---|   (deltas)
  |<------ event:tick -------|   (keepalive/no-op)
  |                          |
  |------- req:agent ------->|
  |<------ res:agent --------|   (ack: {runId,status:"accepted"})
  |<------ event:agent ------|   (streaming)
  |<------ res:agent --------|   (final: {runId,status,summary})
  |                          |
```
## Wire protocol (summary)
- Transport: WebSocket, text frames with JSON payloads.
- First frame must be `req {type:"req", id, method:"connect", params:{minProtocol, maxProtocol, client:{name,version,platform,mode,instanceId}, caps, auth?, locale?, userAgent? } }`.
- Server replies `res {type:"res", id, ok:true, payload: hello-ok }` or `ok:false` then closes.
- After handshake:  
  - Requests: `{type:"req", id, method, params}` → `{type:"res", id, ok, payload|error}`  
  - Events: `{type:"event", event:"agent"|"presence"|"tick"|"shutdown", payload, seq?, stateVersion?}`
- If `CLAWDIS_GATEWAY_TOKEN` (or `--token`) is set, `connect.params.auth.token` must match; otherwise the socket closes with policy violation.
- Presence payload is structured, not free text: `{host, ip, version, mode, lastInputSeconds?, ts, reason?, tags?[], instanceId? }`.
- Agent runs are acked `{runId,status:"accepted"}` then complete with a final res `{runId,status,summary}`; streamed output arrives as `event:"agent"`.
- Protocol versions are bumped on breaking changes; clients must match `minClient`; Gateway chooses within client’s min/max.
- Idempotency keys are required for side-effecting methods (`send`, `agent`) to safely retry; server keeps a short-lived dedupe cache.
- Policy in `hello-ok` communicates payload/queue limits and tick interval.

## Type system and codegen
- Source of truth: TypeBox (or ArkType) definitions in `protocol/` on the server.
- Build step emits JSON Schema.  
- Clients:
  - TypeScript: uses the same TypeBox types directly.
  - Swift: generated `Codable` models via quicktype from the JSON Schema.
- Validation: AJV on the server for every inbound frame; optional client-side validation for defensive programming.

## Invariants
- Exactly one Gateway controls a single Baileys session per host. No fallbacks to ad-hoc direct Baileys sends.
- Handshake is mandatory; any non-JSON or non-connect first frame is a hard close.
- All methods and events are versioned; new fields are additive; breaking changes increment `protocol`.
- No event replay: on seq gaps, clients must refresh (`health` + `system-presence`) and continue; presence is bounded via TTL/max entries.

## Remote access
- Preferred: Tailscale or VPN; alternate: SSH tunnel `ssh -N -L 18789:127.0.0.1:18789 user@host`.
- Same protocol over the tunnel; same handshake. If a shared token is configured, clients must send it in `connect.params.auth.token` even over the tunnel.
- Same protocol over the tunnel; same handshake. If a shared token is configured, clients must send it in `connect.params.auth.token` even over the tunnel.

## Operations snapshot
- Start: `clawdis gateway` (foreground, logs to stdout).  
  Supervise with launchd/systemd for restarts.  
- Health: request `health` over WS; also surfaced in `hello-ok.health`.  
- Metrics/logging: keep outside this spec; gateway should expose Prometheus text or structured logs separately.

## Migration notes
- This architecture supersedes the legacy stdin RPC and the ad-hoc TCP control port. New clients should speak only the WS protocol. Legacy compatibility is intentionally dropped.
