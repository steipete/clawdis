# Changelog

## 2.0.0-beta5 — Unreleased

### Features
- Talk mode: continuous speech conversations (macOS/iOS/Android) with ElevenLabs TTS, reply directives, and optional interrupt-on-speech.
- UI: add optional `ui.seamColor` accent to tint the Talk Mode side bubble (macOS/iOS/Android).
- Agent runtime: accept legacy `Z_AI_API_KEY` for Z.AI provider auth (maps to `ZAI_API_KEY`).
- Tests: add a Z.AI live test gate for smoke validation when keys are present.

### Fixes
- Docs/agent tools: clarify that browser `wait` should be avoided by default and used only in exceptional cases.
- macOS: Voice Wake now fully tears down the Speech pipeline when disabled (cancel pending restarts, drop stale callbacks) to avoid high CPU in the background.
- macOS menu: add a Talk Mode action alongside the Open Dashboard/Chat/Canvas entries.
- macOS Debug: hide “Restart Gateway” when the app won’t start a local gateway (remote mode / attach-only).
- macOS Talk Mode: orb overlay refresh, ElevenLabs request logging, API key status in settings, and auto-select first voice when none is configured.
- macOS Talk Mode: add hard timeout around ElevenLabs TTS synthesis to avoid getting stuck “speaking” forever on hung requests.
- macOS Talk Mode: avoid stuck playback when the audio player never starts (fail-fast + watchdog).
- macOS Talk Mode: fix audio stop ordering so disabling Talk Mode always stops in-flight playback.
- macOS Talk Mode: throttle audio-level updates (avoid per-buffer task creation) to reduce CPU/task churn.
- macOS Talk Mode: increase overlay window size so wave rings don’t clip; close button is hover-only and closer to the orb.
- Talk Mode: fall back to system TTS when ElevenLabs is unavailable, returns non-audio, or playback fails (macOS/iOS/Android).
- Talk Mode: stream PCM on macOS/iOS for lower latency (incremental playback); Android continues MP3 streaming.
- Talk Mode: validate ElevenLabs v3 stability and latency tier directives before sending requests.
- iOS/Android Talk Mode: auto-select the first ElevenLabs voice when none is configured.
- ElevenLabs: add retry/backoff for 429/5xx and include content-type in errors for debugging.
- Talk Mode: align to the gateway’s main session key and fall back to history polling when chat events drop (prevents stuck “thinking” / missing messages).
- Talk Mode: treat history timestamps as seconds or milliseconds to avoid stale assistant picks (macOS/iOS/Android).
- Chat UI: clear streaming/tool bubbles when external runs finish, preventing duplicate assistant bubbles.
- Chat UI: user bubbles use `ui.seamColor` (fallback to a calmer default blue).
- Control UI: sync sidebar navigation with the URL for deep-linking, and auto-scroll chat to the latest message.
- Control UI: disable Web Chat + Talk when no iOS/Android node is connected; refreshed Web Chat styling and keyboard send.
- Talk Mode: wait for chat history to surface the assistant reply before starting TTS (macOS/iOS/Android).
- iOS Talk Mode: fix chat completion wait to time out even if no events arrive (prevents “Thinking…” hangs).
- iOS Talk Mode: keep recognition running during playback to support interrupt-on-speech.
- iOS Talk Mode: preserve directive voice/model overrides across config reloads and add ElevenLabs request timeouts.
- iOS/Android Talk Mode: explicitly `chat.subscribe` when Talk Mode is active, so completion events arrive even if the Chat UI isn’t open.
- Chat UI: refresh history when another client finishes a run in the same session, so Talk Mode + Voice Wake transcripts appear consistently.
- Gateway: `voice.transcript` now also maps agent bus output to `chat` events, ensuring chat UIs refresh for voice-triggered runs.
- iOS/Android: show a centered Talk Mode orb overlay while Talk Mode is enabled.
- Gateway config: inject `talk.apiKey` from `ELEVENLABS_API_KEY`/shell profile so nodes can fetch it on demand.
- Canvas A2UI: tag requests with `platform=android|ios|macos` and boost Android canvas background contrast.
- iOS/Android nodes: enable scrolling for loaded web pages in the Canvas WebView (default scaffold stays touch-first).
- macOS menu: device list now uses `node.list` (devices only; no agent/tool presence entries).
- macOS menu: device list now shows connected nodes only.
- macOS menu: device rows now pack platform/version on the first line, and command lists wrap in submenus.
- macOS menu: split device platform/version across first and second rows for better fit.
- iOS node: fix ReplayKit screen recording crash caused by queue isolation assertions during capture.
- iOS Talk Mode: avoid audio tap queue assertions when starting recognition.
- iOS/Android nodes: bridge auto-connect refreshes stale tokens and settings now show richer bridge/device details.
- iOS/Android nodes: status pill now surfaces camera activity instead of overlay toasts.
- iOS/Android/macOS nodes: camera snaps recompress to keep base64 payloads under 5 MB.
- iOS/Android nodes: status pill now surfaces pairing, screen recording, voice wake, and foreground-required states.
- iOS/Android nodes: avoid duplicating “Gateway reconnecting…” when the bridge is already connecting.
- iOS/Android nodes: Talk Mode now lives on a side bubble (with an iOS toggle to hide it), and Android settings no longer show the Talk Mode switch.
- macOS menu: top status line now shows pending node pairing approvals (incl. repairs).
- CLI: avoid spurious gateway close errors after successful request/response cycles.
- Agent runtime: clamp tool-result images to the 5MB Anthropic limit to avoid hard request rejections.
- Tests: add Swift Testing coverage for camera errors and Kotest coverage for Android bridge endpoints.

