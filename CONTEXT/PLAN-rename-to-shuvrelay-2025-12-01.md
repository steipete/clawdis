# Plan: Rename warelay → shuvrelay

**Goal:** Rebrand the project from "warelay" to "shuvrelay", update all documentation, npm namespace, CLI binary names, and break the link with the upstream fork.

**Status:** Planning phase

---

## Summary

This plan covers renaming the project from `warelay` to `shuvrelay` across:
- Package identity (npm namespace, binary names)
- CLI branding and help text
- Configuration directories and files
- All documentation
- Git remote/fork relationship
- Internal code references

---

## Phase 1: Package Identity & Build Configuration

### 1.1 package.json
- [ ] Change `"name"` from `"warelay"` to `"shuvrelay"`
- [ ] Update `"description"` to personalize (optional)
- [ ] Update `"bin"` entries:
  - `"shuvrelay": "bin/shuvrelay.js"` (primary, only binary)
  - Remove `"warely"` alias
  - Remove `"wa"` alias
- [ ] Update `"scripts"`:
  - `"shuvrelay": "tsx src/index.ts"` (replaces `warelay`)
  - Remove `"warely"` script
  - Remove `"wa"` script
- [ ] Update `"repository"` URL to your GitHub repo
- [ ] Update `"author"` field

### 1.2 Binary Entry Point
- [ ] Rename `bin/warelay.js` → `bin/shuvrelay.js`
- [ ] Update import path inside if necessary (currently imports `../dist/index.js` - should still work)

---

## Phase 2: CLI Branding & Help Text

### 2.1 src/cli/program.ts (Main CLI Definition)
- [ ] Change `.name("warelay")` → `.name("shuvrelay")`
- [ ] Update `TAGLINE` if desired
- [ ] Update `formatIntroLine()` to show `📡 shuvrelay` instead of `📡 warelay`
- [ ] Update all example commands in `addHelpText()`:
  - `warelay login` → `shuvrelay login`
  - `warelay send` → `shuvrelay send`
  - `warelay relay` → `shuvrelay relay`
  - `warelay webhook` → `shuvrelay webhook`
  - `warelay status` → `shuvrelay status`
  - `warelay heartbeat` → `shuvrelay heartbeat`
- [ ] Update error messages referencing CLI commands (e.g., "Run: warelay login")

### 2.2 src/cli/relay_tmux.ts
- [ ] Change `SESSION = "warelay-relay"` → `SESSION = "shuvrelay-relay"`
- [ ] Update default command from `"pnpm warelay relay --verbose"` → `"pnpm shuvrelay relay --verbose"`

### 2.3 src/index.ts
- [ ] Update error message prefixes from `"[warelay]"` → `"[shuvrelay]"`

---

## Phase 3: Configuration Paths & Directories

### 3.1 Config Directory (~/.warelay → ~/.shuvrelay)
Files that define paths:

- [ ] **src/utils.ts**: Change `CONFIG_DIR = "${os.homedir()}/.warelay"` → `.shuvrelay`
- [ ] **src/config/config.ts**: Change `CONFIG_PATH` from `~/.warelay/warelay.json` → `~/.shuvrelay/shuvrelay.json`
- [ ] **src/media/store.ts**: Change `MEDIA_DIR` from `~/.warelay/media` → `~/.shuvrelay/media`
- [ ] **src/web/session.ts**: Change credentials path from `".warelay"` → `".shuvrelay"`
- [ ] **src/logging.ts**: Update default log path from `/tmp/warelay/` → `/tmp/shuvrelay/`

### 3.2 Config File Name
- [ ] Update references to `warelay.json` → `shuvrelay.json` in:
  - `src/config/config.ts`
  - Documentation
  - Comments

### 3.3 Session Storage
- [ ] **src/config/sessions.ts**: `SESSION_STORE_DEFAULT` uses `CONFIG_DIR` which will auto-update
- [ ] Update any docs referencing `~/.warelay/sessions.json`

### 3.4 Migration Note
- [ ] Add migration instructions for users moving from warelay to shuvrelay (copy ~/.warelay to ~/.shuvrelay)

---

## Phase 4: Internal Code References

### 4.1 Error Messages & Logging
Files with `warelay` in strings:

