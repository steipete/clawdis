---
summary: "Spec: integrated browser control server + action commands"
read_when:
  - Adding agent-controlled browser automation
  - Debugging why clawd is interfering with your own Chrome
  - Implementing browser settings + lifecycle in the macOS app
---

# Browser (integrated) — clawd-managed Chrome

Status: draft spec · Date: 2025-12-20

Goal: give the **clawd** persona its own browser that is:
- Visually distinct (lobster-orange, profile labeled "clawd").
- Fully agent-manageable (start/stop, list tabs, focus/close tabs, open URLs, screenshot).
- Non-interfering with the user's own browser (separate profile + dedicated ports).

This doc covers the macOS app/gateway side. It intentionally does not mandate
Playwright vs Puppeteer; the key is the **contract** and the **separation guarantees**.

## User-facing settings

Add a dedicated settings section (preferably under **Skills** or its own "Browser" tab):

- **Enable clawd browser** (`default: on`)
  - When off: no browser is launched, and browser tools return "disabled".
- **Browser control URL** (`default: http://127.0.0.1:18791`)
  - Interpreted as the base URL of the local/remote browser-control server.
  - If the URL host is not loopback, Clawdis must **not** attempt to launch a local
    browser; it only connects.
- **Accent color** (`default: #FF4500`, "lobster-orange")
  - Used to theme the clawd browser profile (best-effort) and to tint UI indicators
    in Clawdis.

Optional (advanced, can be hidden behind Debug initially):
- **Use headless browser** (`default: off`)
- **Attach to existing only** (`default: off`) — if on, never launch; only connect if
  already running.

### Port convention

Clawdis already uses:
- Gateway WebSocket: `18789`
- Bridge (voice/node): `18790`

For the clawd browser-control server, use "family" ports:
- Browser control HTTP API: `18791` (bridge + 1)
- Browser CDP/debugging port: `18792` (control + 1)
- Canvas host HTTP: `18793` by default, mounted at `/__clawdis__/canvas/`

The user usually only configures the **control URL** (port `18791`). CDP is an
internal detail.

## Browser isolation guarantees (non-negotiable)

1) **Dedicated user data dir**
   - Never attach to or reuse the user's default Chrome profile.
   - Store clawd browser state under an app-owned directory, e.g.:
     - `~/Library/Application Support/Clawdis/browser/clawd/` (mac app)
     - or `~/.clawdis/browser/clawd/` (gateway/CLI)

2) **Dedicated ports**
   - Never use `9222` (reserved for ad-hoc dev workflows; avoids colliding with
     `agent-tools/browser-tools`).
   - Default ports are `18791/18792` unless overridden.

3) **Named tab/page management**
   - The agent must be able to enumerate and target tabs deterministically (by
     stable `targetId` or equivalent), not "last tab".

## Browser selection (macOS)

On startup (when enabled + local URL), Clawdis chooses the browser executable
in this order:
1) **Google Chrome Canary** (if installed)
2) **Chromium** (if installed)
3) **Google Chrome** (fallback)

Implementation detail: detection is by existence of the `.app` bundle under
`/Applications` (and optionally `~/Applications`), then using the resolved
executable path.

Rationale:
- Canary/Chromium are easy to visually distinguish from the user's daily driver.
- Chrome fallback ensures the feature works on a stock machine.

## Visual differentiation ("lobster-orange")

The clawd browser should be obviously different at a glance:
- Profile name: **clawd**
- Profile color: **#FF4500**

Preferred behavior:
- Seed/patch the profile's preferences on first launch so the color + name persist.

Fallback behavior:
- If preferences patching is not reliable, open with the dedicated profile and let
  the user set the profile color/name once via Chrome UI; it must persist because
  the `userDataDir` is persistent.

## Control server contract (vNext)

Expose a small local HTTP API (and/or gateway RPC surface) so the agent can manage
state without touching the user's Chrome.

Basics:
- `GET /` status payload (enabled/running/pid/cdpPort/etc)
- `POST /start` start browser
- `POST /stop` stop browser
- `GET /tabs` list tabs
- `POST /tabs/open` open a new tab
- `POST /tabs/focus` focus a tab by id/prefix
- `DELETE /tabs/:targetId` close a tab by id/prefix

