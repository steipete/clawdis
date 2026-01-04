import crypto from "node:crypto";
import { lookupContextTokens } from "../agents/context.js";
import {
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
} from "../agents/defaults.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import {
  resolveConfiguredModelRef,
  resolveThinkingDefault,
} from "../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { buildWorkspaceSkillSnapshot } from "../agents/skills.js";
import {
  DEFAULT_AGENT_WORKSPACE_DIR,
  ensureAgentWorkspace,
} from "../agents/workspace.js";
import { chunkText, resolveTextChunkLimit } from "../auto-reply/chunk.js";
import { normalizeThinkLevel } from "../auto-reply/thinking.js";
import type { CliDeps } from "../cli/deps.js";
import type { ClawdisConfig } from "../config/config.js";
import {
  DEFAULT_IDLE_MINUTES,
  loadSessionStore,
  resolveSessionTranscriptPath,
  resolveStorePath,
  type SessionEntry,
  saveSessionStore,
} from "../config/sessions.js";
import { registerAgentRunContext } from "../infra/agent-events.js";
import { resolveTelegramToken } from "../telegram/token.js";
import { normalizeE164 } from "../utils.js";
import type { CronJob } from "./types.js";

export type RunCronAgentTurnResult = {
  status: "ok" | "error" | "skipped";
  summary?: string;
  error?: string;
};