- [ ] **src/index.ts**: `"[warelay] Unhandled promise rejection"` → `"[shuvrelay]"`
- [ ] **src/twilio/webhook.ts**: `"warelay webhook: not found"` → `"shuvrelay webhook: not found"`
- [ ] **src/infra/ports.ts**: `"another warelay instance"` → `"another shuvrelay instance"`
- [ ] **src/infra/tailscale.ts**: Update fallback command example
- [ ] **src/media/host.ts**: Update error message referencing `warelay webhook`
- [ ] **src/web/session.ts**: Update "warelay/cli/VERSION" user agent → "shuvrelay/cli/VERSION"
- [ ] **src/web/auto-reply.ts**: Update `"[warelay]"` default message prefix → `"[shuvrelay]"`
- [ ] **src/web/login.ts**: Update rerun message

### 4.2 Symbol Names (Internal Markers)
- [ ] **src/web/test-helpers.ts**: `Symbol.for("warelay:lastSocket")` → `Symbol.for("shuvrelay:lastSocket")`

### 4.3 Comments & Documentation Strings
- [ ] **src/version.ts**: Update comment
- [ ] **src/auto-reply/claude.ts**: Update default system prompt (references warelay)
- [ ] **src/config/config.ts**: Update inline comments

---

## Phase 5: Test Files

### 5.1 Test Temporary Directories
Update all temp directory prefixes from `warelay-` to `shuvrelay-`:

- [ ] src/web/auto-reply.test.ts
- [ ] src/web/logout.test.ts
- [ ] src/web/monitor-inbox.test.ts
- [ ] src/web/media.test.ts
- [ ] src/web/inbound.media.test.ts
- [ ] src/utils.test.ts
- [ ] src/media/store.test.ts
- [ ] src/logger.test.ts
- [ ] src/index.core.test.ts
- [ ] src/auto-reply/transcription.test.ts
- [ ] src/auto-reply/command-reply.test.ts
- [ ] src/cli/relay_tmux.test.ts
- [ ] src/cli/program.test.ts

---

## Phase 6: Documentation

### 6.1 README.md (Complete Rewrite)
- [ ] Replace all `warelay` → `shuvrelay` in CLI examples
- [ ] Update npm install command: `npm install -g shuvrelay`
- [ ] Update GitHub badge URLs to your repo
- [ ] Update npm badge to new package name
- [ ] Remove/update references to @steipete and upstream project
- [ ] Update header image if desired (README-header.png)
- [ ] Update repository links

### 6.2 AGENTS.md
- [ ] Update "What is Warelay?" → "What is Shuvrelay?"
- [ ] Replace all CLI examples
- [ ] Update config paths (`~/.warelay` → `~/.shuvrelay`)
- [ ] Update tmux session name reference
- [ ] Remove references to upstream repo guidelines

### 6.3 CHANGELOG.md
- [ ] Add entry for renaming
- [ ] Consider starting fresh or keeping history with note

### 6.4 docs/clawd.md
- [ ] Replace all `warelay` → `shuvrelay` (or consider personalizing for your use case)
- [ ] Update or remove @steipete references
- [ ] Update example configs

### 6.5 docs/RELEASING.md
- [ ] Update all `warelay` references → `shuvrelay`
- [ ] Update npm package name
- [ ] Update version check command

### 6.6 Other docs (docs/*.md)
Review and update:
- [ ] docs/audio.md
- [ ] docs/heartbeat.md
- [ ] docs/images.md
- [ ] docs/queue.md
- [ ] docs/tmux.md
- [ ] docs/refactor/web-relay-troubleshooting.md

### 6.7 .env.example
- [ ] Update comments if any reference warelay

---

## Phase 7: Git & Repository

### 7.1 Break Fork Relationship
- [ ] Remove upstream remote if set:
  ```bash
  git remote remove upstream  # if exists
  ```
- [ ] Update origin to your canonical repo:
  ```bash
  git remote set-url origin git@github.com:yourusername/shuvrelay.git
  ```

### 7.2 Repository Rename (GitHub)
- [ ] Rename repository on GitHub: Settings → Repository name → `shuvrelay`
- [ ] Update local remote URLs after rename

### 7.3 Optional: Detach History
If you want a completely fresh start:
- [ ] Consider squashing history or creating orphan branch
- [ ] Alternative: Keep history but add clear note in CHANGELOG about the fork

---

## Phase 8: CI/CD & Publishing

