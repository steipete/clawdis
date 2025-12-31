---
summary: "Agent tool surface for Clawdis (browser, canvas, nodes, cron) replacing clawdis-* skills"
read_when:
  - Adding or modifying agent tools
  - Retiring or changing clawdis-* skills
---

# Tools (Clawdis)

Clawdis exposes **first-class agent tools** for browser, canvas, nodes, and cron.
These replace the old `clawdis-*` skills: the tools are typed, no shelling,
and the agent should rely on them directly.

## Tool inventory

### `bash`
Run shell commands in the workspace.

Core parameters:
- `command` (required)
- `yieldMs` (auto-background after timeout, default 20000)
- `background` (immediate background)
- `timeout` (seconds; kills the process if exceeded, default 1800)

Notes:
- Returns `status: "running"` with a `sessionId` when backgrounded.
- Use `process` to poll/log/write/kill/clear background sessions.

### `process`
Manage background bash sessions.

Core actions:
- `list`, `poll`, `log`, `write`, `kill`, `clear`, `remove`

Notes:
- `poll` returns new output and exit status when complete.
- `log` supports line-based `offset`/`limit` (omit `offset` to grab the last N lines).

### `clawdis_browser`
Control the dedicated clawd browser.

Core actions:
- `status`, `start`, `stop`, `tabs`, `open`, `focus`, `close`
- `snapshot` (aria/ai)
- `screenshot` (returns image block + `MEDIA:<path>`)
- `act` (UI actions: click/type/press/hover/drag/select/fill/resize/wait/evaluate)
- `navigate`, `console`, `pdf`, `upload`, `dialog`

Notes:
- Requires `browser.enabled=true` in `~/.clawdis/clawdis.json`.
- Uses `browser.controlUrl` unless `controlUrl` is passed explicitly.
- `snapshot` defaults to `ai`; use `aria` for the accessibility tree.
- `act` requires `ref` from `snapshot --format ai`; use `evaluate` for rare CSS selector needs.
- Avoid `act` → `wait` by default; use it only in exceptional cases (no reliable UI state to wait on).

### `clawdis_canvas`
Drive the node Canvas (present, eval, snapshot, A2UI).

Core actions:
- `present`, `hide`, `navigate`, `eval`
- `snapshot` (returns image block + `MEDIA:<path>`)
- `a2ui_push`, `a2ui_reset`

Notes:
- Uses gateway `node.invoke` under the hood.
- If no `node` is provided, the tool picks a default (single connected node or local mac node).
- A2UI is v0.8 only (no `createSurface`); the CLI rejects v0.9 JSONL with line errors.
- Quick smoke: `clawdis canvas a2ui push --text "Hello from A2UI"`.

### `clawdis_nodes`
Discover and target paired nodes; send notifications; capture camera/screen.

Core actions:
- `status`, `describe`
- `pending`, `approve`, `reject` (pairing)
- `notify` (macOS `system.notify`)
- `camera_snap`, `camera_clip`, `screen_record`

Notes:
- Camera/screen commands require the node app to be foregrounded.
- Images return image blocks + `MEDIA:<path>`.
- Videos return `FILE:<path>` (mp4).

### `clawdis_cron`
Manage Gateway cron jobs and wakeups.

Core actions:
- `status`, `list`
- `add`, `update`, `remove`, `run`, `runs`
- `wake` (enqueue system event + optional immediate heartbeat)

Notes:
- `add` expects a full cron job object (same schema as `cron.add` RPC).
- `update` uses `{ jobId, patch }`.

### `clawdis_gateway`
Restart the running Gateway process (in-place).

Core actions:
- `restart` (sends `SIGUSR1` to the current process; `clawdis gateway`/`gateway-daemon` restart in-place)

Notes:
- Use `delayMs` (defaults to 2000) to avoid interrupting an in-flight reply.

## Parameters (common)

Gateway-backed tools (`clawdis_canvas`, `clawdis_nodes`, `clawdis_cron`):
- `gatewayUrl` (default `ws://127.0.0.1:18789`)
- `gatewayToken` (if auth enabled)
- `timeoutMs`

Browser tool:
- `controlUrl` (defaults from config)

## Recommended agent flows

Browser automation:
1) `clawdis_browser` → `status` / `start`
2) `snapshot` (ai or aria)
3) `act` (click/type/press)
4) `screenshot` if you need visual confirmation

Canvas render:
1) `clawdis_canvas` → `present`
2) `a2ui_push` (optional)
3) `snapshot`

Node targeting:
1) `clawdis_nodes` → `status`
2) `describe` on the chosen node
3) `notify` / `camera_snap` / `screen_record`

## Safety

- Avoid `system.run` (not exposed as a tool).
- Respect user consent for camera/screen capture.
- Use `status/describe` to ensure permissions before invoking media commands.

## How the model sees tools (pi-mono internals)

Tools are exposed to the model in **two parallel channels**:

1) **System prompt text**: a human-readable list + guidelines.
2) **Provider tool schema**: the actual function/tool declarations sent to the model API.

In pi-mono:
- System prompt builder: `packages/coding-agent/src/core/system-prompt.ts`
  - Builds the `Available tools:` list from `toolDescriptions`.
  - Appends skills and project context.
- Tool schemas passed to providers:
  - OpenAI: `packages/ai/src/providers/openai-responses.ts` (`convertTools`)
  - Anthropic: `packages/ai/src/providers/anthropic.ts` (`convertTools`)
  - Gemini: `packages/ai/src/providers/google-shared.ts` (`convertTools`)
- Tool execution loop:
  - Agent loop: `packages/ai/src/agent/agent-loop.ts`
  - Validates tool arguments and executes tools, then appends `toolResult` messages.

In Clawdis:
- System prompt append: `src/agents/system-prompt.ts`
- Tool list injected via `createClawdisCodingTools()` in `src/agents/pi-tools.ts`