## 2.0.0-beta4 — 2025-12-27

### Fixes
- Package contents: include Discord/hooks build outputs in the npm tarball to avoid missing module errors.
- Heartbeat replies now drop any output containing `HEARTBEAT_OK`, preventing stray emoji/text from being delivered.
- macOS menu now refreshes the control channel after the gateway starts and shows “Connecting to gateway…” while the gateway is coming up.
- macOS local mode now waits for the gateway to be ready before configuring the control channel, avoiding false “no connection” flashes.
- WhatsApp watchdog now forces a reconnect even if the socket close event stalls (force-close to unblock reconnect loop).
- Gateway presence now reports macOS product version (via `sw_vers`) instead of Darwin kernel version.

## 2.0.0-beta3 — 2025-12-27

### Highlights
- First-class Clawdis tools (browser, canvas, nodes, cron) replace the old `clawdis-*` skills; tool schemas are now injected directly into the agent runtime.
- Per-session model selection + custom model providers: `models.providers` merges into `~/.clawdis/agent/models.json` (merge/replace modes) for LiteLLM, local OpenAI-compatible servers, Anthropic proxies, etc.
- Group chat activation modes: per-group `/activation mention|always` command with status visibility.
- Discord bot transport for DMs and guild text channels, with allowlists + mention gating.
- Gateway webhooks: external `wake` and isolated `agent` hooks with dedicated token auth.
- Hook mappings + Gmail Pub/Sub helper (`clawdis hooks gmail setup/run`) with auto-renew + Tailscale Funnel support.
- Command queue modes + per-session overrides (`/queue ...`) and new `agent.maxConcurrent` cap for safe parallelism across sessions.
- Background bash tasks: `bash` auto-yields after 20s (or on demand) with a `process` tool to list/poll/log/write/kill sessions.
- Gateway in-process restart: `clawdis_gateway` tool action triggers a SIGUSR1 restart without needing a supervisor.

### Breaking
- Config refactor: `inbound.*` removed; use top-level `routing` (allowlists + group rules + transcription), `messages` (prefixes/timestamps), and `session` (scoping/store/mainKey). No legacy keys read.
- Heartbeat config moved to `agent.heartbeat`: set `every: "30m"` (duration string) and optional `model`. `agent.heartbeatMinutes` is removed, and heartbeats are disabled unless `agent.heartbeat.every` is set.
- Heartbeats now run via the gateway runner (main session) and deliver to the last used channel by default. WhatsApp reply-heartbeat behavior is removed; use `agent.heartbeat.target`/`to` (or `target: "none"`) to control delivery.
- Browser `act` no longer accepts CSS `selector`; use `snapshot` refs (default `ai`) or `evaluate` as an escape hatch.