### 8.1 GitHub Actions (.github/workflows/ci.yml)
- [ ] No changes needed to workflow itself (it's generic)
- [ ] Consider adding npm publish workflow if desired

### 8.2 npm Publishing
- [ ] Verify npm namespace is available: `npm view shuvrelay`
- [ ] If not, choose alternative (e.g., `@shuv/relay`, `shuv-relay`)
- [ ] Update package.json name accordingly
- [ ] First publish: `npm publish --access public`

---

## Phase 9: Validation & Testing

### 9.1 Build Verification
- [ ] Run `pnpm build` - should complete without errors
- [ ] Verify `dist/` output references updated

### 9.2 Test Suite
- [ ] Run `pnpm test` - all tests should pass
- [ ] Run `pnpm test:coverage` - verify coverage thresholds

### 9.3 Lint/Format
- [ ] Run `pnpm lint` - no errors
- [ ] Run `pnpm format` - all files formatted

### 9.4 CLI Verification
- [ ] Test `pnpm shuvrelay --help` shows new branding
- [ ] Test `pnpm shuvrelay --version` shows version

### 9.5 Config Path Verification
- [ ] Verify CLI looks for config in `~/.shuvrelay/shuvrelay.json`
- [ ] Verify credentials path is `~/.shuvrelay/credentials/`
- [ ] Verify media path is `~/.shuvrelay/media/`
- [ ] Verify log path is `/tmp/shuvrelay/shuvrelay.log`

---

## Implementation Order

Recommended sequence to minimize breakage:

1. **Phase 7.1**: Remove upstream remote (safe, no code changes)
2. **Phase 1**: Package identity (package.json, bin/)
3. **Phase 3**: Configuration paths (breaking change for existing users)
4. **Phase 2**: CLI branding
5. **Phase 4**: Internal code references
6. **Phase 5**: Test files
7. **Phase 6**: Documentation
8. **Phase 9**: Validation
9. **Phase 7.2-7.3**: Repository operations
10. **Phase 8**: Publishing

---

## Rollback Plan

If issues are discovered:
1. All changes are in git - can revert commits
2. npm packages can be deprecated/unpublished within 72 hours
3. Keep a branch with the old `warelay` naming as backup

---

## Post-Rename Checklist

- [ ] Update any external references (personal docs, scripts)
- [ ] If previously installed globally as `warelay`, uninstall: `npm uninstall -g warelay`
- [ ] Install new version: `npm install -g shuvrelay`
- [ ] Migrate config: `cp -r ~/.warelay ~/.shuvrelay`
- [ ] Rename config file: `mv ~/.shuvrelay/warelay.json ~/.shuvrelay/shuvrelay.json`
- [ ] Update any systemd/launchd services referencing old paths/names
- [ ] Update tmux scripts if any reference `warelay-relay` session

---

## Files Summary

### Files requiring changes (by category):

**Package/Build (3 files):**
- package.json
- bin/warelay.js → bin/shuvrelay.js

**CLI (3 files):**
- src/cli/program.ts
- src/cli/relay_tmux.ts
- src/index.ts

**Config Paths (5 files):**
- src/utils.ts
- src/config/config.ts
- src/config/sessions.ts (uses CONFIG_DIR)
- src/media/store.ts
- src/web/session.ts
- src/logging.ts

**Internal References (8 files):**
- src/twilio/webhook.ts
- src/infra/ports.ts
- src/infra/tailscale.ts
- src/media/host.ts
- src/web/auto-reply.ts
- src/web/login.ts
- src/web/test-helpers.ts
- src/auto-reply/claude.ts
- src/version.ts

**Test Files (13 files):**
- All *.test.ts files with temp directory prefixes

**Documentation (11 files):**
- README.md
- AGENTS.md
- CHANGELOG.md
- docs/clawd.md
- docs/RELEASING.md
- docs/audio.md
- docs/heartbeat.md
- docs/images.md
- docs/queue.md
- docs/tmux.md
- docs/refactor/web-relay-troubleshooting.md

**Estimated Total: ~45 files**

---

## Notes

- The WebSocket/Baileys user-agent string should be updated to `shuvrelay/cli/VERSION`
- The default message prefix `[warelay]` for unknown senders should become `[shuvrelay]`
- The Clawd system prompt in `src/auto-reply/claude.ts` references warelay - consider personalizing
- Some test mock data may need updating if it contains `warelay` strings

---

*Plan created: 2025-12-01*
*Status: Ready for implementation*
