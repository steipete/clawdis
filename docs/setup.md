---
summary: "Setup guide: keep your Clawdis setup tailored while staying up-to-date"
read_when:
  - Setting up a new machine
  - You want “latest + greatest” without breaking your personal setup
---

# Setup

Last updated: 2026-01-01

## TL;DR
- **Tailoring lives outside the repo:** `~/clawd` (workspace) + `~/.clawdis/clawdis.json` (config).
- **Stable workflow:** install the macOS app; let it run the bundled Gateway.
- **Bleeding edge workflow:** run the Gateway yourself via `pnpm gateway:watch`, then point the macOS app at it using **Debug Settings → Gateway → Attach only**.

## Prereqs (from source)
- Node `>=22`
- `pnpm`
- Docker (optional; only for containerized setup/e2e — see `docs/docker.md`)

## Tailoring strategy (so updates don’t hurt)

If you want “100% tailored to me” *and* easy updates, keep your customization in:

- **Config:** `~/.clawdis/clawdis.json` (JSON/JSON5-ish)
- **Workspace:** `~/clawd` (skills, prompts, memories; make it a private git repo)

Bootstrap once:

```bash
clawdis setup
```

From inside this repo, use the local CLI entry:

```bash
pnpm clawdis setup
```

## Stable workflow (macOS app first)

1) Install + launch **Clawdis.app** (menu bar).
2) Complete the onboarding/permissions checklist (TCC prompts).
3) Ensure Gateway is **Local** and running (the app manages it).
4) Link surfaces (example: WhatsApp):

```bash
clawdis login
```

5) Sanity check:

```bash
clawdis health
```

If onboarding is still WIP/broken on your build:
- Run `clawdis setup`, then `clawdis login`, then start the Gateway manually (`clawdis gateway`).

## Bleeding edge workflow (Gateway in a terminal)

Goal: work on the TypeScript Gateway, get hot reload, keep the macOS app UI attached.

### 0) (Optional) Run the macOS app from source too

If you also want the macOS app on the bleeding edge:

```bash
./scripts/restart-mac.sh
```

### 1) Start the dev Gateway

```bash
pnpm install
pnpm gateway:watch
```

`gateway:watch` runs `src/index.ts gateway --force` and reloads on `src/**/*.ts` changes.

### 2) Point the macOS app at your running Gateway

In **Clawdis.app**:

- Connection Mode: **Local**
- Settings → **Debug Settings** → **Gateway** → enable **Attach only**

This makes the app **only connect to an already-running gateway** and **never spawn** its own.

### 3) Verify

- In-app Gateway status should read **“Using existing gateway …”**
- Or via CLI:

```bash
pnpm clawdis health
```

### Common footguns
- **Attach only enabled, but nothing is running:** app shows “Attach-only enabled; no gateway to attach”.
- **Wrong port:** Gateway WS defaults to `ws://127.0.0.1:18789`; keep app + CLI on the same port.
- **Where state lives:**
  - Credentials: `~/.clawdis/credentials/`
  - Sessions/logs: `~/.clawdis/sessions/`

## Updating (without wrecking your setup)

- Keep `~/clawd` and `~/.clawdis/` as “your stuff”; don’t put personal prompts/config into the `clawdis` repo.
- Updating source: `git pull` + `pnpm install` (when lockfile changed) + keep using `pnpm gateway:watch`.

## Related docs

- `docs/gateway.md` (Gateway runbook; flags, supervision, ports)
- `docs/configuration.md` (config schema + examples)
- `docs/discord.md`, `docs/slack.md`, and `docs/telegram.md` (reply tags + replyToMode settings)
- `docs/clawd.md` (personal assistant setup)
- `docs/clawdis-mac.md` (macOS app behavior; gateway lifecycle + “Attach only”)