### Fixes
- Heartbeat replies now strip repeated `HEARTBEAT_OK` tails to avoid accidental “OK OK” spam.
- Heartbeat delivery now uses the last non-empty payload, preventing tool preambles from swallowing the final reply.
- Heartbeats now skip WhatsApp delivery when the web provider is inactive or unlinked (instead of logging “no active gateway listener”).
- Heartbeat failure logs now include the error reason instead of `[object Object]`.
- Duration strings now accept `h` (hours) where durations are parsed (e.g., heartbeat intervals).
- WhatsApp inbound now normalizes more wrapper types so quoted reply bodies are extracted reliably.
- WhatsApp send now preserves existing JIDs (including group `@g.us`) instead of coercing to `@s.whatsapp.net`. (Thanks @arun-8687.)
- Telegram/WhatsApp: reply context stays in `Body`/`ReplyTo*`, but outbound replies no longer thread to the original message. (Thanks @joshp123 for the PR and follow-up question.)
- Suppressed libsignal session cleanup spam from console logs unless verbose mode is enabled.
- WhatsApp web creds persistence hardened; credentials are restored before auth checks and QR login auto-restarts if it stalls.
- Group chats now honor `routing.groupChat.requireMention=false` as the default activation when no per-group override exists.
- Gateway auth no longer supports PAM/system mode; use token or shared password.
- Tailscale Funnel now requires password auth (no token-only public exposure).
- Group `/new` resets now work with @mentions so activation guidance appears on fresh sessions.
- Group chat activation context is now injected into the system prompt at session start (and after activation changes), including /new greetings.
- Typing indicators now start only once a reply payload is produced (no "thinking" typing for silent runs).
- WhatsApp group typing now starts immediately only when the bot is mentioned; otherwise it waits until real output exists.
- Streamed `<think>` segments are stripped before partial replies are emitted.
- System prompt now tags allowlisted owner numbers as the user identity to avoid mistaken “friend” assumptions.
- LM Studio/Ollama replies now require <final> tags; streaming ignores content until <final> begins.
- LM Studio responses API: tools payloads no longer include `strict: null`, and LM Studio no longer gets forced `<think>/<final>` tags.
- Identity emoji no longer auto-prefixes replies (set `messages.responsePrefix` explicitly if desired).
- Model switches now enqueue a system event so the next run knows the active model.
- `/model status` now lists available models (same as `/model`).
- `process log` pagination is now line-based (omit `offset` to grab the last N lines).
- macOS WebChat: assistant bubbles now update correctly when toggling light/dark mode.
- macOS: avoid spawning a duplicate gateway process when an external listener already exists.
- Node bridge: when binding to a non-loopback host (e.g. Tailnet IP), also listens on `127.0.0.1` for local connections (without creating duplicate loopback listeners for `0.0.0.0`/`127.0.0.1` binds).
- UI perf: pause repeat animations when scenes are inactive (typing dots, onboarding glow, iOS status pulse), throttle voice overlay level updates, and reduce overlay focus churn.
- Canvas defaults/A2UI auto-nav aligned; debug status overlay centered; redundant await removed in `CanvasManager`.
- Gateway launchd loop fixed by removing redundant `kickstart -k`.
- CLI now hints when Peekaboo is unauthorized.
- WhatsApp web inbox listeners now clean up on close to avoid duplicate handlers.
- Gateway startup now brings up browser control before external providers; WhatsApp/Telegram/Discord auto-start can be disabled with `web.enabled`, `telegram.enabled`, or `discord.enabled`.

### Providers & Routing
- New Discord provider for DMs + guild text channels with allowlists and mention-gated replies by default.
- `routing.queue` now controls queue vs interrupt behavior globally + per surface (defaults: WhatsApp/Telegram interrupt, Discord/WebChat queue).
- `/queue <mode>` supports one-shot or per-session overrides; `/queue reset|default` clears overrides.
- `agent.maxConcurrent` caps global parallel runs while keeping per-session serialization.

