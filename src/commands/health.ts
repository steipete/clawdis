import { loadConfig } from "../config/config.js";
import { loadSessionStore, resolveStorePath } from "../config/sessions.js";
import { type DiscordProbe, probeDiscord } from "../discord/probe.js";
import { callGateway } from "../gateway/call.js";
import { info } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";
import { probeSlack, type SlackProbe } from "../slack/probe.js";
import { probeTelegram, type TelegramProbe } from "../telegram/probe.js";
import { resolveTelegramToken } from "../telegram/token.js";
import { resolveHeartbeatSeconds } from "../web/reconnect.js";
import {
  getWebAuthAgeMs,
  logWebSelfId,
  webAuthExists,
} from "../web/session.js";

export type HealthSummary = {
  /**
   * Convenience top-level flag for UIs (e.g. WebChat) that only need a binary
   * "can talk to the gateway" signal. If this payload exists, the gateway RPC
   * succeeded, so this is always `true`.
   */
  ok: true;
  ts: number;
  durationMs: number;
  web: {
    linked: boolean;
    authAgeMs: number | null;
    connect?: {
      ok: boolean;
      status?: number | null;
      error?: string | null;
      elapsedMs?: number | null;
    };
  };
  telegram: {
    configured: boolean;
    probe?: TelegramProbe;
  };
  discord: {
    configured: boolean;
    probe?: DiscordProbe;
  };
  slack: {
    configured: boolean;
    probe?: SlackProbe;
  };
  heartbeatSeconds: number;
  sessions: {
    path: string;
    count: number;
    recent: Array<{
      key: string;
      updatedAt: number | null;
      age: number | null;
    }>;
  };
};

const DEFAULT_TIMEOUT_MS = 10_000;

