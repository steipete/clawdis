# Slack (socket mode)

## Setup
1) Create a Slack app (From scratch) in https://api.slack.com/apps.
2) Enable **Socket Mode** and create an **App Token** (`xapp-...`).
3) OAuth & Permissions → add scopes, then install the app to your workspace to get the **Bot Token** (`xoxb-...`).
4) Event Subscriptions → enable events and subscribe to:
   - `message.*` (includes edits/deletes/thread broadcasts)
   - `app_mention`
   - `reaction_added`, `reaction_removed`
   - `member_joined_channel`, `member_left_channel`
   - `channel_rename`, `channel_topic`, `channel_purpose`
   - `pin_added`, `pin_removed`
5) Invite the bot to channels you want it to read.
6) Slash Commands → create the `/clawd` command (or your preferred name).

Recommended scopes:
- `chat:write`
- `channels:history`, `groups:history`, `im:history`, `mpim:history`
- `conversations:read`
- `users:read`
- `app_mentions:read`
- `reactions:read`
- `files:read`, `files:write` (optional, for attachments)

## Config
Slack uses Socket Mode only (no HTTP webhook server). Provide both tokens:

```json
{
  "slack": {
    "enabled": true,
    "botToken": "xoxb-...",
    "appToken": "xapp-...",
    "dm": {
      "enabled": true,
      "allowFrom": ["U123", "U456", "*"],
      "groupEnabled": false,
      "groupChannels": ["G123"]
    },
    "channels": {
      "C123": { "allow": true, "requireMention": true },
      "#general": { "allow": true, "requireMention": false }
    },
    "reactionNotifications": "own",
    "reactionAllowlist": ["U123"],
    "actions": {
      "reactions": true,
      "messages": true,
      "pins": true,
      "search": true,
      "permissions": true,
      "memberInfo": true,
      "channelInfo": true,
      "emojiList": true
    },
    "slashCommand": {
      "enabled": true,
      "name": "clawd",
      "sessionPrefix": "slack:slash",
      "ephemeral": true
    },
    "replyToMode": "off",
    "textChunkLimit": 4000,
    "mediaMaxMb": 20
  }
}
```

Tokens can also be supplied via env vars:
- `SLACK_BOT_TOKEN`
- `SLACK_APP_TOKEN`

## Sessions + routing
- DMs share the `main` session (like WhatsApp/Telegram).
- Channels map to `slack:channel:<channelId>` sessions.
- Slash commands use `slack:slash:<userId>` sessions.

## Reply threading
Slack replies can be threaded when reply tags are present and `slack.replyToMode` is enabled.

```json
{ "slack": { "replyToMode": "first" } }
```

## Delivery targets
Use these with cron/CLI sends:
- `user:<id>` for DMs
- `channel:<id>` for channels

## Tool actions
Slack tool actions can be gated with `slack.actions.*`:

| Action group | Default | Notes |
| --- | --- | --- |
| reactions | enabled | React + list reactions |
| messages | enabled | Read/send/edit/delete |
| pins | enabled | Pin/unpin/list |
| search | enabled | Message search |
| permissions | enabled | Channel permission snapshot |
| memberInfo | enabled | Member info |
| channelInfo | enabled | Channel info + list |
| emojiList | enabled | Custom emoji list |

## Notes
- Mention gating is controlled via `slack.channels` (set `requireMention` to `true`).
- Reaction notifications follow `slack.reactionNotifications` (use `reactionAllowlist` with mode `allowlist`).
- Attachments are downloaded to the media store when permitted and under the size limit.