### macOS app
- Update-ready state surfaced in the menu; menu sections regrouped with session submenus.
- Menu bar now shows a dedicated Nodes section under Context with inline rows, overflow submenu, and iconized actions.
- Nodes now expose consistent inline details with per-node submenus for quick copy of key fields.
- Node rows now show compact app versions (build numbers moved to submenus) and offer SSH launch from Bonjour when available.
- Menu actions are grouped below toggles; Open Canvas hides when disabled and Voice Wake now anchors the mic picker.
- Connections now include Discord provider status + configuration UI.
- Menu bar gains an Allow Camera toggle alongside Canvas.
- Session list polish: sleeping/disconnected/error states, usage bar restored, padding + bar sizing tuned, syncing menu removed, header hidden when disconnected.
- Chat UI polish: tool call cards + merged tool results, glass background, tighter composer spacing, visual effect host tweaks.
- OAuth storage moved; legacy session syncing metadata removed.
- Remote SSH tunnels now get health checks; Debug → Ports highlights unhealthy tunnels and offers Reset SSH tunnel.
- Menu bar session/node sections no longer reflow while open, keeping hover highlights aligned.
- Menu hover highlights now span the full width (including submenu arrows).
- Menu session rows now refresh while open without width changes (no more stuck “Loading sessions…”).
- Menu width no longer grows on hover when moving the mouse across rows.
- Context usage bars now have higher contrast in light mode.
- macOS node timeouts now share a single async timeout helper for consistent behavior.
- WebChat window defaults tightened (narrower width, edge-to-edge layout) and the SwiftUI tag removed from the title.

### Nodes & Canvas
- Debug status overlay gated and toggleable on macOS/iOS/Android nodes.
- Gateway now derives the canvas host URL via a shared helper for bridge + WS handshakes (avoids loopback pitfalls).
- `canvas a2ui push` validates JSONL with line errors, rejects v0.9 payloads, and supports `--text` quick renders.
- `nodes rename` lets you override paired node display names without editing JSON.
- Android scaffold asset cleanup; iOS canvas/voice wake adjustments.

### Logging & Observability
- New subsystem console formatter with color modes, shortened prefixes, and TTY detection; browser/gateway logs route through the subsystem logger.
- WhatsApp console output streamlined; chalk/tslog typing fixes.

### Web UI
- Chat is now the dashboard landing view; health status simplified; initial scroll animation removed.

### Build, Dev, Docs
- Notarization flow added for macOS release artifacts; packaging scripts updated.
- macOS signing auto-selects Developer ID → Apple Distribution → Apple Development; no ad-hoc fallback.
- Added type-aware oxlint; docs list resolves from cwd; formatting/lint cleanup and dependency bumps (Peekaboo).
- Docs refreshed for tools, custom model providers, Discord, queue/routing, group activation commands, logging, restart semantics, release notes, GitHub pages CTAs, and npm pitfalls.
- `pnpm build` now skips A2UI bundling for faster builds (run `pnpm canvas:a2ui:bundle` when needed).

### Tests
- Coverage added for models config merging, WhatsApp reply context, QR login flows, auto-reply behavior, and gateway SIGTERM timeouts.
- Added gateway webhook coverage (auth, validation, and summary posting).
- Vitest now isolates HOME/XDG config roots so tests never touch a real `~/.clawdis` install.

## 2.0.0-beta2 — 2025-12-21

Second beta focused on bundled gateway packaging, skills management, onboarding polish, and provider reliability.

### Highlights
- Bundled gateway packaging: bun-compiled embedded gateway, new `gateway-daemon` command, launchd support, DMG packaging (zip+DMG).
- Skills platform: managed/bundled skills, install metadata + installers (uv), skill search + website, media/transcription helpers.
- macOS app: new Connections settings w/ provider status + QR login, skills settings redesign w/ install targets, models list loaded from the Gateway, clearer local/remote gateway choices.
- Web/agent UX: tool summary streaming + runtime toggle, WhatsApp QR login tool, agent steering queue, voice wake routes to main session, workspace bootstrap ritual.

### Gateway & providers
- Gateway: `models.list`, provider status events + RPC coverage, tailscale auth + PAM, bind-mode config, enriched agent WS logs, safer upgrade socket handling, fixed handshake auth crash.
- WhatsApp Web: QR login flow improvements (logged-out clearing, wait flow), self-chat mode handling, removed batching delay, web inbox made non-blocking.
- Telegram: normalized chat IDs with clearer error reporting.

### Canvas & browser control
- Canvas host served on Gateway port; removed standalone canvasHost port config; restored action bridge; refreshed A2UI bundle + message context; bridge canvas host for nodes.
- A2UI full-screen gutters + status clearance after successful load to avoid overlay collisions.
- Browser control API simplified; added MCP tool dispatch + native actions; control server can start without Playwright; hook timeouts extended.

