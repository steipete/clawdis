import { lookupContextTokens } from "../agents/context.js";
import {
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
} from "../agents/defaults.js";
import { resolveConfiguredModelRef } from "../agents/model-selection.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveStorePath,
  type SessionEntry,
} from "../config/sessions.js";
import { callGateway } from "../gateway/call.js";
import { info } from "../globals.js";
import { buildProviderSummary } from "../infra/provider-summary.js";
import { peekSystemEvents } from "../infra/system-events.js";
import type { RuntimeEnv } from "../runtime.js";
import { resolveHeartbeatSeconds } from "../web/reconnect.js";
import {
  getWebAuthAgeMs,
  logWebSelfId,
  webAuthExists,
} from "../web/session.js";
import type { HealthSummary } from "./health.js";

export type SessionStatus = {
  key: string;
  kind: "direct" | "group" | "global" | "unknown";
  sessionId?: string;
  updatedAt: number | null;
  age: number | null;
  thinkingLevel?: string;
  verboseLevel?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number | null;
  remainingTokens: number | null;
  percentUsed: number | null;
  model: string | null;
  contextTokens: number | null;
  flags: string[];
};

export type StatusSummary = {
  web: { linked: boolean; authAgeMs: number | null };
  heartbeatSeconds: number;
  providerSummary: string[];
  queuedSystemEvents: string[];
  sessions: {
    path: string;
    count: number;
    defaults: { model: string | null; contextTokens: number | null };
    recent: SessionStatus[];
  };
};