Inspection:
- `POST /screenshot` `{ targetId?, fullPage?, ref?, element?, type? }`
- `GET /snapshot` `?format=aria|ai&targetId?&limit?`
- `GET /console` `?level?&targetId?`
- `POST /pdf` `{ targetId? }`

Actions:
- `POST /navigate`
- `POST /act` `{ kind, targetId?, ... }` where `kind` is one of:
  - `click`, `type`, `press`, `hover`, `drag`, `select`, `fill`, `wait`, `resize`, `close`, `evaluate`

Hooks (arming):
- `POST /hooks/file-chooser` `{ targetId?, paths, timeoutMs? }`
- `POST /hooks/dialog` `{ targetId?, accept, promptText?, timeoutMs? }`

### "Is it open or closed?"

"Open" means:
- the control server is reachable at the configured URL **and**
- it reports a live browser connection.

"Closed" means:
- control server not reachable, or server reports no browser.

Clawdis should treat "open/closed" as a health check (fast path), not by scanning
global Chrome processes (avoid false positives).

## Interaction with the agent (clawd)

The agent should use browser tools only when:
- enabled in settings
- control URL is configured

If disabled, tools must fail fast with a friendly error ("Browser disabled in settings").

The agent should not assume tabs are ephemeral. It should:
- call `browser.tabs.list` to discover existing tabs first
- reuse an existing tab when appropriate (e.g. a persistent "main" tab)
- avoid opening duplicate tabs unless asked

## CLI quick reference (one example each)

Basics:
- `clawdis browser status`
- `clawdis browser start`
- `clawdis browser stop`
- `clawdis browser tabs`
- `clawdis browser open https://example.com`
- `clawdis browser focus abcd1234`
- `clawdis browser close abcd1234`

Inspection:
- `clawdis browser screenshot`
- `clawdis browser screenshot --full-page`
- `clawdis browser screenshot --ref 12`
- `clawdis browser snapshot`
- `clawdis browser snapshot --format aria --limit 200`

Actions:
- `clawdis browser navigate https://example.com`
- `clawdis browser resize 1280 720`
- `clawdis browser click 12 --double`
- `clawdis browser type 23 "hello" --submit`
- `clawdis browser press Enter`
- `clawdis browser hover 44`
- `clawdis browser drag 10 11`
- `clawdis browser select 9 OptionA OptionB`
- `clawdis browser upload /tmp/file.pdf`
- `clawdis browser fill --fields '[{\"ref\":\"1\",\"value\":\"Ada\"}]'`
- `clawdis browser dialog --accept`
- `clawdis browser wait --text "Done"`
- `clawdis browser evaluate --fn '(el) => el.textContent' --ref 7`
- `clawdis browser evaluate --fn "document.querySelector('.my-class').click()"`
- `clawdis browser console --level error`
- `clawdis browser pdf`

Notes:
- `upload` and `dialog` are **arming** calls; run them before the click/press that triggers the chooser/dialog.
- The arm default timeout is **2 minutes** (clamped to max 2 minutes); pass `timeoutMs` if you need shorter.
- `snapshot` defaults to `ai`; `aria` returns an accessibility tree for debugging.
- `click`/`type` require `ref` from `snapshot --format ai`; use `evaluate` for rare CSS selector one-offs.
- Avoid `wait` by default; use it only in exceptional cases when there is no reliable UI state to wait on.

## Security & privacy notes

- The clawd browser profile is app-owned; it may contain logged-in sessions.
  Treat it as sensitive data.
- The control server must bind to loopback only by default (`127.0.0.1`) unless the
  user explicitly configures a non-loopback URL.
- Never reuse or copy the user's default Chrome profile.

## Non-goals (for the first cut)

- Cross-device "sync" of tabs between Mac and Pi.
- Sharing the user's logged-in Chrome sessions automatically.
- General-purpose web scraping; this is primarily for "close-the-loop" verification
  and interaction.