### macOS UI polish
- Onboarding chat UI: kickoff flow, bubble tails, spacing + bottom bar refinements, window sizing tweaks, show Dock icon during onboarding.
- Skills UI: stabilized action column, fixed install target access, refined list layout and sizing, always show CLI installer.
- Remote/local gateway: auto-enable local gateway, clearer labels, re-ensure remote tunnel, hide local bridge discovery in remote mode.

### Build, CI, deps
- Bundled playwright-core + chromium-bidi/long; bun gateway bytecode builds; swiftformat/biome CI fixes; iOS lint script updates; Android icon/compiler updates; ignored new ClawdisKit `.swiftpm` path.

### Docs
- README architecture refresh + npm header image fix; onboarding/bootstrap steps; skills install guidance + new skills; browser/canvas control docs; bundled gateway + DMG packaging notes.

## 2.0.0-beta1 — 2025-12-19

First Clawdis release post rebrand. This is a semver-major because we dropped legacy providers/agents and moved defaults to new paths while adding a full macOS companion app, a WebSocket Gateway, and an iOS node.

### Bug Fixes
- macOS: Voice Wake / push-to-talk no longer initialize `AVAudioEngine` at app launch, preventing Bluetooth headphones from switching into headset profile when voice features are unused. (Thanks @Nachx639)

### Breaking
- Renamed to **Clawdis**: defaults now live under `~/.clawdis` (sessions in `~/.clawdis/sessions/`, IPC at `~/.clawdis/clawdis.sock`, logs in `/tmp/clawdis`). Launchd labels and config filenames follow the new name; legacy stores are copied forward on first run.
- Pi only: only the embedded Pi runtime remains, and the agent CLI/CLI flags for Claude/Codex/Gemini were removed. The Pi CLI runs in RPC mode with a persistent worker.
- WhatsApp Web is the only transport; Twilio support and related CLI flags/tests were removed.
- Direct chats now collapse into a single `main` session by default (no config needed); groups stay isolated as `group:<jid>`.
- Gateway is now a loopback-only WebSocket daemon (`ws://127.0.0.1:18789`) that owns all providers/state; clients (CLI, WebChat, macOS app, nodes) connect to it. Start it explicitly (`clawdis gateway …`) or via Clawdis.app; helper subcommands no longer auto-spawn a gateway.

### Gateway, nodes, and automation
- New typed Gateway WS protocol (JSON schema validated) with `clawdis gateway {health,status,send,agent,call}` helpers and structured presence/instance updates for all clients.
- Optional LAN-facing bridge (`tcp://0.0.0.0:18790`) keeps the Gateway loopback-only while enabling direct Bonjour-discovered connections for paired nodes.
- Node pairing + management via `clawdis nodes {pending,approve,reject,invoke}` (used by the iOS node and future remote nodes).
- Cron jobs are Gateway-owned (`clawdis cron …`) with run history stored as JSONL and support for “isolated summary” posting into the main session.

### macOS companion app
- **Clawdis.app menu bar companion**: packaged, signed bundle with gateway start/stop, launchd toggle, project-root and pnpm/node auto-resolution, live log shortcut, restart button, and status/recipient table plus badges/dimming for attention and paused states.
- **On-device Voice Wake**: Apple speech recognizer with wake-word table, language picker, live mic meter, “hold until silence,” animated ears/legs, and main-session routing that replies on the **last used surface** (WhatsApp/Telegram/WebChat). Delivery failures are logged, and the run remains visible via WebChat/session logs.
- **WebChat & Debugging**: bundled WebChat UI, Debug tab with heartbeat sliders, session-store picker, log opener (`clawlog`), gateway restart, health probes, and scrollable settings panes.
- **Browser control**: manage clawd’s dedicated Chrome/Chromium with tab listing/open/focus/close, screenshots, DOM query/dump, and “AI snapshots” (aria/domSnapshot/ai) via `clawdis browser …` and UI controls.
- **Remote gateway control**: Bonjour discovery for local masters plus SSH-tunnel fallback for remote control when multicast is unavailable.

### iOS node
- New iOS companion app that pairs to the Gateway bridge, reports presence as a node, and exposes a WKWebView “Canvas” for agent-driven UI.
- `clawdis nodes invoke` supports `canvas.eval` and `canvas.snapshot` to drive and verify the iOS Canvas (fails fast when the iOS node is backgrounded).
- Voice wake words are configurable in-app; the iOS node reconnects to the last bridge when credentials are still present in Keychain.

