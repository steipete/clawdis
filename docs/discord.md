---
summary: "Discord bot support status, capabilities, and configuration"
read_when:
  - Working on Discord surface features
---
# Discord (Bot API)

Updated: 2025-12-07

Status: ready for DM and guild text channels via the official Discord bot gateway.

## Goals
- Talk to Clawdis via Discord DMs or guild channels.
- Share the same `main` session used by WhatsApp/Telegram/WebChat; guild channels stay isolated as `discord:group:<channelId>` (display names use `discord:<guildSlug>#<channelSlug>`).
- Group DMs are ignored by default; enable via `discord.dm.groupEnabled` and optionally restrict by `discord.dm.groupChannels`.
- Keep routing deterministic: replies always go back to the surface they arrived on.

## How it works
1. Create a Discord application → Bot, enable the intents you need (DMs + guild messages + message content), and grab the bot token.
2. Invite the bot to your server with the permissions required to read/send messages where you want to use it.
3. Configure Clawdis with `DISCORD_BOT_TOKEN` (or `discord.token` in `~/.clawdis/clawdis.json`).
4. Run the gateway; it auto-starts the Discord provider only when a `discord` config section exists **and** the token is set (unless `discord.enabled = false`).
   - If you prefer env vars, still add `discord: { enabled: true }` to `~/.clawdis/clawdis.json` and set `DISCORD_BOT_TOKEN`.
5. Direct chats: use `user:<id>` (or a `<@id>` mention) when delivering; all turns land in the shared `main` session.
6. Guild channels: use `channel:<channelId>` for delivery. Mentions are required by default and can be set per guild or per channel.
7. Optional DM control: set `discord.dm.enabled = false` to ignore all DMs, or `discord.dm.allowFrom` to allow specific users (ids or names). Use `discord.dm.groupEnabled` + `discord.dm.groupChannels` to allow group DMs.
8. Optional guild rules: set `discord.guilds` keyed by guild id (preferred) or slug, with per-channel rules.
9. Optional slash commands: enable `discord.slashCommand` to accept user-installed app commands (ephemeral replies). Slash invocations respect the same DM/guild allowlists.
10. Optional guild context history: set `discord.historyLimit` (default 20) to include the last N guild messages as context when replying to a mention. Set `0` to disable.
11. Reactions (default on): set `discord.enableReactions = false` to disable agent-triggered reactions via the `clawdis_discord` tool.

Note: Discord does not provide a simple username → id lookup without extra guild context, so prefer ids or `<@id>` mentions for DM delivery targets.
Note: Slugs are lowercase with spaces replaced by `-`. Channel names are slugged without the leading `#`.
Note: Guild context `[from:]` lines include `author.tag` + `id` to make ping-ready replies easy.

## Capabilities & limits
- DMs and guild text channels (threads are treated as separate channels; voice not supported).
- Typing indicators sent best-effort; message chunking honors Discord’s 2k character limit.
- Auto-replies are sent as native replies to the triggering message (first chunk only).
- File uploads supported up to the configured `discord.mediaMaxMb` (default 8 MB).
- Mention-gated guild replies by default to avoid noisy bots.

## Config

```json5
{
  discord: {
    enabled: true,
    token: "abc.123",
    mediaMaxMb: 8,
    enableReactions: true,
    slashCommand: {
      enabled: true,
      name: "clawd",
      sessionPrefix: "discord:slash",
      ephemeral: true
    },
    dm: {
      enabled: true,
      allowFrom: ["123456789012345678", "steipete"],
      groupEnabled: false,
      groupChannels: ["clawd-dm"]
    },
    guilds: {
      "123456789012345678": {
        slug: "friends-of-clawd",
        requireMention: false,
        users: ["987654321098765432", "steipete"],
        channels: {
          general: { allow: true },
          help: { allow: true, requireMention: true }
        }
      }
    }
  }
}
```

- `dm.enabled`: set `false` to ignore all DMs (default `true`).
- `dm.allowFrom`: DM allowlist (user ids or names). Omit or set to `["*"]` to allow any DM sender.
- `dm.groupEnabled`: enable group DMs (default `false`).
- `dm.groupChannels`: optional allowlist for group DM channel ids or slugs.
- `guilds`: per-guild rules keyed by guild id (preferred) or slug.
- `guilds.<id>.slug`: optional friendly slug used for display names.
- `guilds.<id>.users`: optional per-guild user allowlist (ids or names).
- `guilds.<id>.channels`: channel rules (keys are channel slugs or ids).
- `guilds.<id>.requireMention`: per-guild mention requirement (overridable per channel).
- `slashCommand`: optional config for user-installed slash commands (ephemeral responses).
- `mediaMaxMb`: clamp inbound media saved to disk.
- `historyLimit`: number of recent guild messages to include as context when replying to a mention (default 20, `0` disables).
- `enableReactions`: allow agent-triggered reactions via the `clawdis_discord` tool (default `true`).

Slash command notes:
- Register a chat input command in Discord with at least one string option (e.g., `prompt`).
- The first non-empty string option is treated as the prompt.
- Slash commands honor the same allowlists as DMs/guild messages (`discord.dm.allowFrom`, `discord.guilds`, per-channel rules).
- Clawdis will auto-register `/clawd` (or the configured name) if it doesn't already exist.

## Reactions
When `discord.enableReactions = true`, the agent can call `clawdis_discord` with:
- `action: "react"`
- `channelId`, `messageId`, `emoji`

Discord message ids are surfaced in the injected context (`[discord message id: …]` and history lines) so the agent can target them.

## Safety & ops
- Treat the bot token like a password; prefer the `DISCORD_BOT_TOKEN` env var on supervised hosts or lock down the config file permissions.
- Only grant the bot permissions it needs (typically Read/Send Messages).
- If the bot is stuck or rate limited, restart the gateway (`clawdis gateway --force`) after confirming no other processes own the Discord session.