export async function getStatusSummary(): Promise<StatusSummary> {
  const cfg = loadConfig();
  const linked = await webAuthExists();
  const authAgeMs = getWebAuthAgeMs();
  const heartbeatSeconds = resolveHeartbeatSeconds(cfg, undefined);
  const providerSummary = await buildProviderSummary(cfg);
  const queuedSystemEvents = peekSystemEvents();

  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const configModel = resolved.model ?? DEFAULT_MODEL;
  const configContextTokens =
    cfg.agent?.contextTokens ??
    lookupContextTokens(configModel) ??
    DEFAULT_CONTEXT_TOKENS;

  const storePath = resolveStorePath(cfg.session?.store);
  const store = loadSessionStore(storePath);
  const now = Date.now();
  const sessions = Object.entries(store)
    .filter(([key]) => key !== "global" && key !== "unknown")
    .map(([key, entry]) => {
      const updatedAt = entry?.updatedAt ?? null;
      const age = updatedAt ? now - updatedAt : null;
      const model = entry?.model ?? configModel ?? null;
      const contextTokens =
        entry?.contextTokens ??
        lookupContextTokens(model) ??
        configContextTokens ??
        null;
      const input = entry?.inputTokens ?? 0;
      const output = entry?.outputTokens ?? 0;
      const total = entry?.totalTokens ?? input + output;
      const remaining =
        contextTokens != null ? Math.max(0, contextTokens - total) : null;
      const pct =
        contextTokens && contextTokens > 0
          ? Math.min(999, Math.round((total / contextTokens) * 100))
          : null;

      return {
        key,
        kind: classifyKey(key, entry),
        sessionId: entry?.sessionId,
        updatedAt,
        age,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        systemSent: entry?.systemSent,
        abortedLastRun: entry?.abortedLastRun,
        inputTokens: entry?.inputTokens,
        outputTokens: entry?.outputTokens,
        totalTokens: total ?? null,
        remainingTokens: remaining,
        percentUsed: pct,
        model,
        contextTokens,
        flags: buildFlags(entry),
      } satisfies SessionStatus;
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const recent = sessions.slice(0, 5);

  return {
    web: { linked, authAgeMs },
    heartbeatSeconds,
    providerSummary,
    queuedSystemEvents,
    sessions: {
      path: storePath,
      count: sessions.length,
      defaults: {
        model: configModel ?? null,
        contextTokens: configContextTokens ?? null,
      },
      recent,
    },
  };
}

const formatKTokens = (value: number) =>
  `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;

const formatAge = (ms: number | null | undefined) => {
  if (!ms || ms < 0) return "unknown";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
};

const formatContextUsage = (
  total: number | null | undefined,
  contextTokens: number | null | undefined,
  remaining: number | null | undefined,
  pct: number | null | undefined,
) => {
  const used = total ?? 0;
  if (!contextTokens) {
    return `tokens: ${formatKTokens(used)} used (ctx unknown)`;
  }
  const left = remaining ?? Math.max(0, contextTokens - used);
  const pctLabel = pct != null ? `${pct}%` : "?%";
  return `tokens: ${formatKTokens(used)} used, ${formatKTokens(left)} left of ${formatKTokens(contextTokens)} (${pctLabel})`;
};

const classifyKey = (
  key: string,
  entry?: SessionEntry,
): SessionStatus["kind"] => {
  if (key === "global") return "global";
  if (key === "unknown") return "unknown";
  if (entry?.chatType === "group" || entry?.chatType === "room") return "group";
  if (
    key.startsWith("group:") ||
    key.includes(":group:") ||
    key.includes(":channel:")
  ) {
    return "group";
  }
  return "direct";
};

const buildFlags = (entry: SessionEntry): string[] => {
  const flags: string[] = [];
  const think = entry?.thinkingLevel;
  if (typeof think === "string" && think.length > 0)
    flags.push(`think:${think}`);
  const verbose = entry?.verboseLevel;
  if (typeof verbose === "string" && verbose.length > 0)
    flags.push(`verbose:${verbose}`);
  if (entry?.systemSent) flags.push("system");
  if (entry?.abortedLastRun) flags.push("aborted");
  const sessionId = entry?.sessionId as unknown;
  if (typeof sessionId === "string" && sessionId.length > 0)
    flags.push(`id:${sessionId}`);
  return flags;
};

export async function statusCommand(
  opts: { json?: boolean; deep?: boolean; timeoutMs?: number },
  runtime: RuntimeEnv,
) {
  const summary = await getStatusSummary();
  const health: HealthSummary | undefined = opts.deep
    ? await callGateway<HealthSummary>({
        method: "health",
        timeoutMs: opts.timeoutMs,
      })
    : undefined;

  if (opts.json) {
    runtime.log(
      JSON.stringify(health ? { ...summary, health } : summary, null, 2),
    );
    return;
  }

  runtime.log(
    `Web session: ${summary.web.linked ? "linked" : "not linked"}${summary.web.linked ? ` (last refreshed ${formatAge(summary.web.authAgeMs)})` : ""}`,
  );
  if (summary.web.linked) {
    logWebSelfId(runtime, true);
  }
  runtime.log(info("System:"));
  for (const line of summary.providerSummary) {
    runtime.log(`  ${line}`);
  }
  if (health) {
    runtime.log(info("Gateway health: reachable"));

    const tgLine = health.telegram.configured
      ? health.telegram.probe?.ok
        ? info(
            `Telegram: ok${health.telegram.probe.bot?.username ? ` (@${health.telegram.probe.bot.username})` : ""} (${health.telegram.probe.elapsedMs}ms)` +
              (health.telegram.probe.webhook?.url
                ? ` - webhook ${health.telegram.probe.webhook.url}`
                : ""),
          )
        : `Telegram: failed (${health.telegram.probe?.status ?? "unknown"})${health.telegram.probe?.error ? ` - ${health.telegram.probe.error}` : ""}`
      : info("Telegram: not configured");
    runtime.log(tgLine);

    const discordLine = health.discord.configured
      ? health.discord.probe?.ok
        ? info(
            `Discord: ok${health.discord.probe.bot?.username ? ` (@${health.discord.probe.bot.username})` : ""} (${health.discord.probe.elapsedMs}ms)`,
          )
        : `Discord: failed (${health.discord.probe?.status ?? "unknown"})${health.discord.probe?.error ? ` - ${health.discord.probe.error}` : ""}`
      : info("Discord: not configured");
    runtime.log(discordLine);

    const slackLine = health.slack.configured
      ? health.slack.probe?.ok
        ? info(
            `Slack: ok${health.slack.probe.team?.name ? ` (${health.slack.probe.team.name})` : ""} (${health.slack.probe.elapsedMs}ms)`,
          )
        : `Slack: failed (${health.slack.probe?.status ?? "unknown"})${health.slack.probe?.error ? ` - ${health.slack.probe.error}` : ""}`
      : info("Slack: not configured");
    runtime.log(slackLine);
  } else {
    runtime.log(info("Provider probes: skipped (use --deep)"));
  }
  if (summary.queuedSystemEvents.length > 0) {
    const preview = summary.queuedSystemEvents.slice(0, 3).join(" | ");
    runtime.log(
      info(
        `Queued system events (${summary.queuedSystemEvents.length}): ${preview}`,
      ),
    );
  }
  runtime.log(info(`Heartbeat: ${summary.heartbeatSeconds}s`));
  runtime.log(info(`Session store: ${summary.sessions.path}`));
  const defaults = summary.sessions.defaults;
  const defaultCtx = defaults.contextTokens
    ? ` (${formatKTokens(defaults.contextTokens)} ctx)`
    : "";
  runtime.log(
    info(`Default model: ${defaults.model ?? "unknown"}${defaultCtx}`),
  );
  runtime.log(info(`Active sessions: ${summary.sessions.count}`));
  if (summary.sessions.recent.length > 0) {
    runtime.log("Recent sessions:");
    for (const r of summary.sessions.recent) {
      runtime.log(
        `- ${r.key} [${r.kind}] | ${r.updatedAt ? formatAge(r.age) : "no activity"} | model ${r.model ?? "unknown"} | ${formatContextUsage(r.totalTokens, r.contextTokens, r.remainingTokens, r.percentUsed)}${r.flags.length ? ` | flags: ${r.flags.join(", ")}` : ""}`,
      );
    }
  } else {
    runtime.log("No session activity yet.");
  }
}