### WhatsApp & agent experience
- Group chats fully supported: mention-gated triggers (including media-only captions), sender attribution, session primer with subject/member roster, allowlist bypass when you’re @‑mentioned, and safer handling of view-once/ephemeral media.
- Thinking/verbosity directives: `/think` and `/verbose` acknowledge and persist per session while allowing inline overrides; verbose mode streams tool metadata with emoji/args/previews and coalesces bursts to reduce WhatsApp noise.
- Heartbeats: configurable cadence with CLI/GUI toggles; directive acks suppressed during heartbeats; array/multi-payload replies normalized for Baileys.
- Reply quality: smarter chunking on words/newlines, fallback warnings when media fails to send, self-number mention detection, and primed group sessions send the roster on first turn.
- In-chat `/status`: prints agent readiness, session context usage %, current thinking/verbose options, and when the WhatsApp web creds were refreshed (helps decide when to re-scan QR); still available via `clawdis status` CLI for web session health.

### CLI, RPC, and health
- New `clawdis agent` command plus a persistent Pi RPC worker (auto-started) enables direct agent chats; `clawdis status` renders a colored session/recipient table.
- `clawdis health` probes WhatsApp link status, connect latency, heartbeat interval, session-store recency, and IPC socket presence (JSON mode for monitors).
- Added `--help`/`--version` flags; login/logout accept `--provider` (WhatsApp default). Console output is mirrored into pino logs under `/tmp/clawdis`.
- RPC stability: stdin/stdout loop for Pi, auto-restart worker, raw error surfacing, and deliver-via-RPC when JSON agent output is returned.

### Security & hardening
- Media server blocks symlink/path traversal, clears temporary downloads, and rotates logs daily (24h retention).
- Session store purged on logout; IPC socket directory permissions tightened (0700/0600).
- Launchd PATH and helper lookup hardened for packaged macOS builds; health probes surface missing binaries quickly.

### Docs
- Added `docs/telegram.md` outlining the Telegram Bot API provider (grammY) and how it shares the `main` session. Default grammY throttler keeps Bot API calls under rate limits.
- Gateway can run WhatsApp + Telegram together when configured; `clawdis send --provider telegram …` sends via the Telegram bot (webhook/proxy options documented).

## 1.5.0 — 2025-12-05

### Breaking
- Dropped all non-Pi agents (Claude, Codex, Gemini, Opencode); only the embedded Pi runtime remains and related CLI helpers have been removed.
- Removed Twilio support and all related commands/options (webhook/up/provider flags/wait-poll); CLAWDIS is Baileys Web-only.

### Changes
- Default agent handling now favors Pi RPC while falling back to plain command execution for non-Pi invocations, keeping heartbeat/session plumbing intact.
- Documentation updated to reflect Pi-only support and to mark legacy Claude paths as historical.
- Status command reports web session health + session recipients; config paths are locked to `~/.clawdis` with session metadata stored under `~/.clawdis/sessions/`.
- Simplified send/agent/gateway/heartbeat to web-only delivery; removed Twilio mocks/tests and dead code.
- Pi RPC timeout is now inactivity-based (5m without events) and error messages show seconds only.
- Pi sessions now write to `~/.clawdis/sessions/` by default (legacy session logs from older installs are copied over when present).
- Directive triggers (`/think`, `/verbose`, `/stop` et al.) now reply immediately using normalized bodies (timestamps/group prefixes stripped) without waiting for the agent.
- Directive/system acks carry a `⚙️` prefix and verbose parsing rejects typoed `/ver*` strings so unrelated text doesn’t flip verbosity.
- Batched history blocks no longer trip directive parsing; `/think` in prior messages won't emit stray acknowledgements.
- RPC fallbacks no longer echo the user's prompt (e.g., pasting a link) when the agent returns no assistant text.
- Heartbeat prompts with `/think` no longer send directive acks; heartbeat replies stay silent on settings.
- `clawdis sessions` now renders a colored table (a la oracle) with context usage shown in k tokens and percent of the context window.

## 1.4.1 — 2025-12-04

### Changes
- Added `clawdis agent` CLI command to talk directly to the configured agent using existing session handling (no WhatsApp send), with JSON output and delivery option.
- `/new` reset trigger now works even when inbound messages have timestamp prefixes (e.g., `[Dec 4 17:35]`).
- WhatsApp mention parsing accepts nullable arrays and flattens safely to avoid missed mentions.