export async function getHealthSnapshot(
  timeoutMs?: number,
): Promise<HealthSummary> {
  const cfg = loadConfig();
  const linked = await webAuthExists();
  const authAgeMs = getWebAuthAgeMs();
  const heartbeatSeconds = resolveHeartbeatSeconds(cfg, undefined);
  const storePath = resolveStorePath(cfg.session?.store);
  const store = loadSessionStore(storePath);
  const sessions = Object.entries(store)
    .filter(([key]) => key !== "global" && key !== "unknown")
    .map(([key, entry]) => ({ key, updatedAt: entry?.updatedAt ?? 0 }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const recent = sessions.slice(0, 5).map((s) => ({
    key: s.key,
    updatedAt: s.updatedAt || null,
    age: s.updatedAt ? Date.now() - s.updatedAt : null,
  }));

  const start = Date.now();
  const cappedTimeout = Math.max(1000, timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const { token: telegramToken } = resolveTelegramToken(cfg);
  const telegramConfigured = telegramToken.trim().length > 0;
  const telegramProxy = cfg.telegram?.proxy;
  const telegramProbe = telegramConfigured
    ? await probeTelegram(telegramToken.trim(), cappedTimeout, telegramProxy)
    : undefined;

  const discordToken =
    process.env.DISCORD_BOT_TOKEN ?? cfg.discord?.token ?? "";
  const discordConfigured = discordToken.trim().length > 0;
  const discordProbe = discordConfigured
    ? await probeDiscord(discordToken.trim(), cappedTimeout)
    : undefined;

  const slackBotToken =
    process.env.SLACK_BOT_TOKEN ?? cfg.slack?.botToken ?? "";
  const slackAppToken =
    process.env.SLACK_APP_TOKEN ?? cfg.slack?.appToken ?? "";
  const slackConfigured =
    slackBotToken.trim().length > 0 && slackAppToken.trim().length > 0;
  const slackProbe = slackConfigured
    ? await probeSlack(slackBotToken.trim(), cappedTimeout)
    : undefined;

  const summary: HealthSummary = {
    ok: true,
    ts: Date.now(),
    durationMs: Date.now() - start,
    web: { linked, authAgeMs },
    telegram: { configured: telegramConfigured, probe: telegramProbe },
    discord: { configured: discordConfigured, probe: discordProbe },
    slack: { configured: slackConfigured, probe: slackProbe },
    heartbeatSeconds,
    sessions: {
      path: storePath,
      count: sessions.length,
      recent,
    },
  };

  return summary;
}

export async function healthCommand(
  opts: { json?: boolean; timeoutMs?: number },
  runtime: RuntimeEnv,
) {
  // Always query the running gateway; do not open a direct Baileys socket here.
  const summary = await callGateway<HealthSummary>({
    method: "health",
    timeoutMs: opts.timeoutMs,
  });
  // Gateway reachability defines success; provider issues are reported but not fatal here.
  const fatal = false;

  if (opts.json) {
    runtime.log(JSON.stringify(summary, null, 2));
  } else {
    runtime.log(
      summary.web.linked
        ? `Web: linked (auth age ${summary.web.authAgeMs ? `${Math.round(summary.web.authAgeMs / 60000)}m` : "unknown"})`
        : "Web: not linked (run clawdis login)",
    );
    if (summary.web.linked) {
      logWebSelfId(runtime, true);
    }
    if (summary.web.connect) {
      const base = summary.web.connect.ok
        ? info(`Connect: ok (${summary.web.connect.elapsedMs}ms)`)
        : `Connect: failed (${summary.web.connect.status ?? "unknown"})`;
      runtime.log(
        base +
          (summary.web.connect.error ? ` - ${summary.web.connect.error}` : ""),
      );
    }

    const tgLabel = summary.telegram.configured
      ? summary.telegram.probe?.ok
        ? info(
            `Telegram: ok${summary.telegram.probe.bot?.username ? ` (@${summary.telegram.probe.bot.username})` : ""} (${summary.telegram.probe.elapsedMs}ms)` +
              (summary.telegram.probe.webhook?.url
                ? ` - webhook ${summary.telegram.probe.webhook.url}`
                : ""),
          )
        : `Telegram: failed (${summary.telegram.probe?.status ?? "unknown"})${summary.telegram.probe?.error ? ` - ${summary.telegram.probe.error}` : ""}`
      : "Telegram: not configured";
    runtime.log(tgLabel);

    const discordLabel = summary.discord.configured
      ? summary.discord.probe?.ok
        ? info(
            `Discord: ok${summary.discord.probe.bot?.username ? ` (@${summary.discord.probe.bot.username})` : ""} (${summary.discord.probe.elapsedMs}ms)`,
          )
        : `Discord: failed (${summary.discord.probe?.status ?? "unknown"})${summary.discord.probe?.error ? ` - ${summary.discord.probe.error}` : ""}`
      : "Discord: not configured";
    runtime.log(discordLabel);

    const slackLabel = summary.slack.configured
      ? summary.slack.probe?.ok
        ? info(
            `Slack: ok${summary.slack.probe.team?.name ? ` (${summary.slack.probe.team.name})` : ""} (${summary.slack.probe.elapsedMs}ms)`,
          )
        : `Slack: failed (${summary.slack.probe?.status ?? "unknown"})${summary.slack.probe?.error ? ` - ${summary.slack.probe.error}` : ""}`
      : "Slack: not configured";
    runtime.log(slackLabel);

    runtime.log(info(`Heartbeat interval: ${summary.heartbeatSeconds}s`));
    runtime.log(
      info(
        `Session store: ${summary.sessions.path} (${summary.sessions.count} entries)`,
      ),
    );
    if (summary.sessions.recent.length > 0) {
      runtime.log("Recent sessions:");
      for (const r of summary.sessions.recent) {
        runtime.log(
          `- ${r.key} (${r.updatedAt ? `${Math.round((Date.now() - r.updatedAt) / 60000)}m ago` : "no activity"})`,
        );
      }
    }
  }

  if (fatal) {
    runtime.exit(1);
  }
}
