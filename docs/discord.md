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
11. Reactions: the agent can trigger reactions via the `discord` tool (gated by `discord.actions.*`).
    - The `discord` tool is only exposed when the current surface is Discord.
12. Slash commands use isolated session keys (`${sessionPrefix}:${userId}`) rather than the shared `main` session.

Note: Discord does not provide a simple username → id lookup without extra guild context, so prefer ids or `<@id>` mentions for DM delivery targets.
Note: Slugs are lowercase with spaces replaced by `-`. Channel names are slugged without the leading `#`.
Note: Guild context `[from:]` lines include `author.tag` + `id` to make ping-ready replies easy.

## Capabilities & limits
- DMs and guild text channels (threads are treated as separate channels; voice not supported).
- Typing indicators sent best-effort; message chunking honors Discord’s 2k character limit.
- File uploads supported up to the configured `discord.mediaMaxMb` (default 8 MB).
- Mention-gated guild replies by default to avoid noisy bots.
- Reply context is injected when a message references another message (quoted content + ids).
- Native reply threading is **off by default**; enable with `discord.replyToMode` and reply tags.

## Config

```json5
{
  discord: {
    enabled: true,
    token: "abc.123",
    mediaMaxMb: 8,
    actions: {
      reactions: true,
      stickers: true,
      polls: true,
      permissions: true,
      messages: true,
      threads: true,
      pins: true,
      search: true,
      memberInfo: true,
      roleInfo: true,
      roles: false,
      channelInfo: true,
      voiceStatus: true,
      events: true,
      moderation: false
    },
    replyToMode: "off",
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
      "*": { requireMention: true },
      "123456789012345678": {
        slug: "friends-of-clawd",
        requireMention: false,
        reactionNotifications: "allowlist",
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
- `guilds."*"`: default per-guild settings applied when no explicit entry exists.
- `guilds.<id>.slug`: optional friendly slug used for display names.
- `guilds.<id>.users`: optional per-guild user allowlist (ids or names).
- `guilds.<id>.channels`: channel rules (keys are channel slugs or ids).
- `guilds.<id>.requireMention`: per-guild mention requirement (overridable per channel).
- `guilds.<id>.reactionNotifications`: reaction system event mode (`off`, `own`, `all`, `allowlist`).
- `slashCommand`: optional config for user-installed slash commands (ephemeral responses).
- `mediaMaxMb`: clamp inbound media saved to disk.
- `historyLimit`: number of recent guild messages to include as context when replying to a mention (default 20, `0` disables).
- `actions`: per-action tool gates; omit to allow all (set `false` to disable).
  - `reactions` (covers react + read reactions)
  - `stickers`, `polls`, `permissions`, `messages`, `threads`, `pins`, `search`
  - `memberInfo`, `roleInfo`, `channelInfo`, `voiceStatus`, `events`
  - `roles` (role add/remove, default `false`)
  - `moderation` (timeout/kick/ban, default `false`)

Reaction notifications use `guilds.<id>.reactionNotifications`; `allowlist` checks `guilds.<id>.users`, while `all` ignores that allowlist.

### Tool action defaults

| Action group | Default | Notes |
| --- | --- | --- |
| reactions | enabled | React + list reactions + emojiList |
| stickers | enabled | Send stickers |
| polls | enabled | Create polls |
| permissions | enabled | Channel permission snapshot |
| messages | enabled | Read/send/edit/delete |
| threads | enabled | Create/list/reply |
| pins | enabled | Pin/unpin/list |
| search | enabled | Message search (preview spec) |
| memberInfo | enabled | Member info |
| roleInfo | enabled | Role list |
| channelInfo | enabled | Channel info + list |
| voiceStatus | enabled | Voice state lookup |
| events | enabled | List/create scheduled events |
| roles | disabled | Role add/remove |
| moderation | disabled | Timeout/kick/ban |
- `replyToMode`: `off` (default), `first`, or `all`. Applies only when the model includes a reply tag.

## Reply tags
To request a threaded reply, the model can include one tag in its output:
- `[[reply_to_current]]` — reply to the triggering Discord message.
- `[[reply_to:<id>]]` — reply to a specific message id from context/history.
Current message ids are appended to prompts as `[message_id: …]`; history entries already include ids.

Behavior is controlled by `discord.replyToMode`:
- `off`: ignore tags.
- `first`: only the first outbound chunk/attachment is a reply.
- `all`: every outbound chunk/attachment is a reply.

Allowlist matching notes:
- `allowFrom`/`users`/`groupChannels` accept ids, names, tags, or mentions like `<@id>`.
- Prefixes like `discord:`/`user:` (users) and `channel:` (group DMs) are supported.
- Use `*` to allow any sender/channel.
- When `guilds.<id>.channels` is present, channels not listed are denied by default.

Slash command notes:
- Register a chat input command in Discord with at least one string option (e.g., `prompt`).
- The first non-empty string option is treated as the prompt.
- Slash commands honor the same allowlists as DMs/guild messages (`discord.dm.allowFrom`, `discord.guilds`, per-channel rules).
- Clawdis will auto-register `/clawd` (or the configured name) if it doesn't already exist.

## Tool actions
The agent can call `discord` with actions like:
- `react` / `reactions` (add or list reactions)
- `sticker`, `poll`, `permissions`
- `readMessages`, `sendMessage`, `editMessage`, `deleteMessage`
- `threadCreate`, `threadList`, `threadReply`
- `pinMessage`, `unpinMessage`, `listPins`
- `searchMessages`, `memberInfo`, `roleInfo`, `roleAdd`, `roleRemove`, `emojiList`
- `channelInfo`, `channelList`, `voiceStatus`, `eventList`, `eventCreate`
- `timeout`, `kick`, `ban`

Discord message ids are surfaced in the injected context (`[discord message id: …]` and history lines) so the agent can target them.
Emoji can be unicode (e.g., `✅`) or custom emoji syntax like `<:party_blob:1234567890>`.

## Safety & ops
- Treat the bot token like a password; prefer the `DISCORD_BOT_TOKEN` env var on supervised hosts or lock down the config file permissions.
- Only grant the bot permissions it needs (typically Read/Send Messages).
- If the bot is stuck or rate limited, restart the gateway (`clawdis gateway --force`) after confirming no other processes own the Discord session.
