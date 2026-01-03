export type TelegramForm = {
  token: string;
  requireMention: boolean;
  allowFrom: string;
  proxy: string;
  webhookUrl: string;
  webhookSecret: string;
  webhookPath: string;
};

export type DiscordForm = {
  enabled: boolean;
  token: string;
  dmEnabled: boolean;
  allowFrom: string;
  groupEnabled: boolean;
  groupChannels: string;
  mediaMaxMb: string;
  historyLimit: string;
  textChunkLimit: string;
  replyToMode: "off" | "first" | "all";
  guilds: DiscordGuildForm[];
  actions: DiscordActionForm;
  slashEnabled: boolean;
  slashName: string;
  slashSessionPrefix: string;
  slashEphemeral: boolean;
};

export type DiscordGuildForm = {
  key: string;
  slug: string;
  requireMention: boolean;
  reactionNotifications: "off" | "own" | "all" | "allowlist";
  users: string;
  channels: DiscordGuildChannelForm[];
};

export type DiscordGuildChannelForm = {
  key: string;
  allow: boolean;
  requireMention: boolean;
};

export type DiscordActionForm = {
  reactions: boolean;
  stickers: boolean;
  polls: boolean;
  permissions: boolean;
  messages: boolean;
  threads: boolean;
  pins: boolean;
  search: boolean;
  memberInfo: boolean;
  roleInfo: boolean;
  channelInfo: boolean;
  voiceStatus: boolean;
  events: boolean;
  roles: boolean;
  moderation: boolean;
};

export const defaultDiscordActions: DiscordActionForm = {
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
  channelInfo: true,
  voiceStatus: true,
  events: true,
  roles: false,
  moderation: false,
};

export type SignalForm = {
  enabled: boolean;
  account: string;
  httpUrl: string;
  httpHost: string;
  httpPort: string;
  cliPath: string;
  autoStart: boolean;
  receiveMode: "on-start" | "manual" | "";
  ignoreAttachments: boolean;
  ignoreStories: boolean;
  sendReadReceipts: boolean;
  allowFrom: string;
  mediaMaxMb: string;
};

export type IMessageForm = {
  enabled: boolean;
  cliPath: string;
  dbPath: string;
  service: "auto" | "imessage" | "sms";
  region: string;
  allowFrom: string;
  includeAttachments: boolean;
  mediaMaxMb: string;
};

export type CronFormState = {
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: "at" | "every" | "cron";
  scheduleAt: string;
  everyAmount: string;
  everyUnit: "minutes" | "hours" | "days";
  cronExpr: string;
  cronTz: string;
  sessionTarget: "main" | "isolated";
  wakeMode: "next-heartbeat" | "now";
  payloadKind: "systemEvent" | "agentTurn";
  payloadText: string;
  deliver: boolean;
  channel: "last" | "whatsapp" | "telegram";
  to: string;
  timeoutSeconds: string;
  postToMainPrefix: string;
};