## 1.4.0 — 2025-12-03

### Highlights
- **Thinking directives & state:** `/t|/think|/thinking <level>` (aliases off|minimal|low|medium|high|max/highest). Inline applies to that message; directive-only message pins the level for the session; `/think:off` clears. Resolution: inline > session override > `agent.thinkingDefault` > off. Pi gets `--thinking <level>` (except off); other agents append cue words (`think` → `think hard` → `think harder` → `ultrathink`). Heartbeat probe uses `HEARTBEAT /think:high`.
- **Group chats (web provider):** Clawdis now fully supports WhatsApp groups: mention-gated triggers (including image-only @ mentions), recent group history injection, per-group sessions, sender attribution, and a first-turn primer with group subject/member roster; heartbeats are skipped for groups.
- **Group session primer:** The first turn of a group session now tells the agent it is in a WhatsApp group and lists known members/subject so it can address the right speaker.
- **Media failures are surfaced:** When a web auto-reply media fetch/send fails (e.g., HTTP 404), we now append a warning to the fallback text so you know the attachment was skipped.
- **Verbose directives + session hints:** `/v|/verbose on|full|off` mirrors thinking: inline > session > config default. Directive-only replies with an acknowledgement; invalid levels return a hint. When enabled, tool results from JSON-emitting agents (Pi, etc.) are forwarded as metadata-only `[🛠️ <tool-name> <arg>]` messages (now streamed as they happen), and new sessions surface a `🧭 New session: <id>` hint.
- **Verbose tool coalescing:** successive tool results of the same tool within ~1s are batched into one `[🛠️ tool] arg1, arg2` message to reduce WhatsApp noise.
- **Directive confirmations:** Directive-only messages now reply with an acknowledgement (`Thinking level set to high.` / `Thinking disabled.`) and reject unknown levels with a helpful hint (state is unchanged).
- **Pi stability:** RPC replies buffered until the assistant turn finishes; parsers return consistent `texts[]`; web auto-replies keep a warm Pi RPC process to avoid cold starts.
- **Claude prompt flow:** One-time `sessionIntro` with per-message `/think:high` bodyPrefix; system prompt always sent on first turn even with `sendSystemOnce`.
- **Heartbeat UX:** Backpressure skips reply heartbeats while other commands run; skips don’t refresh session `updatedAt`; web heartbeats normalize array payloads and optional `heartbeatCommand`.
- **Control via WhatsApp:** Send `/restart` to restart the launchd service (`com.steipete.clawdis`) from your allowed numbers.
- **Pi completion signal:** RPC now resolves on Pi’s `agent_end` (or process exit) so late assistant messages aren’t truncated; 5-minute hard cap only as a failsafe.

### Reliability & UX
- Outbound chunking prefers newlines/word boundaries and enforces caps (~4000 chars for web/WhatsApp).
- Web auto-replies fall back to caption-only if media send fails; hosted media MIME-sniffed and cleaned up immediately.
- IPC gateway send shows typing indicator; batched inbound messages keep timestamps; watchdog restarts WhatsApp after long inactivity.
- Early `allowFrom` filtering prevents decryption errors; same-phone mode supported with echo suppression.
- All console output is now mirrored into pino logs (still printed to stdout/stderr), so verbose runs keep full traces.
- `--verbose` now forces log level `trace` (was `debug`) to capture every event.
- Verbose tool messages now include emoji + args + a short result preview for bash/read/edit/write/attach (derived from RPC tool start/end events).

### Security / Hardening
- IPC socket hardened (0700 dir / 0600 socket, no symlinks/foreign owners); `clawdis logout` also prunes session store.
- Media server blocks symlinks and enforces path containment; logging rotates daily and prunes >24h.

### Bug Fixes
- Web group chats now bypass the second `allowFrom` check (we still enforce it on the group participant at inbox ingest), so mentioned group messages reply even when the group JID isn’t in your allowlist.
- `logVerbose` also writes to the configured Pino logger at debug level (without breaking stdout).
- Group auto-replies now append the triggering sender (`[from: Name (+E164)]`) to the batch body so agents can address the right person in group chats.
- Media-only pings now pick up mentions inside captions (image/video/etc.), so @-mentions on media-only messages trigger replies.
- MIME sniffing and redirect handling for downloads/hosted media.
- Response prefix applied to heartbeat alerts; heartbeat array payloads handled for both providers.
- Pi RPC typing exposes `signal`/`killed`; NDJSON parsers normalized across agents.
- Pi session resumes now append `--continue`, so existing history/think level are reloaded instead of starting empty.

