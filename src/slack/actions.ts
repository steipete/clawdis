import { WebClient } from "@slack/web-api";

import { loadConfig } from "../config/config.js";
import { sendMessageSlack } from "./send.js";
import { resolveSlackBotToken } from "./token.js";

export type SlackActionClientOpts = {
  token?: string;
  client?: WebClient;
};

export type SlackMessageSummary = {
  ts?: string;
  text?: string;
  user?: string;
  thread_ts?: string;
  reply_count?: number;
  reactions?: Array<{
    name?: string;
    count?: number;
    users?: string[];
  }>;
};

export type SlackPin = {
  type?: string;
  message?: { ts?: string; text?: string };
  file?: { id?: string; name?: string };
};

function resolveToken(explicit?: string) {
  const cfgToken = loadConfig().slack?.botToken;
  const token = resolveSlackBotToken(
    explicit ?? process.env.SLACK_BOT_TOKEN ?? cfgToken ?? undefined,
  );
  if (!token) {
    throw new Error(
      "SLACK_BOT_TOKEN or slack.botToken is required for Slack actions",
    );
  }
  return token;
}

function normalizeEmoji(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Emoji is required for Slack reactions");
  }
  return trimmed.replace(/^:+|:+$/g, "");
}

async function getClient(opts: SlackActionClientOpts = {}) {
  const token = resolveToken(opts.token);
  return opts.client ?? new WebClient(token);
}

export async function reactSlackMessage(
  channelId: string,
  messageId: string,
  emoji: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.reactions.add({
    channel: channelId,
    timestamp: messageId,
    name: normalizeEmoji(emoji),
  });
}

export async function listSlackReactions(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
): Promise<SlackMessageSummary["reactions"]> {
  const client = await getClient(opts);
  const result = await client.reactions.get({
    channel: channelId,
    timestamp: messageId,
    full: true,
  });
  const message = result.message as SlackMessageSummary | undefined;
  return message?.reactions ?? [];
}

export async function sendSlackMessage(
  to: string,
  content: string,
  opts: SlackActionClientOpts & { mediaUrl?: string; replyTo?: string } = {},
) {
  return await sendMessageSlack(to, content, {
    token: opts.token,
    mediaUrl: opts.mediaUrl,
    threadTs: opts.replyTo,
    client: opts.client,
  });
}

export async function editSlackMessage(
  channelId: string,
  messageId: string,
  content: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.chat.update({
    channel: channelId,
    ts: messageId,
    text: content,
  });
}

export async function deleteSlackMessage(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.chat.delete({
    channel: channelId,
    ts: messageId,
  });
}

export async function readSlackMessages(
  channelId: string,
  opts: SlackActionClientOpts & {
    limit?: number;
    before?: string;
    after?: string;
  } = {},
): Promise<{ messages: SlackMessageSummary[]; hasMore: boolean }> {
  const client = await getClient(opts);
  const result = await client.conversations.history({
    channel: channelId,
    limit: opts.limit,
    latest: opts.before,
    oldest: opts.after,
  });
  return {
    messages: (result.messages ?? []) as SlackMessageSummary[],
    hasMore: Boolean(result.has_more),
  };
}

async function resolveChannelName(
  client: WebClient,
  channelId: string,
): Promise<string | null> {
  try {
    const info = await client.conversations.info({ channel: channelId });
    const name =
      info.channel && "name" in info.channel ? info.channel.name : undefined;
    return name ? String(name) : null;
  } catch {
    return null;
  }
}

export async function searchSlackMessages(
  query: string,
  opts: SlackActionClientOpts & {
    limit?: number;
    channelIds?: string[];
    channelNames?: string[];
  } = {},
): Promise<{ matches: SlackMessageSummary[]; total: number }> {
  const client = await getClient(opts);
  const channelFilters: string[] = [];
  if (Array.isArray(opts.channelNames)) {
    for (const name of opts.channelNames) {
      const trimmed = name.trim();
      if (trimmed) channelFilters.push(`in:#${trimmed.replace(/^#/, "")}`);
    }
  }
  if (Array.isArray(opts.channelIds)) {
    for (const id of opts.channelIds) {
      const trimmed = id.trim();
      if (!trimmed) continue;
      const name = await resolveChannelName(client, trimmed);
      if (name) channelFilters.push(`in:#${name}`);
      else channelFilters.push(`in:${trimmed}`);
    }
  }
  const combinedQuery =
    channelFilters.length > 0
      ? `${query} (${channelFilters.join(" OR ")})`
      : query;
  const result = await client.search.messages({
    query: combinedQuery,
    count: opts.limit,
  });
  const messages = result.messages;
  return {
    matches: (messages?.matches ?? []) as SlackMessageSummary[],
    total: messages?.total ?? 0,
  };
}

export async function getSlackChannelInfo(
  channelId: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  return await client.conversations.info({ channel: channelId });
}

export async function listSlackChannels(
  opts: SlackActionClientOpts & { limit?: number; cursor?: string } = {},
) {
  const client = await getClient(opts);
  return await client.conversations.list({
    limit: opts.limit,
    cursor: opts.cursor,
  });
}

export async function getSlackMemberInfo(
  userId: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  return await client.users.info({ user: userId });
}

export async function listSlackEmojis(opts: SlackActionClientOpts = {}) {
  const client = await getClient(opts);
  return await client.emoji.list();
}

export async function pinSlackMessage(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.pins.add({ channel: channelId, timestamp: messageId });
}

export async function unpinSlackMessage(
  channelId: string,
  messageId: string,
  opts: SlackActionClientOpts = {},
) {
  const client = await getClient(opts);
  await client.pins.remove({ channel: channelId, timestamp: messageId });
}

export async function listSlackPins(
  channelId: string,
  opts: SlackActionClientOpts = {},
): Promise<SlackPin[]> {
  const client = await getClient(opts);
  const result = await client.pins.list({ channel: channelId });
  return (result.items ?? []) as SlackPin[];
}