function pickSummaryFromOutput(text: string | undefined) {
  const clean = (text ?? "").trim();
  if (!clean) return undefined;
  const limit = 2000;
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

function pickSummaryFromPayloads(
  payloads: Array<{ text?: string | undefined }>,
) {
  for (let i = payloads.length - 1; i >= 0; i--) {
    const summary = pickSummaryFromOutput(payloads[i]?.text);
    if (summary) return summary;
  }
  return undefined;
}

function resolveDeliveryTarget(
  cfg: ClawdisConfig,
  jobPayload: {
    channel?:
      | "last"
      | "whatsapp"
      | "telegram"
      | "discord"
      | "slack"
      | "signal"
      | "imessage";
    to?: string;
  },
) {
  const requestedChannel =
    typeof jobPayload.channel === "string" ? jobPayload.channel : "last";
  const explicitTo =
    typeof jobPayload.to === "string" && jobPayload.to.trim()
      ? jobPayload.to.trim()
      : undefined;

  const sessionCfg = cfg.session;
  const mainKey = (sessionCfg?.mainKey ?? "main").trim() || "main";
  const storePath = resolveStorePath(sessionCfg?.store);
  const store = loadSessionStore(storePath);
  const main = store[mainKey];
  const lastChannel =
    main?.lastChannel && main.lastChannel !== "webchat"
      ? main.lastChannel
      : undefined;
  const lastTo = typeof main?.lastTo === "string" ? main.lastTo.trim() : "";

  const channel = (() => {
    if (
      requestedChannel === "whatsapp" ||
      requestedChannel === "telegram" ||
      requestedChannel === "discord" ||
      requestedChannel === "slack" ||
      requestedChannel === "signal" ||
      requestedChannel === "imessage"
    ) {
      return requestedChannel;
    }
    return lastChannel ?? "whatsapp";
  })();

  const to = (() => {
    if (explicitTo) return explicitTo;
    return lastTo || undefined;
  })();

  const sanitizedWhatsappTo = (() => {
    if (channel !== "whatsapp") return to;
    const rawAllow = cfg.whatsapp?.allowFrom ?? [];
    if (rawAllow.includes("*")) return to;
    const allowFrom = rawAllow
      .map((val) => normalizeE164(val))
      .filter((val) => val.length > 1);
    if (allowFrom.length === 0) return to;
    if (!to) return allowFrom[0];
    const normalized = normalizeE164(to);
    if (allowFrom.includes(normalized)) return normalized;
    return allowFrom[0];
  })();

  return {
    channel,
    to: channel === "whatsapp" ? sanitizedWhatsappTo : to,
  };
}

function resolveCronSession(params: {
  cfg: ClawdisConfig;
  sessionKey: string;
  nowMs: number;
}) {
  const sessionCfg = params.cfg.session;
  const idleMinutes = Math.max(
    sessionCfg?.idleMinutes ?? DEFAULT_IDLE_MINUTES,
    1,
  );
  const idleMs = idleMinutes * 60_000;
  const storePath = resolveStorePath(sessionCfg?.store);
  const store = loadSessionStore(storePath);
  const entry = store[params.sessionKey];
  const fresh = entry && params.nowMs - entry.updatedAt <= idleMs;
  const sessionId = fresh ? entry.sessionId : crypto.randomUUID();
  const systemSent = fresh ? Boolean(entry.systemSent) : false;
  const sessionEntry: SessionEntry = {
    sessionId,
    updatedAt: params.nowMs,
    systemSent,
    thinkingLevel: entry?.thinkingLevel,
    verboseLevel: entry?.verboseLevel,
    model: entry?.model,
    contextTokens: entry?.contextTokens,
    sendPolicy: entry?.sendPolicy,
    lastChannel: entry?.lastChannel,
    lastTo: entry?.lastTo,
  };
  return { storePath, store, sessionEntry, systemSent, isNewSession: !fresh };
}

export async function runCronIsolatedAgentTurn(params: {
  cfg: ClawdisConfig;
  deps: CliDeps;
  job: CronJob;
  message: string;
  sessionKey: string;
  lane?: string;
}): Promise<RunCronAgentTurnResult> {
  const agentCfg = params.cfg.agent;
  const workspaceDirRaw =
    params.cfg.agent?.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;
  const workspace = await ensureAgentWorkspace({
    dir: workspaceDirRaw,
    ensureBootstrapFiles: true,
  });
  const workspaceDir = workspace.dir;

  const { provider, model } = resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const now = Date.now();
  const cronSession = resolveCronSession({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    nowMs: now,
  });
  const isFirstTurnInSession =
    cronSession.isNewSession || !cronSession.systemSent;

  const thinkOverride = normalizeThinkLevel(agentCfg?.thinkingDefault);
  const jobThink = normalizeThinkLevel(
    (params.job.payload.kind === "agentTurn"
      ? params.job.payload.thinking
      : undefined) ?? undefined,
  );
  let thinkLevel = jobThink ?? thinkOverride;
  if (!thinkLevel) {
    const catalog = await loadModelCatalog({ config: params.cfg });
    thinkLevel = resolveThinkingDefault({
      cfg: params.cfg,
      provider,
      model,
      catalog,
    });
  }

  const timeoutSecondsRaw =
    params.job.payload.kind === "agentTurn" && params.job.payload.timeoutSeconds
      ? params.job.payload.timeoutSeconds
      : (agentCfg?.timeoutSeconds ?? 600);
  const timeoutSeconds = Math.max(Math.floor(timeoutSecondsRaw), 1);
  const timeoutMs = timeoutSeconds * 1000;

  const delivery =
    params.job.payload.kind === "agentTurn" &&
    params.job.payload.deliver === true;
  const bestEffortDeliver =
    params.job.payload.kind === "agentTurn" &&
    params.job.payload.bestEffortDeliver === true;

  const resolvedDelivery = resolveDeliveryTarget(params.cfg, {
    channel:
      params.job.payload.kind === "agentTurn"
        ? params.job.payload.channel
        : "last",
    to:
      params.job.payload.kind === "agentTurn"
        ? params.job.payload.to
        : undefined,
  });
  const { token: telegramToken } = resolveTelegramToken(params.cfg);

  const base =
    `[cron:${params.job.id} ${params.job.name}] ${params.message}`.trim();

  const commandBody = base;

  const needsSkillsSnapshot =
    cronSession.isNewSession || !cronSession.sessionEntry.skillsSnapshot;
  const skillsSnapshot = needsSkillsSnapshot
    ? buildWorkspaceSkillSnapshot(workspaceDir, { config: params.cfg })
    : cronSession.sessionEntry.skillsSnapshot;
  if (needsSkillsSnapshot && skillsSnapshot) {
    cronSession.sessionEntry = {
      ...cronSession.sessionEntry,
      updatedAt: Date.now(),
      skillsSnapshot,
    };
    cronSession.store[params.sessionKey] = cronSession.sessionEntry;
    await saveSessionStore(cronSession.storePath, cronSession.store);
  }

  // Persist systemSent before the run, mirroring the inbound auto-reply behavior.
  if (isFirstTurnInSession) {
    cronSession.sessionEntry.systemSent = true;
    cronSession.store[params.sessionKey] = cronSession.sessionEntry;
    await saveSessionStore(cronSession.storePath, cronSession.store);
  } else {
    cronSession.store[params.sessionKey] = cronSession.sessionEntry;
    await saveSessionStore(cronSession.storePath, cronSession.store);
  }

  let runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
  try {
    const sessionFile = resolveSessionTranscriptPath(
      cronSession.sessionEntry.sessionId,
    );
    registerAgentRunContext(cronSession.sessionEntry.sessionId, {
      sessionKey: params.sessionKey,
    });
    const surface = resolvedDelivery.channel;
    runResult = await runEmbeddedPiAgent({
      sessionId: cronSession.sessionEntry.sessionId,
      sessionKey: params.sessionKey,
      surface,
      sessionFile,
      workspaceDir,
      config: params.cfg,
      skillsSnapshot,
      prompt: commandBody,
      lane: params.lane ?? "cron",
      provider,
      model,
      thinkLevel,
      verboseLevel:
        (cronSession.sessionEntry.verboseLevel as "on" | "off" | undefined) ??
        (agentCfg?.verboseDefault as "on" | "off" | undefined),
      timeoutMs,
      runId: cronSession.sessionEntry.sessionId,
    });
  } catch (err) {
    return { status: "error", error: String(err) };
  }

  const payloads = runResult.payloads ?? [];

  // Update token+model fields in the session store.
  {
    const usage = runResult.meta.agentMeta?.usage;
    const modelUsed = runResult.meta.agentMeta?.model ?? model;
    const contextTokens =
      agentCfg?.contextTokens ??
      lookupContextTokens(modelUsed) ??
      DEFAULT_CONTEXT_TOKENS;

    cronSession.sessionEntry.model = modelUsed;
    cronSession.sessionEntry.contextTokens = contextTokens;
    if (usage) {
      const input = usage.input ?? 0;
      const output = usage.output ?? 0;
      const promptTokens =
        input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      cronSession.sessionEntry.inputTokens = input;
      cronSession.sessionEntry.outputTokens = output;
      cronSession.sessionEntry.totalTokens =
        promptTokens > 0 ? promptTokens : (usage.total ?? input);
    }
    cronSession.store[params.sessionKey] = cronSession.sessionEntry;
    await saveSessionStore(cronSession.storePath, cronSession.store);
  }
  const firstText = payloads[0]?.text ?? "";
  const summary =
    pickSummaryFromPayloads(payloads) ?? pickSummaryFromOutput(firstText);

  if (delivery) {
    if (resolvedDelivery.channel === "whatsapp") {
      if (!resolvedDelivery.to) {
        if (!bestEffortDeliver)
          return {
            status: "error",
            summary,
            error: "Cron delivery to WhatsApp requires a recipient.",
          };
        return {
          status: "skipped",
          summary: "Delivery skipped (no WhatsApp recipient).",
        };
      }
      const to = normalizeE164(resolvedDelivery.to);
      try {
        for (const payload of payloads) {
          const mediaList =
            payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
          const primaryMedia = mediaList[0];
          await params.deps.sendMessageWhatsApp(to, payload.text ?? "", {
            verbose: false,
            mediaUrl: primaryMedia,
          });
          for (const extra of mediaList.slice(1)) {
            await params.deps.sendMessageWhatsApp(to, "", {
              verbose: false,
              mediaUrl: extra,
            });
          }
        }
      } catch (err) {
        if (!bestEffortDeliver)
          return { status: "error", summary, error: String(err) };
        return { status: "ok", summary };
      }
    } else if (resolvedDelivery.channel === "telegram") {
      if (!resolvedDelivery.to) {
        if (!bestEffortDeliver)
          return {
            status: "error",
            summary,
            error: "Cron delivery to Telegram requires a chatId.",
          };
        return {
          status: "skipped",
          summary: "Delivery skipped (no Telegram chatId).",
        };
      }
      const chatId = resolvedDelivery.to;
      const textLimit = resolveTextChunkLimit(params.cfg, "telegram");
      try {
        for (const payload of payloads) {
          const mediaList =
            payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
          if (mediaList.length === 0) {
            for (const chunk of chunkText(payload.text ?? "", textLimit)) {
              await params.deps.sendMessageTelegram(chatId, chunk, {
                verbose: false,
                token: telegramToken || undefined,
              });
            }
          } else {
            let first = true;
            for (const url of mediaList) {
              const caption = first ? (payload.text ?? "") : "";
              first = false;
              await params.deps.sendMessageTelegram(chatId, caption, {
                verbose: false,
                mediaUrl: url,
                token: telegramToken || undefined,
              });
            }
          }
        }
      } catch (err) {
        if (!bestEffortDeliver)
          return { status: "error", summary, error: String(err) };
        return { status: "ok", summary };
      }
    } else if (resolvedDelivery.channel === "discord") {
      if (!resolvedDelivery.to) {
        if (!bestEffortDeliver)
          return {
            status: "error",
            summary,
            error:
              "Cron delivery to Discord requires --channel discord and --to <channelId|user:ID>",
          };
        return {
          status: "skipped",
          summary: "Delivery skipped (no Discord destination).",
        };
      }
      const discordTarget = resolvedDelivery.to;
      try {
        for (const payload of payloads) {
          const mediaList =
            payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
          if (mediaList.length === 0) {
            await params.deps.sendMessageDiscord(
              discordTarget,
              payload.text ?? "",
              {
                token: process.env.DISCORD_BOT_TOKEN,
              },
            );
          } else {
            let first = true;
            for (const url of mediaList) {
              const caption = first ? (payload.text ?? "") : "";
              first = false;
              await params.deps.sendMessageDiscord(discordTarget, caption, {
                token: process.env.DISCORD_BOT_TOKEN,
                mediaUrl: url,
              });
            }
          }
        }
      } catch (err) {
        if (!bestEffortDeliver)
          return { status: "error", summary, error: String(err) };
        return { status: "ok", summary };
      }
    } else if (resolvedDelivery.channel === "slack") {
      if (!resolvedDelivery.to) {
        if (!bestEffortDeliver)
          return {
            status: "error",
            summary,
            error:
              "Cron delivery to Slack requires --channel slack and --to <channelId|user:ID>",
          };
        return {
          status: "skipped",
          summary: "Delivery skipped (no Slack destination).",
        };
      }
      const slackTarget = resolvedDelivery.to;
      try {
        for (const payload of payloads) {
          const mediaList =
            payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
          if (mediaList.length === 0) {
            await params.deps.sendMessageSlack(
              slackTarget,
              payload.text ?? "",
              {
                token: process.env.SLACK_BOT_TOKEN,
              },
            );
          } else {
            let first = true;
            for (const url of mediaList) {
              const caption = first ? (payload.text ?? "") : "";
              first = false;
              await params.deps.sendMessageSlack(slackTarget, caption, {
                token: process.env.SLACK_BOT_TOKEN,
                mediaUrl: url,
              });
            }
          }
        }
      } catch (err) {
        if (!bestEffortDeliver)
          return { status: "error", summary, error: String(err) };
        return { status: "ok", summary };
      }
    } else if (resolvedDelivery.channel === "signal") {
      if (!resolvedDelivery.to) {
        if (!bestEffortDeliver)
          return {
            status: "error",
            summary,
            error: "Cron delivery to Signal requires a recipient.",
          };
        return {
          status: "skipped",
          summary: "Delivery skipped (no Signal recipient).",
        };
      }
      const to = resolvedDelivery.to;
      const textLimit = resolveTextChunkLimit(params.cfg, "signal");
      try {
        for (const payload of payloads) {
          const mediaList =
            payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
          if (mediaList.length === 0) {
            for (const chunk of chunkText(payload.text ?? "", textLimit)) {
              await params.deps.sendMessageSignal(to, chunk);
            }
          } else {
            let first = true;
            for (const url of mediaList) {
              const caption = first ? (payload.text ?? "") : "";
              first = false;
              await params.deps.sendMessageSignal(to, caption, {
                mediaUrl: url,
              });
            }
          }
        }
      } catch (err) {
        if (!bestEffortDeliver)
          return { status: "error", summary, error: String(err) };
        return { status: "ok", summary };
      }
    } else if (resolvedDelivery.channel === "imessage") {
      if (!resolvedDelivery.to) {
        if (!bestEffortDeliver)
          return {
            status: "error",
            summary,
            error: "Cron delivery to iMessage requires a recipient.",
          };
        return {
          status: "skipped",
          summary: "Delivery skipped (no iMessage recipient).",
        };
      }
      const to = resolvedDelivery.to;
      const textLimit = resolveTextChunkLimit(params.cfg, "imessage");
      try {
        for (const payload of payloads) {
          const mediaList =
            payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
          if (mediaList.length === 0) {
            for (const chunk of chunkText(payload.text ?? "", textLimit)) {
              await params.deps.sendMessageIMessage(to, chunk);
            }
          } else {
            let first = true;
            for (const url of mediaList) {
              const caption = first ? (payload.text ?? "") : "";
              first = false;
              await params.deps.sendMessageIMessage(to, caption, {
                mediaUrl: url,
              });
            }
          }
        }
      } catch (err) {
        if (!bestEffortDeliver)
          return { status: "error", summary, error: String(err) };
        return { status: "ok", summary };
      }
    }
  }

  return { status: "ok", summary };
}
