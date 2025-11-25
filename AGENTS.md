# Repository Guidelines

## Project Structure & Module Organization
- Source code: `src/` (CLI wiring in `src/cli`, commands in `src/commands`, Twilio in `src/twilio`, Web provider in `src/provider-web.ts`, infra in `src/infra`, media pipeline in `src/media`).
- Tests: colocated `*.test.ts` plus e2e in `src/cli/relay.e2e.test.ts`.
- Docs: `docs/` (images, queue, Claude config). Built output lives in `dist/`.

## Build, Test, and Development Commands
- Install deps: `pnpm install`
- Run CLI in dev: `pnpm warelay ...` (tsx entry) or `pnpm dev` for `src/index.ts`.
- Type-check/build: `pnpm build` (tsc)
- Lint/format: `pnpm lint` (biome check), `pnpm format` (biome format)
- Tests: `pnpm test` (vitest); coverage: `pnpm test:coverage`

## Coding Style & Naming Conventions
- Language: TypeScript (ESM). Prefer strict typing; avoid `any`.
- Formatting/linting via Biome; run `pnpm lint` before commits.
- Keep files concise; extract helpers instead of “V2” copies. Use existing patterns for CLI options and dependency injection via `createDefaultDeps`.

## Testing Guidelines
- Framework: Vitest with V8 coverage thresholds (70% lines/branches/functions/statements).
- Naming: match source names with `*.test.ts`; e2e in `*.e2e.test.ts`.
- Run `pnpm test` (or `pnpm test:coverage`) before pushing when you touch logic.

## Commit & Pull Request Guidelines
- Follow concise, action-oriented commit messages (e.g., `CLI: add verbose flag to send`).
- Group related changes; avoid bundling unrelated refactors.
- PRs should summarize scope, note testing performed, and mention any user-facing changes or new flags.

## Security & Configuration Tips
- Environment: copy `.env.example`; set Twilio creds and WhatsApp sender (`TWILIO_WHATSAPP_FROM`).
- Web provider stores creds at `~/.warelay/credentials/`; rerun `warelay login` if logged out.
- Media hosting relies on Tailscale Funnel when using Twilio; use `warelay webhook --ingress tailscale` or `--serve-media` for local hosting.

## Agent-Specific Notes
- If the relay is running in tmux (`warelay-relay`), restart it after code changes: kill pane/session and run `pnpm warelay relay --verbose` inside tmux. Check tmux before editing; keep the watcher healthy if you start it.