### Testing
- Fixtures isolate session stores; added coverage for thinking directives, stateful levels, heartbeat backpressure, and agent parsing.

## 1.3.0 — 2025-12-02

### Highlights
- **Pluggable agents (Claude, Pi, Codex, Opencode):** agent selection via config/CLI plus per-agent argv builders and NDJSON parsers enable swapping without template changes.
- **Safety stop words:** `stop|esc|abort|wait|exit` immediately reply “Agent was aborted.” and mark the session so the next prompt is prefixed with an abort reminder.
- **Agent session reliability:** Only Claude returns a stable `session_id`; others may reset between runs.

### Bug Fixes
- Empty `result` fields no longer leak raw JSON to users.
- Heartbeat alerts now honor `responsePrefix`.
- Command failures return user-friendly messages.
- Test session isolation to avoid touching real `sessions.json`.
- (Removed in 2.0.0) IPC reuse for `clawdis send/heartbeat` prevents Signal/WhatsApp session corruption.
- Web send respects media kind (image/audio/video/document) with correct limits.

### Changes
- (Removed in 2.0.0) IPC gateway socket at `~/.clawdis/ipc/gateway.sock` with automatic CLI fallback.
- Batched inbound messages with timestamps; typing indicator after sends.
- Watchdog restarts WhatsApp after long inactivity; heartbeat logging includes minutes since last message.
- Early `allowFrom` filtering before decryption.
- Same-phone mode with echo detection and optional message prefix marker.

## 1.2.2 — 2025-11-28

### Changes
- Manual heartbeat sends: `clawdis heartbeat --message/--body` (web provider only); `--dry-run` previews payloads.

## 1.2.1 — 2025-11-28

### Changes
- Media MIME-first handling; hosted media extensions derived from detected MIME with tests.

### Planned / in progress (from prior notes)
- Heartbeat targeting quality: clearer recipient resolution and verbose logs.
- Heartbeat delivery preview (Claude path) dry-run.
- Simulated inbound hook for local testing.

## 1.2.0 — 2025-11-27

### Changes
- Heartbeat interval default 10m for command mode; prompt `HEARTBEAT /think:high`; skips don’t refresh session; session `heartbeatIdleMinutes` support.
- Heartbeat tooling: `--session-id`, `--heartbeat-now` (inline flag on `gateway`) for immediate startup probes.
- Prompt structure: `sessionIntro` plus per-message `/think:high`; session idle up to 7 days.
- Thinking directives: `/think:<level>`; Pi uses `--thinking`; others append cue; `/think:off` no-op.
- Robustness: Baileys/WebSocket guards; global unhandled error handlers; WhatsApp LID mapping; hosted media MIME-sniffing and cleanup.
- Docs: README Clawd setup; `docs/claude-config.md` for live config.

## 1.1.0 — 2025-11-26

### Changes
- Web auto-replies resize/recompress media and honor `agent.mediaMaxMb`.
- Detect media kind, enforce provider caps (images ≤6MB, audio/video ≤16MB, docs ≤100MB).
- `session.sendSystemOnce` and optional `sessionIntro`.
- Typing indicator refresh during commands; configurable via `agent.typingIntervalSeconds`.
- Optional audio transcription via external CLI.
- Command replies return structured payload/meta; respect `mediaMaxMb`; log Claude metadata; include `cwd` in timeout messages.
- Web provider refactor; logout command; web-only gateway start helper.
- Structured reconnect/heartbeat logging; bounded backoff with CLI/config knobs; troubleshooting guide.
- Relay help prints effective heartbeat/backoff when in web mode.

## 1.0.4 — 2025-11-25

### Changes
- Timeout fallbacks send partial stdout (≤800 chars) to the user instead of silence; tests added.
- Web gateway auto-reconnects after Baileys/WebSocket drops; close propagation tests.

## 0.1.3 — 2025-11-25

### Changes
- Auto-replies send a WhatsApp fallback message on command/Claude timeout with truncated stdout.
- Added tests for timeout fallback and partial-output truncation.
