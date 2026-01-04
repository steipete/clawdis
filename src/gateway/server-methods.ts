import { randomUUID } from "node:crypto";
import fs from "node:fs";

import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import type { ModelCatalogEntry } from "../agents/model-catalog.js";
import {
  buildAllowedModelSet,
  buildModelAliasIndex,
  modelKey,
  resolveConfiguredModelRef,
  resolveModelRefFromString,
  resolveThinkingDefault,
} from "../agents/model-selection.js";
import {
  abortEmbeddedPiRun,
  isEmbeddedPiRunActive,
  resolveEmbeddedSessionLane,
  waitForEmbeddedPiRunEnd,
} from "../agents/pi-embedded.js";
import { installSkill } from "../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../agents/skills-status.js";
import { DEFAULT_AGENT_WORKSPACE_DIR } from "../agents/workspace.js";
import { normalizeGroupActivation } from "../auto-reply/group-activation.js";
import {
  normalizeThinkLevel,
  normalizeVerboseLevel,
} from "../auto-reply/thinking.js";
import type { createDefaultDeps } from "../cli/deps.js";
import { agentCommand } from "../commands/agent.js";
import type { HealthSummary } from "../commands/health.js";
import { getStatusSummary } from "../commands/status.js";
import type { ClawdisConfig } from "../config/config.js";
import {
  CONFIG_PATH_CLAWDIS,
  loadConfig,
  parseConfigJson5,
  readConfigFileSnapshot,
  validateConfigObject,
  writeConfigFile,
} from "../config/config.js";
import { buildConfigSchema } from "../config/schema.js";
import {
  loadSessionStore,
  resolveMainSessionKey,
  resolveStorePath,
  type SessionEntry,
  saveSessionStore,
} from "../config/sessions.js";
import {
  readCronRunLogEntries,
  resolveCronRunLogPath,
} from "../cron/run-log.js";
import type { CronService } from "../cron/service.js";
import type { CronJobCreate, CronJobPatch } from "../cron/types.js";
import { sendMessageDiscord } from "../discord/index.js";
import { type DiscordProbe, probeDiscord } from "../discord/probe.js";
import { shouldLogVerbose } from "../globals.js";
import { sendMessageIMessage } from "../imessage/index.js";
import { type IMessageProbe, probeIMessage } from "../imessage/probe.js";
import { onAgentEvent, registerAgentRunContext } from "../infra/agent-events.js";
import type { startNodeBridgeServer } from "../infra/bridge/server.js";
import { getLastHeartbeatEvent } from "../infra/heartbeat-events.js";
import { setHeartbeatsEnabled } from "../infra/heartbeat-runner.js";
import {
  approveNodePairing,
  listNodePairing,
  rejectNodePairing,
  renamePairedNode,
  requestNodePairing,
  verifyNodeToken,
} from "../infra/node-pairing.js";
import {
  enqueueSystemEvent,
  isSystemEventContextChanged,
} from "../infra/system-events.js";
import {
  listSystemPresence,
  updateSystemPresence,
} from "../infra/system-presence.js";
import {
  loadVoiceWakeConfig,
  setVoiceWakeTriggers,
} from "../infra/voicewake.js";
import { clearCommandLane } from "../process/command-queue.js";
import { webAuthExists } from "../providers/web/index.js";
import { defaultRuntime } from "../runtime.js";
import {
  normalizeSendPolicy,
  resolveSendPolicy,
} from "../sessions/send-policy.js";
import { sendMessageSignal } from "../signal/index.js";
import { probeSignal, type SignalProbe } from "../signal/probe.js";
import { probeSlack, type SlackProbe } from "../slack/probe.js";
import { sendMessageSlack } from "../slack/send.js";
import { probeTelegram, type TelegramProbe } from "../telegram/probe.js";
import { sendMessageTelegram } from "../telegram/send.js";
import { resolveTelegramToken } from "../telegram/token.js";
import { normalizeE164, resolveUserPath } from "../utils.js";
import { startWebLoginWithQr, waitForWebLogin } from "../web/login-qr.js";
import { sendMessageWhatsApp } from "../web/outbound.js";
import { getWebAuthAgeMs, logoutWeb, readWebSelfId } from "../web/session.js";
import { WizardSession } from "../wizard/session.js";
import { buildMessageWithAttachments } from "./chat-attachments.js";
import {
  type AgentWaitParams,
  type ConnectParams,
  ErrorCodes,
  type ErrorShape,
  errorShape,
  formatValidationErrors,
  type RequestFrame,
  type SessionsCompactParams,
  type SessionsDeleteParams,
  type SessionsListParams,
  type SessionsPatchParams,
  type SessionsResetParams,
  validateAgentParams,
  validateAgentWaitParams,
  validateChatAbortParams,
  validateChatHistoryParams,
  validateChatSendParams,
  validateConfigGetParams,
  validateConfigSchemaParams,
  validateConfigSetParams,
  validateCronAddParams,
  validateCronListParams,
  validateCronRemoveParams,
  validateCronRunParams,
  validateCronRunsParams,
  validateCronStatusParams,
  validateCronUpdateParams,
  validateModelsListParams,
  validateNodeDescribeParams,
  validateNodeInvokeParams,
  validateNodeListParams,
  validateNodePairApproveParams,
  validateNodePairListParams,
  validateNodePairRejectParams,
  validateNodePairRequestParams,
  validateNodePairVerifyParams,
  validateNodeRenameParams,
  validateProvidersStatusParams,
  validateSendParams,
  validateSessionsCompactParams,
  validateSessionsDeleteParams,
  validateSessionsListParams,
  validateSessionsPatchParams,
  validateSessionsResetParams,
  validateSkillsInstallParams,
  validateSkillsStatusParams,
  validateSkillsUpdateParams,
  validateTalkModeParams,
  validateWakeParams,
  validateWebLoginStartParams,
  validateWebLoginWaitParams,
  validateWizardCancelParams,
  validateWizardNextParams,
  validateWizardStartParams,
  validateWizardStatusParams,
} from "./protocol/index.js";
import {
  HEALTH_REFRESH_INTERVAL_MS,
  MAX_CHAT_HISTORY_MESSAGES_BYTES,
} from "./server-constants.js";
import type { ProviderRuntimeSnapshot } from "./server-providers.js";
import { formatError, normalizeVoiceWakeTriggers } from "./server-utils.js";
import {
  archiveFileOnDisk,
  capArrayByJsonBytes,
  listSessionsFromStore,
  loadSessionEntry,
  readSessionMessages,
  resolveSessionModelRef,
  resolveSessionTranscriptCandidates,
  type SessionsPatchResult,
} from "./session-utils.js";
import { formatForLog } from "./ws-log.js";

export type GatewayClient = {
  connect: ConnectParams;
};

export type RespondFn = (
  ok: boolean,
  payload?: unknown,
  error?: ErrorShape,
  meta?: Record<string, unknown>,
) => void;

type DedupeEntry = {
  ts: number;
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
};

type AgentJobSnapshot = {
  runId: string;
  state: "done" | "error";
  startedAt?: number;
  endedAt?: number;
  error?: string;
  ts: number;
};

const AGENT_JOB_CACHE_TTL_MS = 10 * 60_000;
const agentJobCache = new Map<string, AgentJobSnapshot>();
const agentRunStarts = new Map<string, number>();
let agentJobListenerStarted = false;

function pruneAgentJobCache(now = Date.now()) {
  for (const [runId, entry] of agentJobCache) {
    if (now - entry.ts > AGENT_JOB_CACHE_TTL_MS) {
      agentJobCache.delete(runId);
    }
  }
}

function recordAgentJobSnapshot(entry: AgentJobSnapshot) {
  pruneAgentJobCache(entry.ts);
  agentJobCache.set(entry.runId, entry);
}

function ensureAgentJobListener() {
  if (agentJobListenerStarted) return;
  agentJobListenerStarted = true;
  onAgentEvent((evt) => {
    if (!evt || evt.stream !== "job") return;
    const state = evt.data?.state;
    if (state === "started") {
      const startedAt =
        typeof evt.data?.startedAt === "number"
          ? (evt.data.startedAt as number)
          : undefined;
      if (startedAt !== undefined) {
        agentRunStarts.set(evt.runId, startedAt);
      }
      return;
    }
    if (state !== "done" && state !== "error") return;
    const startedAt =
      typeof evt.data?.startedAt === "number"
        ? (evt.data.startedAt as number)
        : agentRunStarts.get(evt.runId);
    const endedAt =
      typeof evt.data?.endedAt === "number"
        ? (evt.data.endedAt as number)
        : undefined;
    const error =
      typeof evt.data?.error === "string"
        ? (evt.data.error as string)
        : undefined;
    agentRunStarts.delete(evt.runId);
    recordAgentJobSnapshot({
      runId: evt.runId,
      state: state === "error" ? "error" : "done",
      startedAt,
      endedAt,
      error,
      ts: Date.now(),
    });
  });
}

function matchesAfterMs(entry: AgentJobSnapshot, afterMs?: number) {
  if (afterMs === undefined) return true;
  if (typeof entry.startedAt === "number") return entry.startedAt >= afterMs;
  if (typeof entry.endedAt === "number") return entry.endedAt >= afterMs;
  return false;
}

function getCachedAgentJob(runId: string, afterMs?: number) {
  pruneAgentJobCache();
  const cached = agentJobCache.get(runId);
  if (!cached) return undefined;
  return matchesAfterMs(cached, afterMs) ? cached : undefined;
}

async function waitForAgentJob(params: {
  runId: string;
  afterMs?: number;
  timeoutMs: number;
}): Promise<AgentJobSnapshot | null> {
  const { runId, afterMs, timeoutMs } = params;
  ensureAgentJobListener();
  const cached = getCachedAgentJob(runId, afterMs);
  if (cached) return cached;
  if (timeoutMs <= 0) return null;

  return await new Promise((resolve) => {
    let settled = false;
    const finish = (entry: AgentJobSnapshot | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(entry);
    };
    const unsubscribe = onAgentEvent((evt) => {
      if (!evt || evt.stream !== "job") return;
      if (evt.runId !== runId) return;
      const state = evt.data?.state;
      if (state !== "done" && state !== "error") return;
      const startedAt =
        typeof evt.data?.startedAt === "number"
          ? (evt.data.startedAt as number)
          : agentRunStarts.get(evt.runId);
      const endedAt =
        typeof evt.data?.endedAt === "number"
          ? (evt.data.endedAt as number)
          : undefined;
      const error =
        typeof evt.data?.error === "string"
          ? (evt.data.error as string)
          : undefined;
      const snapshot: AgentJobSnapshot = {
        runId: evt.runId,
        state: state === "error" ? "error" : "done",
        startedAt,
        endedAt,
        error,
        ts: Date.now(),
      };
      recordAgentJobSnapshot(snapshot);
      if (!matchesAfterMs(snapshot, afterMs)) return;
      finish(snapshot);
    });
    const timer = setTimeout(() => finish(null), Math.max(1, timeoutMs));
  });
}

ensureAgentJobListener();

export type GatewayRequestContext = {
  deps: ReturnType<typeof createDefaultDeps>;
  cron: CronService;
  cronStorePath: string;
  loadGatewayModelCatalog: () => Promise<ModelCatalogEntry[]>;
  getHealthCache: () => HealthSummary | null;
  refreshHealthSnapshot: (opts?: { probe?: boolean }) => Promise<HealthSummary>;
  logHealth: { error: (message: string) => void };
  incrementPresenceVersion: () => number;
  getHealthVersion: () => number;
  broadcast: (
    event: string,
    payload: unknown,
    opts?: {
      dropIfSlow?: boolean;
      stateVersion?: { presence?: number; health?: number };
    },
  ) => void;
  bridge: Awaited<ReturnType<typeof startNodeBridgeServer>> | null;
  bridgeSendToSession: (
    sessionKey: string,
    event: string,
    payload: unknown,
  ) => void;
  hasConnectedMobileNode: () => boolean;
  agentRunSeq: Map<string, number>;
  chatAbortControllers: Map<
    string,
    { controller: AbortController; sessionId: string; sessionKey: string }
  >;
  chatRunBuffers: Map<string, string>;
  chatDeltaSentAt: Map<string, number>;
  addChatRun: (
    sessionId: string,
    entry: { sessionKey: string; clientRunId: string },
  ) => void;
  removeChatRun: (
    sessionId: string,
    clientRunId: string,
    sessionKey?: string,
  ) => { sessionKey: string; clientRunId: string } | undefined;
  dedupe: Map<string, DedupeEntry>;
  wizardSessions: Map<string, WizardSession>;
  findRunningWizard: () => string | null;
  purgeWizardSession: (id: string) => void;
  getRuntimeSnapshot: () => ProviderRuntimeSnapshot;
  startWhatsAppProvider: () => Promise<void>;
  stopWhatsAppProvider: () => Promise<void>;
  stopTelegramProvider: () => Promise<void>;
  markWhatsAppLoggedOut: (cleared: boolean) => void;
  wizardRunner: (
    opts: import("../commands/onboard-types.js").OnboardOptions,
    runtime: import("../runtime.js").RuntimeEnv,
    prompter: import("../wizard/prompts.js").WizardPrompter,
  ) => Promise<void>;
  broadcastVoiceWakeChanged: (triggers: string[]) => void;
};

export type GatewayRequestOptions = {
  req: RequestFrame;
  client: GatewayClient | null;
  isWebchatConnect: (params: ConnectParams | null | undefined) => boolean;
  respond: RespondFn;
  context: GatewayRequestContext;
};

export async function handleGatewayRequest(
  opts: GatewayRequestOptions,
): Promise<void> {
  const { req, respond, client, isWebchatConnect, context } = opts;
  const {
    deps,
    cron,
    cronStorePath,
    loadGatewayModelCatalog,
    getHealthCache,
    refreshHealthSnapshot,
    logHealth,
    incrementPresenceVersion,
    getHealthVersion,
    broadcast,
    bridge,
    bridgeSendToSession,
    hasConnectedMobileNode,
    agentRunSeq,
    chatAbortControllers,
    chatRunBuffers,
    chatDeltaSentAt,
    addChatRun,
    removeChatRun,
    dedupe,
    wizardSessions,
    findRunningWizard,
    purgeWizardSession,
    getRuntimeSnapshot,
    startWhatsAppProvider,
    stopWhatsAppProvider,
    stopTelegramProvider,
    markWhatsAppLoggedOut,
    wizardRunner,
    broadcastVoiceWakeChanged,
  } = context;

  switch (req.method) {
    case "connect": {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "connect is only valid as the first request",
        ),
      );
      break;
    }
    case "voicewake.get": {
      try {
        const cfg = await loadVoiceWakeConfig();
        respond(true, { triggers: cfg.triggers });
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "voicewake.set": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!Array.isArray(params.triggers)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "voicewake.set requires triggers: string[]",
          ),
        );
        break;
      }
      try {
        const triggers = normalizeVoiceWakeTriggers(params.triggers);
        const cfg = await setVoiceWakeTriggers(triggers);
        broadcastVoiceWakeChanged(cfg.triggers);
        respond(true, { triggers: cfg.triggers });
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "health": {
      const now = Date.now();
      const cached = getHealthCache();
      if (cached && now - cached.ts < HEALTH_REFRESH_INTERVAL_MS) {
        respond(true, cached, undefined, { cached: true });
        void refreshHealthSnapshot({ probe: false }).catch((err) =>
          logHealth.error(
            `background health refresh failed: ${formatError(err)}`,
          ),
        );
        break;
      }
      try {
        const snap = await refreshHealthSnapshot({ probe: false });
        respond(true, snap, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "providers.status": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateProvidersStatusParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid providers.status params: ${formatValidationErrors(validateProvidersStatusParams.errors)}`,
          ),
        );
        break;
      }
      const probe = (params as { probe?: boolean }).probe === true;
      const timeoutMsRaw = (params as { timeoutMs?: unknown }).timeoutMs;
      const timeoutMs =
        typeof timeoutMsRaw === "number"
          ? Math.max(1000, timeoutMsRaw)
          : 10_000;
      const cfg = loadConfig();
      const telegramCfg = cfg.telegram;
      const telegramEnabled =
        Boolean(telegramCfg) && telegramCfg?.enabled !== false;
      const { token: telegramToken, source: tokenSource } = telegramEnabled
        ? resolveTelegramToken(cfg)
        : { token: "", source: "none" as const };
      let telegramProbe: TelegramProbe | undefined;
      let lastProbeAt: number | null = null;
      if (probe && telegramToken && telegramEnabled) {
        telegramProbe = await probeTelegram(
          telegramToken,
          timeoutMs,
          telegramCfg?.proxy,
        );
        lastProbeAt = Date.now();
      }

      const discordCfg = cfg.discord;
      const discordEnabled =
        Boolean(discordCfg) && discordCfg?.enabled !== false;
      const discordEnvToken = discordEnabled
        ? process.env.DISCORD_BOT_TOKEN?.trim()
        : "";
      const discordConfigToken = discordEnabled
        ? discordCfg?.token?.trim()
        : "";
      const discordToken = discordEnvToken || discordConfigToken || "";
      const discordTokenSource = discordEnvToken
        ? "env"
        : discordConfigToken
          ? "config"
          : "none";
      let discordProbe: DiscordProbe | undefined;
      let discordLastProbeAt: number | null = null;
      if (probe && discordToken && discordEnabled) {
        discordProbe = await probeDiscord(discordToken, timeoutMs);
        discordLastProbeAt = Date.now();
      }

      const slackCfg = cfg.slack;
      const slackEnabled = Boolean(slackCfg) && slackCfg?.enabled !== false;
      const slackEnvBotToken = slackEnabled
        ? process.env.SLACK_BOT_TOKEN?.trim()
        : "";
      const slackEnvAppToken = slackEnabled
        ? process.env.SLACK_APP_TOKEN?.trim()
        : "";
      const slackConfigBotToken = slackEnabled
        ? slackCfg?.botToken?.trim()
        : "";
      const slackConfigAppToken = slackEnabled
        ? slackCfg?.appToken?.trim()
        : "";
      const slackBotToken = slackEnvBotToken || slackConfigBotToken || "";
      const slackAppToken = slackEnvAppToken || slackConfigAppToken || "";
      const slackBotTokenSource = slackEnvBotToken
        ? "env"
        : slackConfigBotToken
          ? "config"
          : "none";
      const slackAppTokenSource = slackEnvAppToken
        ? "env"
        : slackConfigAppToken
          ? "config"
          : "none";
      const slackConfigured =
        slackEnabled && Boolean(slackBotToken && slackAppToken);
      let slackProbe: SlackProbe | undefined;
      let slackLastProbeAt: number | null = null;
      if (probe && slackConfigured) {
        slackProbe = await probeSlack(slackBotToken, timeoutMs);
        slackLastProbeAt = Date.now();
      }

      const signalCfg = cfg.signal;
      const signalEnabled = signalCfg?.enabled !== false;
      const signalHost = signalCfg?.httpHost?.trim() || "127.0.0.1";
      const signalPort = signalCfg?.httpPort ?? 8080;
      const signalBaseUrl =
        signalCfg?.httpUrl?.trim() || `http://${signalHost}:${signalPort}`;
      const signalConfigured =
        Boolean(signalCfg) &&
        signalEnabled &&
        Boolean(
          signalCfg?.account?.trim() ||
            signalCfg?.httpUrl?.trim() ||
            signalCfg?.cliPath?.trim() ||
            signalCfg?.httpHost?.trim() ||
            typeof signalCfg?.httpPort === "number" ||
            typeof signalCfg?.autoStart === "boolean",
        );
      let signalProbe: SignalProbe | undefined;
      let signalLastProbeAt: number | null = null;
      if (probe && signalConfigured) {
        signalProbe = await probeSignal(signalBaseUrl, timeoutMs);
        signalLastProbeAt = Date.now();
      }

      const imessageCfg = cfg.imessage;
      const imessageEnabled = imessageCfg?.enabled !== false;
      const imessageConfigured = Boolean(imessageCfg) && imessageEnabled;
      let imessageProbe: IMessageProbe | undefined;
      let imessageLastProbeAt: number | null = null;
      if (probe && imessageConfigured) {
        imessageProbe = await probeIMessage(timeoutMs);
        imessageLastProbeAt = Date.now();
      }

      const linked = await webAuthExists();
      const authAgeMs = getWebAuthAgeMs();
      const self = readWebSelfId();
      const runtime = getRuntimeSnapshot();

      respond(
        true,
        {
          ts: Date.now(),
          whatsapp: {
            configured: linked,
            linked,
            authAgeMs,
            self,
            running: runtime.whatsapp.running,
            connected: runtime.whatsapp.connected,
            lastConnectedAt: runtime.whatsapp.lastConnectedAt ?? null,
            lastDisconnect: runtime.whatsapp.lastDisconnect ?? null,
            reconnectAttempts: runtime.whatsapp.reconnectAttempts,
            lastMessageAt: runtime.whatsapp.lastMessageAt ?? null,
            lastEventAt: runtime.whatsapp.lastEventAt ?? null,
            lastError: runtime.whatsapp.lastError ?? null,
          },
          telegram: {
            configured: telegramEnabled && Boolean(telegramToken),
            tokenSource,
            running: runtime.telegram.running,
            mode: runtime.telegram.mode ?? null,
            lastStartAt: runtime.telegram.lastStartAt ?? null,
            lastStopAt: runtime.telegram.lastStopAt ?? null,
            lastError: runtime.telegram.lastError ?? null,
            probe: telegramProbe,
            lastProbeAt,
          },
          discord: {
            configured: discordEnabled && Boolean(discordToken),
            tokenSource: discordTokenSource,
            running: runtime.discord.running,
            lastStartAt: runtime.discord.lastStartAt ?? null,
            lastStopAt: runtime.discord.lastStopAt ?? null,
            lastError: runtime.discord.lastError ?? null,
            probe: discordProbe,
            lastProbeAt: discordLastProbeAt,
          },
          slack: {
            configured: slackConfigured,
            tokenSource: slackBotTokenSource,
            appTokenSource: slackAppTokenSource,
            running: runtime.slack.running,
            lastStartAt: runtime.slack.lastStartAt ?? null,
            lastStopAt: runtime.slack.lastStopAt ?? null,
            lastError: runtime.slack.lastError ?? null,
            probe: slackProbe,
            lastProbeAt: slackLastProbeAt,
          },
          signal: {
            configured: signalConfigured,
            baseUrl: signalBaseUrl,
            running: runtime.signal.running,
            lastStartAt: runtime.signal.lastStartAt ?? null,
            lastStopAt: runtime.signal.lastStopAt ?? null,
            lastError: runtime.signal.lastError ?? null,
            probe: signalProbe,
            lastProbeAt: signalLastProbeAt,
          },
          imessage: {
            configured: imessageConfigured,
            running: runtime.imessage.running,
            lastStartAt: runtime.imessage.lastStartAt ?? null,
            lastStopAt: runtime.imessage.lastStopAt ?? null,
            lastError: runtime.imessage.lastError ?? null,
            cliPath: runtime.imessage.cliPath ?? null,
            dbPath: runtime.imessage.dbPath ?? null,
            probe: imessageProbe,
            lastProbeAt: imessageLastProbeAt,
          },
        },
        undefined,
      );
      break;
    }
    case "chat.history": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateChatHistoryParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid chat.history params: ${formatValidationErrors(validateChatHistoryParams.errors)}`,
          ),
        );
        break;
      }
      const { sessionKey, limit } = params as {
        sessionKey: string;
        limit?: number;
      };
      const { cfg, storePath, entry } = loadSessionEntry(sessionKey);
      const sessionId = entry?.sessionId;
      const rawMessages =
        sessionId && storePath ? readSessionMessages(sessionId, storePath) : [];
      const hardMax = 1000;
      const defaultLimit = 200;
      const requested = typeof limit === "number" ? limit : defaultLimit;
      const max = Math.min(hardMax, requested);
      const sliced =
        rawMessages.length > max ? rawMessages.slice(-max) : rawMessages;
      const capped = capArrayByJsonBytes(
        sliced,
        MAX_CHAT_HISTORY_MESSAGES_BYTES,
      ).items;
      let thinkingLevel = entry?.thinkingLevel;
      if (!thinkingLevel) {
        const configured = cfg.agent?.thinkingDefault;
        if (configured) {
          thinkingLevel = configured;
        } else {
          const { provider, model } = resolveSessionModelRef(cfg, entry);
          const catalog = await loadGatewayModelCatalog();
          thinkingLevel = resolveThinkingDefault({
            cfg,
            provider,
            model,
            catalog,
          });
        }
      }
      respond(true, {
        sessionKey,
        sessionId,
        messages: capped,
        thinkingLevel,
      });
      break;
    }
    case "chat.abort": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateChatAbortParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid chat.abort params: ${formatValidationErrors(validateChatAbortParams.errors)}`,
          ),
        );
        break;
      }
      const { sessionKey, runId } = params as {
        sessionKey: string;
        runId: string;
      };
      const active = chatAbortControllers.get(runId);
      if (!active) {
        respond(true, { ok: true, aborted: false });
        break;
      }
      if (active.sessionKey !== sessionKey) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "runId does not match sessionKey",
          ),
        );
        break;
      }

      active.controller.abort();
      chatAbortControllers.delete(runId);
      chatRunBuffers.delete(runId);
      chatDeltaSentAt.delete(runId);
      removeChatRun(active.sessionId, runId, sessionKey);

      const payload = {
        runId,
        sessionKey,
        seq: (agentRunSeq.get(active.sessionId) ?? 0) + 1,
        state: "aborted" as const,
      };
      broadcast("chat", payload);
      bridgeSendToSession(sessionKey, "chat", payload);
      respond(true, { ok: true, aborted: true });
      break;
    }
    case "chat.send": {
      if (
        client &&
        isWebchatConnect(client.connect) &&
        !hasConnectedMobileNode()
      ) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "web chat disabled: no connected iOS/Android nodes",
          ),
        );
        break;
      }
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateChatSendParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid chat.send params: ${formatValidationErrors(validateChatSendParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as {
        sessionKey: string;
        message: string;
        thinking?: string;
        deliver?: boolean;
        attachments?: Array<{
          type?: string;
          mimeType?: string;
          fileName?: string;
          content?: unknown;
        }>;
        timeoutMs?: number;
        idempotencyKey: string;
      };
      const timeoutMs = Math.min(Math.max(p.timeoutMs ?? 30_000, 0), 30_000);
      const normalizedAttachments =
        p.attachments?.map((a) => ({
          type: typeof a?.type === "string" ? a.type : undefined,
          mimeType: typeof a?.mimeType === "string" ? a.mimeType : undefined,
          fileName: typeof a?.fileName === "string" ? a.fileName : undefined,
          content:
            typeof a?.content === "string"
              ? a.content
              : ArrayBuffer.isView(a?.content)
                ? Buffer.from(
                    a.content.buffer,
                    a.content.byteOffset,
                    a.content.byteLength,
                  ).toString("base64")
                : undefined,
        })) ?? [];
      let messageWithAttachments = p.message;
      if (normalizedAttachments.length > 0) {
        try {
          messageWithAttachments = buildMessageWithAttachments(
            p.message,
            normalizedAttachments,
            { maxBytes: 5_000_000 },
          );
        } catch (err) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, String(err)),
          );
          break;
        }
      }
      const { cfg, storePath, store, entry } = loadSessionEntry(p.sessionKey);
      const now = Date.now();
      const sessionId = entry?.sessionId ?? randomUUID();
      const sessionEntry: SessionEntry = {
        sessionId,
        updatedAt: now,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        systemSent: entry?.systemSent,
        sendPolicy: entry?.sendPolicy,
        lastChannel: entry?.lastChannel,
        lastTo: entry?.lastTo,
      };
      const clientRunId = p.idempotencyKey;

      const sendPolicy = resolveSendPolicy({
        cfg,
        entry,
        sessionKey: p.sessionKey,
        surface: entry?.surface,
        chatType: entry?.chatType,
      });
      if (sendPolicy === "deny") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "send blocked by session policy",
          ),
        );
        break;
      }

      const cached = dedupe.get(`chat:${clientRunId}`);
      if (cached) {
        respond(cached.ok, cached.payload, cached.error, {
          cached: true,
        });
        break;
      }

      try {
        const abortController = new AbortController();
        chatAbortControllers.set(clientRunId, {
          controller: abortController,
          sessionId,
          sessionKey: p.sessionKey,
        });
        addChatRun(sessionId, {
          sessionKey: p.sessionKey,
          clientRunId,
        });

        if (store) {
          store[p.sessionKey] = sessionEntry;
          if (storePath) {
            await saveSessionStore(storePath, store);
          }
        }

        await agentCommand(
          {
            message: messageWithAttachments,
            sessionId,
            thinking: p.thinking,
            deliver: p.deliver,
            timeout: Math.ceil(timeoutMs / 1000).toString(),
            surface: "WebChat",
            abortSignal: abortController.signal,
          },
          defaultRuntime,
          deps,
        );
        const payload = {
          runId: clientRunId,
          status: "ok" as const,
        };
        dedupe.set(`chat:${clientRunId}`, {
          ts: Date.now(),
          ok: true,
          payload,
        });
        respond(true, payload, undefined, { runId: clientRunId });
      } catch (err) {
        const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
        const payload = {
          runId: clientRunId,
          status: "error" as const,
          summary: String(err),
        };
        dedupe.set(`chat:${clientRunId}`, {
          ts: Date.now(),
          ok: false,
          payload,
          error,
        });
        respond(false, payload, error, {
          runId: clientRunId,
          error: formatForLog(err),
        });
      } finally {
        chatAbortControllers.delete(clientRunId);
      }
      break;
    }
    case "wake": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateWakeParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid wake params: ${formatValidationErrors(validateWakeParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as {
        mode: "now" | "next-heartbeat";
        text: string;
      };
      const result = cron.wake({ mode: p.mode, text: p.text });
      respond(true, result, undefined);
      break;
    }
    case "cron.list": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateCronListParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid cron.list params: ${formatValidationErrors(validateCronListParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as { includeDisabled?: boolean };
      const jobs = await cron.list({
        includeDisabled: p.includeDisabled,
      });
      respond(true, { jobs }, undefined);
      break;
    }
    case "cron.status": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateCronStatusParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid cron.status params: ${formatValidationErrors(validateCronStatusParams.errors)}`,
          ),
        );
        break;
      }
      const status = await cron.status();
      respond(true, status, undefined);
      break;
    }
    case "cron.add": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateCronAddParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid cron.add params: ${formatValidationErrors(validateCronAddParams.errors)}`,
          ),
        );
        break;
      }
      const job = await cron.add(params as unknown as CronJobCreate);
      respond(true, job, undefined);
      break;
    }
    case "cron.update": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateCronUpdateParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid cron.update params: ${formatValidationErrors(validateCronUpdateParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as {
        id: string;
        patch: Record<string, unknown>;
      };
      const job = await cron.update(p.id, p.patch as unknown as CronJobPatch);
      respond(true, job, undefined);
      break;
    }
    case "cron.remove": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateCronRemoveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid cron.remove params: ${formatValidationErrors(validateCronRemoveParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as { id: string };
      const result = await cron.remove(p.id);
      respond(true, result, undefined);
      break;
    }
    case "cron.run": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateCronRunParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid cron.run params: ${formatValidationErrors(validateCronRunParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as { id: string; mode?: "due" | "force" };
      const result = await cron.run(p.id, p.mode);
      respond(true, result, undefined);
      break;
    }
    case "cron.runs": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateCronRunsParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid cron.runs params: ${formatValidationErrors(validateCronRunsParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as { id: string; limit?: number };
      const logPath = resolveCronRunLogPath({
        storePath: cronStorePath,
        jobId: p.id,
      });
      const entries = await readCronRunLogEntries(logPath, {
        limit: p.limit,
        jobId: p.id,
      });
      respond(true, { entries }, undefined);
      break;
    }
    case "status": {
      const status = await getStatusSummary();
      respond(true, status, undefined);
      break;
    }
    case "web.login.start": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateWebLoginStartParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid web.login.start params: ${formatValidationErrors(validateWebLoginStartParams.errors)}`,
          ),
        );
        break;
      }
      try {
        await stopWhatsAppProvider();
        const result = await startWebLoginWithQr({
          force: Boolean((params as { force?: boolean }).force),
          timeoutMs:
            typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
              ? (params as { timeoutMs?: number }).timeoutMs
              : undefined,
          verbose: Boolean((params as { verbose?: boolean }).verbose),
        });
        respond(true, result, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "web.login.wait": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateWebLoginWaitParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid web.login.wait params: ${formatValidationErrors(validateWebLoginWaitParams.errors)}`,
          ),
        );
        break;
      }
      try {
        const result = await waitForWebLogin({
          timeoutMs:
            typeof (params as { timeoutMs?: unknown }).timeoutMs === "number"
              ? (params as { timeoutMs?: number }).timeoutMs
              : undefined,
        });
        if (result.connected) {
          await startWhatsAppProvider();
        }
        respond(true, result, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "web.logout": {
      try {
        await stopWhatsAppProvider();
        const cleared = await logoutWeb(defaultRuntime);
        markWhatsAppLoggedOut(cleared);
        respond(true, { cleared }, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "telegram.logout": {
      try {
        await stopTelegramProvider();
        const snapshot = await readConfigFileSnapshot();
        if (!snapshot.valid) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "config invalid; fix it before logging out",
            ),
          );
          break;
        }
        const cfg = snapshot.config ?? {};
        const envToken = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
        const hadToken = Boolean(cfg.telegram?.botToken);
        const nextTelegram = cfg.telegram ? { ...cfg.telegram } : undefined;
        if (nextTelegram) {
          delete nextTelegram.botToken;
        }
        const nextCfg = { ...cfg } as ClawdisConfig;
        if (nextTelegram && Object.keys(nextTelegram).length > 0) {
          nextCfg.telegram = nextTelegram;
        } else {
          delete nextCfg.telegram;
        }
        await writeConfigFile(nextCfg);
        respond(
          true,
          { cleared: hadToken, envToken: Boolean(envToken) },
          undefined,
        );
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "models.list": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateModelsListParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
          ),
        );
        break;
      }
      try {
        const models = await loadGatewayModelCatalog();
        respond(true, { models }, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, String(err)),
        );
      }
      break;
    }
    case "config.get": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateConfigGetParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid config.get params: ${formatValidationErrors(validateConfigGetParams.errors)}`,
          ),
        );
        break;
      }
      const snapshot = await readConfigFileSnapshot();
      respond(true, snapshot, undefined);
      break;
    }
    case "config.schema": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateConfigSchemaParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid config.schema params: ${formatValidationErrors(validateConfigSchemaParams.errors)}`,
          ),
        );
        break;
      }
      const schema = buildConfigSchema();
      respond(true, schema, undefined);
      break;
    }
    case "config.set": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateConfigSetParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid config.set params: ${formatValidationErrors(validateConfigSetParams.errors)}`,
          ),
        );
        break;
      }
      const rawValue = (params as { raw?: unknown }).raw;
      if (typeof rawValue !== "string") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "invalid config.set params: raw (string) required",
          ),
        );
        break;
      }
      const parsedRes = parseConfigJson5(rawValue);
      if (!parsedRes.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, parsedRes.error),
        );
        break;
      }
      const validated = validateConfigObject(parsedRes.parsed);
      if (!validated.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "invalid config", {
            details: { issues: validated.issues },
          }),
        );
        break;
      }
      await writeConfigFile(validated.config);
      respond(
        true,
        {
          ok: true,
          path: CONFIG_PATH_CLAWDIS,
          config: validated.config,
        },
        undefined,
      );
      break;
    }
    case "wizard.start": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateWizardStartParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid wizard.start params: ${formatValidationErrors(validateWizardStartParams.errors)}`,
          ),
        );
        break;
      }
      const running = findRunningWizard();
      if (running) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "wizard already running"),
        );
        break;
      }
      const sessionId = randomUUID();
      const opts = {
        mode: params.mode as "local" | "remote" | undefined,
        workspace:
          typeof params.workspace === "string" ? params.workspace : undefined,
      };
      const session = new WizardSession((prompter) =>
        wizardRunner(opts, defaultRuntime, prompter),
      );
      wizardSessions.set(sessionId, session);
      const result = await session.next();
      if (result.done) {
        purgeWizardSession(sessionId);
      }
      respond(true, { sessionId, ...result }, undefined);
      break;
    }
    case "wizard.next": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateWizardNextParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid wizard.next params: ${formatValidationErrors(validateWizardNextParams.errors)}`,
          ),
        );
        break;
      }
      const sessionId = params.sessionId as string;
      const session = wizardSessions.get(sessionId);
      if (!session) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"),
        );
        break;
      }
      const answer = params.answer as
        | { stepId?: string; value?: unknown }
        | undefined;
      if (answer) {
        if (session.getStatus() !== "running") {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "wizard not running"),
          );
          break;
        }
        try {
          await session.answer(String(answer.stepId ?? ""), answer.value);
        } catch (err) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, formatForLog(err)),
          );
          break;
        }
      }
      const result = await session.next();
      if (result.done) {
        purgeWizardSession(sessionId);
      }
      respond(true, result, undefined);
      break;
    }
    case "wizard.cancel": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateWizardCancelParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid wizard.cancel params: ${formatValidationErrors(validateWizardCancelParams.errors)}`,
          ),
        );
        break;
      }
      const sessionId = params.sessionId as string;
      const session = wizardSessions.get(sessionId);
      if (!session) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"),
        );
        break;
      }
      session.cancel();
      const status = {
        status: session.getStatus(),
        error: session.getError(),
      };
      wizardSessions.delete(sessionId);
      respond(true, status, undefined);
      break;
    }
    case "wizard.status": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateWizardStatusParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid wizard.status params: ${formatValidationErrors(validateWizardStatusParams.errors)}`,
          ),
        );
        break;
      }
      const sessionId = params.sessionId as string;
      const session = wizardSessions.get(sessionId);
      if (!session) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "wizard not found"),
        );
        break;
      }
      const status = {
        status: session.getStatus(),
        error: session.getError(),
      };
      if (status.status !== "running") {
        wizardSessions.delete(sessionId);
      }
      respond(true, status, undefined);
      break;
    }
    case "talk.mode": {
      if (
        client &&
        isWebchatConnect(client.connect) &&
        !hasConnectedMobileNode()
      ) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.UNAVAILABLE,
            "talk disabled: no connected iOS/Android nodes",
          ),
        );
        break;
      }
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateTalkModeParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid talk.mode params: ${formatValidationErrors(validateTalkModeParams.errors)}`,
          ),
        );
        break;
      }
      const payload = {
        enabled: (params as { enabled: boolean }).enabled,
        phase: (params as { phase?: string }).phase ?? null,
        ts: Date.now(),
      };
      broadcast("talk.mode", payload, { dropIfSlow: true });
      respond(true, payload, undefined);
      break;
    }
    case "skills.status": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSkillsStatusParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid skills.status params: ${formatValidationErrors(validateSkillsStatusParams.errors)}`,
          ),
        );
        break;
      }
      const cfg = loadConfig();
      const workspaceDirRaw =
        cfg.agent?.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;
      const workspaceDir = resolveUserPath(workspaceDirRaw);
      const report = buildWorkspaceSkillStatus(workspaceDir, {
        config: cfg,
      });
      respond(true, report, undefined);
      break;
    }
    case "skills.install": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSkillsInstallParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid skills.install params: ${formatValidationErrors(validateSkillsInstallParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as {
        name: string;
        installId: string;
        timeoutMs?: number;
      };
      const cfg = loadConfig();
      const workspaceDirRaw =
        cfg.agent?.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;
      const result = await installSkill({
        workspaceDir: workspaceDirRaw,
        skillName: p.name,
        installId: p.installId,
        timeoutMs: p.timeoutMs,
        config: cfg,
      });
      respond(
        result.ok,
        result,
        result.ok
          ? undefined
          : errorShape(ErrorCodes.UNAVAILABLE, result.message),
      );
      break;
    }
    case "skills.update": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSkillsUpdateParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid skills.update params: ${formatValidationErrors(validateSkillsUpdateParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as {
        skillKey: string;
        enabled?: boolean;
        apiKey?: string;
        env?: Record<string, string>;
      };
      const cfg = loadConfig();
      const skills = cfg.skills ? { ...cfg.skills } : {};
      const entries = skills.entries ? { ...skills.entries } : {};
      const current = entries[p.skillKey] ? { ...entries[p.skillKey] } : {};
      if (typeof p.enabled === "boolean") {
        current.enabled = p.enabled;
      }
      if (typeof p.apiKey === "string") {
        const trimmed = p.apiKey.trim();
        if (trimmed) current.apiKey = trimmed;
        else delete current.apiKey;
      }
      if (p.env && typeof p.env === "object") {
        const nextEnv = current.env ? { ...current.env } : {};
        for (const [key, value] of Object.entries(p.env)) {
          const trimmedKey = key.trim();
          if (!trimmedKey) continue;
          const trimmedVal = value.trim();
          if (!trimmedVal) delete nextEnv[trimmedKey];
          else nextEnv[trimmedKey] = trimmedVal;
        }
        current.env = nextEnv;
      }
      entries[p.skillKey] = current;
      skills.entries = entries;
      const nextConfig: ClawdisConfig = {
        ...cfg,
        skills,
      };
      await writeConfigFile(nextConfig);
      respond(
        true,
        { ok: true, skillKey: p.skillKey, config: current },
        undefined,
      );
      break;
    }
    case "sessions.list": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSessionsListParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid sessions.list params: ${formatValidationErrors(validateSessionsListParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as SessionsListParams;
      const cfg = loadConfig();
      const storePath = resolveStorePath(cfg.session?.store);
      const store = loadSessionStore(storePath);
      const result = listSessionsFromStore({
        cfg,
        storePath,
        store,
        opts: p,
      });
      respond(true, result, undefined);
      break;
    }
    case "sessions.patch": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSessionsPatchParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid sessions.patch params: ${formatValidationErrors(validateSessionsPatchParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as SessionsPatchParams;
      const key = String(p.key ?? "").trim();
      if (!key) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "key required"),
        );
        break;
      }

      const cfg = loadConfig();
      const storePath = resolveStorePath(cfg.session?.store);
      const store = loadSessionStore(storePath);
      const now = Date.now();

      const existing = store[key];
      const next: SessionEntry = existing
        ? {
            ...existing,
            updatedAt: Math.max(existing.updatedAt ?? 0, now),
          }
        : { sessionId: randomUUID(), updatedAt: now };

      if ("thinkingLevel" in p) {
        const raw = p.thinkingLevel;
        if (raw === null) {
          delete next.thinkingLevel;
        } else if (raw !== undefined) {
          const normalized = normalizeThinkLevel(String(raw));
          if (!normalized) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                "invalid thinkingLevel (use off|minimal|low|medium|high)",
              ),
            );
            break;
          }
          if (normalized === "off") delete next.thinkingLevel;
          else next.thinkingLevel = normalized;
        }
      }

      if ("verboseLevel" in p) {
        const raw = p.verboseLevel;
        if (raw === null) {
          delete next.verboseLevel;
        } else if (raw !== undefined) {
          const normalized = normalizeVerboseLevel(String(raw));
          if (!normalized) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                'invalid verboseLevel (use "on"|"off")',
              ),
            );
            break;
          }
          if (normalized === "off") delete next.verboseLevel;
          else next.verboseLevel = normalized;
        }
      }

      if ("model" in p) {
        const raw = p.model;
        if (raw === null) {
          delete next.providerOverride;
          delete next.modelOverride;
        } else if (raw !== undefined) {
          const trimmed = String(raw).trim();
          if (!trimmed) {
            respond(
              false,
              undefined,
              errorShape(ErrorCodes.INVALID_REQUEST, "invalid model: empty"),
            );
            break;
          }
          const resolvedDefault = resolveConfiguredModelRef({
            cfg,
            defaultProvider: DEFAULT_PROVIDER,
            defaultModel: DEFAULT_MODEL,
          });
          const aliasIndex = buildModelAliasIndex({
            cfg,
            defaultProvider: resolvedDefault.provider,
          });
          const resolved = resolveModelRefFromString({
            raw: trimmed,
            defaultProvider: resolvedDefault.provider,
            aliasIndex,
          });
          if (!resolved) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `invalid model: ${trimmed}`,
              ),
            );
            break;
          }
          const catalog = await loadGatewayModelCatalog();
          const allowed = buildAllowedModelSet({
            cfg,
            catalog,
            defaultProvider: resolvedDefault.provider,
          });
          const key = modelKey(resolved.ref.provider, resolved.ref.model);
          if (!allowed.allowAny && !allowed.allowedKeys.has(key)) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                `model not allowed: ${key}`,
              ),
            );
            break;
          }
          if (
            resolved.ref.provider === resolvedDefault.provider &&
            resolved.ref.model === resolvedDefault.model
          ) {
            delete next.providerOverride;
            delete next.modelOverride;
          } else {
            next.providerOverride = resolved.ref.provider;
            next.modelOverride = resolved.ref.model;
          }
        }
      }

      if ("sendPolicy" in p) {
        const raw = p.sendPolicy;
        if (raw === null) {
          delete next.sendPolicy;
        } else if (raw !== undefined) {
          const normalized = normalizeSendPolicy(String(raw));
          if (!normalized) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                'invalid sendPolicy (use "allow"|"deny")',
              ),
            );
            break;
          }
          next.sendPolicy = normalized;
        }
      }

      if ("groupActivation" in p) {
        const raw = p.groupActivation;
        if (raw === null) {
          delete next.groupActivation;
        } else if (raw !== undefined) {
          const normalized = normalizeGroupActivation(String(raw));
          if (!normalized) {
            respond(
              false,
              undefined,
              errorShape(
                ErrorCodes.INVALID_REQUEST,
                'invalid groupActivation (use "mention"|"always")',
              ),
            );
            break;
          }
          next.groupActivation = normalized;
        }
      }

      store[key] = next;
      await saveSessionStore(storePath, store);
      const result: SessionsPatchResult = {
        ok: true,
        path: storePath,
        key,
        entry: next,
      };
      respond(true, result, undefined);
      break;
    }
    case "sessions.reset": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSessionsResetParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid sessions.reset params: ${formatValidationErrors(validateSessionsResetParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as SessionsResetParams;
      const key = String(p.key ?? "").trim();
      if (!key) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "key required"),
        );
        break;
      }

      const { storePath, store, entry } = loadSessionEntry(key);
      const now = Date.now();
      const next: SessionEntry = {
        sessionId: randomUUID(),
        updatedAt: now,
        systemSent: false,
        abortedLastRun: false,
        thinkingLevel: entry?.thinkingLevel,
        verboseLevel: entry?.verboseLevel,
        model: entry?.model,
        contextTokens: entry?.contextTokens,
        sendPolicy: entry?.sendPolicy,
        lastChannel: entry?.lastChannel,
        lastTo: entry?.lastTo,
        skillsSnapshot: entry?.skillsSnapshot,
      };
      store[key] = next;
      await saveSessionStore(storePath, store);
      respond(true, { ok: true, key, entry: next }, undefined);
      break;
    }
    case "sessions.delete": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSessionsDeleteParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid sessions.delete params: ${formatValidationErrors(validateSessionsDeleteParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as SessionsDeleteParams;
      const key = String(p.key ?? "").trim();
      if (!key) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "key required"),
        );
        break;
      }

      const mainKey = resolveMainSessionKey(loadConfig());
      if (key === mainKey) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `Cannot delete the main session (${mainKey}).`,
          ),
        );
        break;
      }

      const deleteTranscript =
        typeof p.deleteTranscript === "boolean" ? p.deleteTranscript : true;

      const { storePath, store, entry } = loadSessionEntry(key);
      const sessionId = entry?.sessionId;
      const existed = Boolean(store[key]);
      clearCommandLane(resolveEmbeddedSessionLane(key));
      if (sessionId && isEmbeddedPiRunActive(sessionId)) {
        abortEmbeddedPiRun(sessionId);
        const ended = await waitForEmbeddedPiRunEnd(sessionId, 15_000);
        if (!ended) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              `Session ${key} is still active; try again in a moment.`,
            ),
          );
          break;
        }
      }
      if (existed) delete store[key];
      await saveSessionStore(storePath, store);

      const archived: string[] = [];
      if (deleteTranscript && sessionId) {
        for (const candidate of resolveSessionTranscriptCandidates(
          sessionId,
          storePath,
        )) {
          if (!fs.existsSync(candidate)) continue;
          try {
            archived.push(archiveFileOnDisk(candidate, "deleted"));
          } catch {
            // Best-effort.
          }
        }
      }

      respond(true, { ok: true, key, deleted: existed, archived }, undefined);
      break;
    }
    case "sessions.compact": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSessionsCompactParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid sessions.compact params: ${formatValidationErrors(validateSessionsCompactParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as SessionsCompactParams;
      const key = String(p.key ?? "").trim();
      if (!key) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "key required"),
        );
        break;
      }

      const maxLines =
        typeof p.maxLines === "number" && Number.isFinite(p.maxLines)
          ? Math.max(1, Math.floor(p.maxLines))
          : 400;

      const { storePath, store, entry } = loadSessionEntry(key);
      const sessionId = entry?.sessionId;
      if (!sessionId) {
        respond(
          true,
          { ok: true, key, compacted: false, reason: "no sessionId" },
          undefined,
        );
        break;
      }

      const filePath = resolveSessionTranscriptCandidates(
        sessionId,
        storePath,
      ).find((candidate) => fs.existsSync(candidate));
      if (!filePath) {
        respond(
          true,
          { ok: true, key, compacted: false, reason: "no transcript" },
          undefined,
        );
        break;
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length <= maxLines) {
        respond(
          true,
          { ok: true, key, compacted: false, kept: lines.length },
          undefined,
        );
        break;
      }

      const archived = archiveFileOnDisk(filePath, "bak");
      const keptLines = lines.slice(-maxLines);
      fs.writeFileSync(filePath, `${keptLines.join("\n")}\n`, "utf-8");

      if (store[key]) {
        delete store[key].inputTokens;
        delete store[key].outputTokens;
        delete store[key].totalTokens;
        store[key].updatedAt = Date.now();
        await saveSessionStore(storePath, store);
      }

      respond(
        true,
        {
          ok: true,
          key,
          compacted: true,
          archived,
          kept: keptLines.length,
        },
        undefined,
      );
      break;
    }
    case "last-heartbeat": {
      respond(true, getLastHeartbeatEvent(), undefined);
      break;
    }
    case "set-heartbeats": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      const enabled = params.enabled;
      if (typeof enabled !== "boolean") {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            "invalid set-heartbeats params: enabled (boolean) required",
          ),
        );
        break;
      }
      setHeartbeatsEnabled(enabled);
      respond(true, { ok: true, enabled }, undefined);
      break;
    }
    case "system-presence": {
      const presence = listSystemPresence();
      respond(true, presence, undefined);
      break;
    }
    case "system-event": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      const text = typeof params.text === "string" ? params.text.trim() : "";
      if (!text) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "text required"),
        );
        break;
      }
      const instanceId =
        typeof params.instanceId === "string" ? params.instanceId : undefined;
      const host = typeof params.host === "string" ? params.host : undefined;
      const ip = typeof params.ip === "string" ? params.ip : undefined;
      const mode = typeof params.mode === "string" ? params.mode : undefined;
      const version =
        typeof params.version === "string" ? params.version : undefined;
      const platform =
        typeof params.platform === "string" ? params.platform : undefined;
      const deviceFamily =
        typeof params.deviceFamily === "string"
          ? params.deviceFamily
          : undefined;
      const modelIdentifier =
        typeof params.modelIdentifier === "string"
          ? params.modelIdentifier
          : undefined;
      const lastInputSeconds =
        typeof params.lastInputSeconds === "number" &&
        Number.isFinite(params.lastInputSeconds)
          ? params.lastInputSeconds
          : undefined;
      const reason =
        typeof params.reason === "string" ? params.reason : undefined;
      const tags =
        Array.isArray(params.tags) &&
        params.tags.every((t) => typeof t === "string")
          ? (params.tags as string[])
          : undefined;
      const presenceUpdate = updateSystemPresence({
        text,
        instanceId,
        host,
        ip,
        mode,
        version,
        platform,
        deviceFamily,
        modelIdentifier,
        lastInputSeconds,
        reason,
        tags,
      });
      const isNodePresenceLine = text.startsWith("Node:");
      if (isNodePresenceLine) {
        const next = presenceUpdate.next;
        const changed = new Set(presenceUpdate.changedKeys);
        const reasonValue = next.reason ?? reason;
        const normalizedReason = (reasonValue ?? "").toLowerCase();
        const ignoreReason =
          normalizedReason.startsWith("periodic") ||
          normalizedReason === "heartbeat";
        const hostChanged = changed.has("host");
        const ipChanged = changed.has("ip");
        const versionChanged = changed.has("version");
        const modeChanged = changed.has("mode");
        const reasonChanged = changed.has("reason") && !ignoreReason;
        const hasChanges =
          hostChanged ||
          ipChanged ||
          versionChanged ||
          modeChanged ||
          reasonChanged;
        if (hasChanges) {
          const contextChanged = isSystemEventContextChanged(
            presenceUpdate.key,
          );
          const parts: string[] = [];
          if (contextChanged || hostChanged || ipChanged) {
            const hostLabel = next.host?.trim() || "Unknown";
            const ipLabel = next.ip?.trim();
            parts.push(`Node: ${hostLabel}${ipLabel ? ` (${ipLabel})` : ""}`);
          }
          if (versionChanged) {
            parts.push(`app ${next.version?.trim() || "unknown"}`);
          }
          if (modeChanged) {
            parts.push(`mode ${next.mode?.trim() || "unknown"}`);
          }
          if (reasonChanged) {
            parts.push(`reason ${reasonValue?.trim() || "event"}`);
          }
          const deltaText = parts.join(" · ");
          if (deltaText) {
            enqueueSystemEvent(deltaText, {
              contextKey: presenceUpdate.key,
            });
          }
        }
      } else {
        enqueueSystemEvent(text);
      }
      const nextPresenceVersion = incrementPresenceVersion();
      broadcast(
        "presence",
        { presence: listSystemPresence() },
        {
          dropIfSlow: true,
          stateVersion: {
            presence: nextPresenceVersion,
            health: getHealthVersion(),
          },
        },
      );
      respond(true, { ok: true }, undefined);
      break;
    }
    case "node.pair.request": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodePairRequestParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.pair.request params: ${formatValidationErrors(validateNodePairRequestParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as {
        nodeId: string;
        displayName?: string;
        platform?: string;
        version?: string;
        deviceFamily?: string;
        modelIdentifier?: string;
        caps?: string[];
        commands?: string[];
        remoteIp?: string;
        silent?: boolean;
      };
      try {
        const result = await requestNodePairing({
          nodeId: p.nodeId,
          displayName: p.displayName,
          platform: p.platform,
          version: p.version,
          deviceFamily: p.deviceFamily,
          modelIdentifier: p.modelIdentifier,
          caps: p.caps,
          commands: p.commands,
          remoteIp: p.remoteIp,
          silent: p.silent,
        });
        if (result.status === "pending" && result.created) {
          broadcast("node.pair.requested", result.request, {
            dropIfSlow: true,
          });
        }
        respond(true, result, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "node.pair.list": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodePairListParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.pair.list params: ${formatValidationErrors(validateNodePairListParams.errors)}`,
          ),
        );
        break;
      }
      try {
        const list = await listNodePairing();
        respond(true, list, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "node.pair.approve": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodePairApproveParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.pair.approve params: ${formatValidationErrors(validateNodePairApproveParams.errors)}`,
          ),
        );
        break;
      }
      const { requestId } = params as { requestId: string };
      try {
        const approved = await approveNodePairing(requestId);
        if (!approved) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"),
          );
          break;
        }
        broadcast(
          "node.pair.resolved",
          {
            requestId,
            nodeId: approved.node.nodeId,
            decision: "approved",
            ts: Date.now(),
          },
          { dropIfSlow: true },
        );
        respond(true, approved, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "node.pair.reject": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodePairRejectParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.pair.reject params: ${formatValidationErrors(validateNodePairRejectParams.errors)}`,
          ),
        );
        break;
      }
      const { requestId } = params as { requestId: string };
      try {
        const rejected = await rejectNodePairing(requestId);
        if (!rejected) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "unknown requestId"),
          );
          break;
        }
        broadcast(
          "node.pair.resolved",
          {
            requestId,
            nodeId: rejected.nodeId,
            decision: "rejected",
            ts: Date.now(),
          },
          { dropIfSlow: true },
        );
        respond(true, rejected, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "node.pair.verify": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodePairVerifyParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.pair.verify params: ${formatValidationErrors(validateNodePairVerifyParams.errors)}`,
          ),
        );
        break;
      }
      const { nodeId, token } = params as {
        nodeId: string;
        token: string;
      };
      try {
        const result = await verifyNodeToken(nodeId, token);
        respond(true, result, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "node.rename": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodeRenameParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.rename params: ${formatValidationErrors(validateNodeRenameParams.errors)}`,
          ),
        );
        break;
      }
      const { nodeId, displayName } = params as {
        nodeId: string;
        displayName: string;
      };
      try {
        const trimmed = displayName.trim();
        if (!trimmed) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "displayName required"),
          );
          break;
        }
        const updated = await renamePairedNode(nodeId, trimmed);
        if (!updated) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "unknown nodeId"),
          );
          break;
        }
        respond(
          true,
          { nodeId: updated.nodeId, displayName: updated.displayName },
          undefined,
        );
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "node.list": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodeListParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.list params: ${formatValidationErrors(validateNodeListParams.errors)}`,
          ),
        );
        break;
      }

      try {
        const list = await listNodePairing();
        const pairedById = new Map(list.paired.map((n) => [n.nodeId, n]));

        const connected = bridge?.listConnected?.() ?? [];
        const connectedById = new Map(connected.map((n) => [n.nodeId, n]));

        const nodeIds = new Set<string>([
          ...pairedById.keys(),
          ...connectedById.keys(),
        ]);

        const nodes = [...nodeIds].map((nodeId) => {
          const paired = pairedById.get(nodeId);
          const live = connectedById.get(nodeId);

          const caps = [
            ...new Set(
              (live?.caps ?? paired?.caps ?? [])
                .map((c) => String(c).trim())
                .filter(Boolean),
            ),
          ].sort();

          const commands = [
            ...new Set(
              (live?.commands ?? paired?.commands ?? [])
                .map((c) => String(c).trim())
                .filter(Boolean),
            ),
          ].sort();

          return {
            nodeId,
            displayName: live?.displayName ?? paired?.displayName,
            platform: live?.platform ?? paired?.platform,
            version: live?.version ?? paired?.version,
            deviceFamily: live?.deviceFamily ?? paired?.deviceFamily,
            modelIdentifier: live?.modelIdentifier ?? paired?.modelIdentifier,
            remoteIp: live?.remoteIp ?? paired?.remoteIp,
            caps,
            commands,
            permissions: live?.permissions ?? paired?.permissions,
            paired: Boolean(paired),
            connected: Boolean(live),
          };
        });

        nodes.sort((a, b) => {
          if (a.connected !== b.connected) return a.connected ? -1 : 1;
          const an = (a.displayName ?? a.nodeId).toLowerCase();
          const bn = (b.displayName ?? b.nodeId).toLowerCase();
          if (an < bn) return -1;
          if (an > bn) return 1;
          return a.nodeId.localeCompare(b.nodeId);
        });

        respond(true, { ts: Date.now(), nodes }, undefined);
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "node.describe": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodeDescribeParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.describe params: ${formatValidationErrors(validateNodeDescribeParams.errors)}`,
          ),
        );
        break;
      }
      const { nodeId } = params as { nodeId: string };
      const id = String(nodeId ?? "").trim();
      if (!id) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "nodeId required"),
        );
        break;
      }

      try {
        const list = await listNodePairing();
        const paired = list.paired.find((n) => n.nodeId === id);
        const connected = bridge?.listConnected?.() ?? [];
        const live = connected.find((n) => n.nodeId === id);

        if (!paired && !live) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "unknown nodeId"),
          );
          break;
        }

        const caps = [
          ...new Set(
            (live?.caps ?? paired?.caps ?? [])
              .map((c) => String(c).trim())
              .filter(Boolean),
          ),
        ].sort();

        const commands = [
          ...new Set(
            (live?.commands ?? paired?.commands ?? [])
              .map((c) => String(c).trim())
              .filter(Boolean),
          ),
        ].sort();

        respond(
          true,
          {
            ts: Date.now(),
            nodeId: id,
            displayName: live?.displayName ?? paired?.displayName,
            platform: live?.platform ?? paired?.platform,
            version: live?.version ?? paired?.version,
            deviceFamily: live?.deviceFamily ?? paired?.deviceFamily,
            modelIdentifier: live?.modelIdentifier ?? paired?.modelIdentifier,
            remoteIp: live?.remoteIp ?? paired?.remoteIp,
            caps,
            commands,
            permissions: live?.permissions ?? paired?.permissions,
            paired: Boolean(paired),
            connected: Boolean(live),
          },
          undefined,
        );
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "node.invoke": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateNodeInvokeParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid node.invoke params: ${formatValidationErrors(validateNodeInvokeParams.errors)}`,
          ),
        );
        break;
      }
      if (!bridge) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, "bridge not running"),
        );
        break;
      }
      const p = params as {
        nodeId: string;
        command: string;
        params?: unknown;
        timeoutMs?: number;
        idempotencyKey: string;
      };
      const nodeId = String(p.nodeId ?? "").trim();
      const command = String(p.command ?? "").trim();
      if (!nodeId || !command) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "nodeId and command required"),
        );
        break;
      }

      try {
        const paramsJSON =
          "params" in p && p.params !== undefined
            ? JSON.stringify(p.params)
            : null;
        const res = await bridge.invoke({
          nodeId,
          command,
          paramsJSON,
          timeoutMs: p.timeoutMs,
        });
        if (!res.ok) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.UNAVAILABLE,
              res.error?.message ?? "node invoke failed",
              { details: { nodeError: res.error ?? null } },
            ),
          );
          break;
        }
        const payload =
          typeof res.payloadJSON === "string" && res.payloadJSON.trim()
            ? (() => {
                try {
                  return JSON.parse(res.payloadJSON) as unknown;
                } catch {
                  return { payloadJSON: res.payloadJSON };
                }
              })()
            : undefined;
        respond(
          true,
          {
            ok: true,
            nodeId,
            command,
            payload,
            payloadJSON: res.payloadJSON ?? null,
          },
          undefined,
        );
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.UNAVAILABLE, formatForLog(err)),
        );
      }
      break;
    }
    case "send": {
      const p = (req.params ?? {}) as Record<string, unknown>;
      if (!validateSendParams(p)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid send params: ${formatValidationErrors(validateSendParams.errors)}`,
          ),
        );
        break;
      }
      const params = p as {
        to: string;
        message: string;
        mediaUrl?: string;
        gifPlayback?: boolean;
        provider?: string;
        idempotencyKey: string;
      };
      const idem = params.idempotencyKey;
      const cached = dedupe.get(`send:${idem}`);
      if (cached) {
        respond(cached.ok, cached.payload, cached.error, {
          cached: true,
        });
        break;
      }
      const to = params.to.trim();
      const message = params.message.trim();
      const providerRaw = (params.provider ?? "whatsapp").toLowerCase();
      const provider = providerRaw === "imsg" ? "imessage" : providerRaw;
      try {
        if (provider === "telegram") {
          const cfg = loadConfig();
          const { token } = resolveTelegramToken(cfg);
          const result = await sendMessageTelegram(to, message, {
            mediaUrl: params.mediaUrl,
            verbose: shouldLogVerbose(),
            token: token || undefined,
          });
          const payload = {
            runId: idem,
            messageId: result.messageId,
            chatId: result.chatId,
            provider,
          };
          dedupe.set(`send:${idem}`, {
            ts: Date.now(),
            ok: true,
            payload,
          });
          respond(true, payload, undefined, { provider });
        } else if (provider === "discord") {
          const result = await sendMessageDiscord(to, message, {
            mediaUrl: params.mediaUrl,
            token: process.env.DISCORD_BOT_TOKEN,
          });
          const payload = {
            runId: idem,
            messageId: result.messageId,
            channelId: result.channelId,
            provider,
          };
          dedupe.set(`send:${idem}`, {
            ts: Date.now(),
            ok: true,
            payload,
          });
          respond(true, payload, undefined, { provider });
        } else if (provider === "slack") {
          const result = await sendMessageSlack(to, message, {
            mediaUrl: params.mediaUrl,
            token: process.env.SLACK_BOT_TOKEN,
          });
          const payload = {
            runId: idem,
            messageId: result.messageId,
            channelId: result.channelId,
            provider,
          };
          dedupe.set(`send:${idem}`, {
            ts: Date.now(),
            ok: true,
            payload,
          });
          respond(true, payload, undefined, { provider });
        } else if (provider === "signal") {
          const cfg = loadConfig();
          const host = cfg.signal?.httpHost?.trim() || "127.0.0.1";
          const port = cfg.signal?.httpPort ?? 8080;
          const baseUrl =
            cfg.signal?.httpUrl?.trim() || `http://${host}:${port}`;
          const result = await sendMessageSignal(to, message, {
            mediaUrl: params.mediaUrl,
            baseUrl,
            account: cfg.signal?.account,
          });
          const payload = {
            runId: idem,
            messageId: result.messageId,
            provider,
          };
          dedupe.set(`send:${idem}`, {
            ts: Date.now(),
            ok: true,
            payload,
          });
          respond(true, payload, undefined, { provider });
        } else if (provider === "imessage") {
          const cfg = loadConfig();
          const result = await sendMessageIMessage(to, message, {
            mediaUrl: params.mediaUrl,
            cliPath: cfg.imessage?.cliPath,
            dbPath: cfg.imessage?.dbPath,
            maxBytes: cfg.imessage?.mediaMaxMb
              ? cfg.imessage.mediaMaxMb * 1024 * 1024
              : undefined,
          });
          const payload = {
            runId: idem,
            messageId: result.messageId,
            provider,
          };
          dedupe.set(`send:${idem}`, {
            ts: Date.now(),
            ok: true,
            payload,
          });
          respond(true, payload, undefined, { provider });
        } else {
          const result = await sendMessageWhatsApp(to, message, {
            mediaUrl: params.mediaUrl,
            verbose: shouldLogVerbose(),
            gifPlayback: params.gifPlayback,
          });
          const payload = {
            runId: idem,
            messageId: result.messageId,
            toJid: result.toJid ?? `${to}@s.whatsapp.net`,
            provider,
          };
          dedupe.set(`send:${idem}`, {
            ts: Date.now(),
            ok: true,
            payload,
          });
          respond(true, payload, undefined, { provider });
        }
      } catch (err) {
        const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
        dedupe.set(`send:${idem}`, {
          ts: Date.now(),
          ok: false,
          error,
        });
        respond(false, undefined, error, {
          provider,
          error: formatForLog(err),
        });
      }
      break;
    }
    case "agent": {
      const p = (req.params ?? {}) as Record<string, unknown>;
      if (!validateAgentParams(p)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent params: ${formatValidationErrors(validateAgentParams.errors)}`,
          ),
        );
        break;
      }
      const params = p as {
        message: string;
        to?: string;
        sessionId?: string;
        sessionKey?: string;
        thinking?: string;
        deliver?: boolean;
        channel?: string;
        lane?: string;
        extraSystemPrompt?: string;
        idempotencyKey: string;
        timeout?: number;
      };
      const idem = params.idempotencyKey;
      const cached = dedupe.get(`agent:${idem}`);
      if (cached) {
        respond(cached.ok, cached.payload, cached.error, {
          cached: true,
        });
        break;
      }
      const message = params.message.trim();

      const requestedSessionKey =
        typeof params.sessionKey === "string" && params.sessionKey.trim()
          ? params.sessionKey.trim()
          : undefined;
      let resolvedSessionId = params.sessionId?.trim() || undefined;
      let sessionEntry: SessionEntry | undefined;
      let bestEffortDeliver = false;
      let cfgForAgent: ReturnType<typeof loadConfig> | undefined;

      if (requestedSessionKey) {
        const { cfg, storePath, store, entry } =
          loadSessionEntry(requestedSessionKey);
        cfgForAgent = cfg;
        const now = Date.now();
        const sessionId = entry?.sessionId ?? randomUUID();
        sessionEntry = {
          sessionId,
          updatedAt: now,
          thinkingLevel: entry?.thinkingLevel,
          verboseLevel: entry?.verboseLevel,
          systemSent: entry?.systemSent,
          sendPolicy: entry?.sendPolicy,
          skillsSnapshot: entry?.skillsSnapshot,
          lastChannel: entry?.lastChannel,
          lastTo: entry?.lastTo,
        };
        const sendPolicy = resolveSendPolicy({
          cfg,
          entry,
          sessionKey: requestedSessionKey,
          surface: entry?.surface,
          chatType: entry?.chatType,
        });
        if (sendPolicy === "deny") {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "send blocked by session policy",
            ),
          );
          break;
        }
        if (store) {
          store[requestedSessionKey] = sessionEntry;
          if (storePath) {
            await saveSessionStore(storePath, store);
          }
        }
        resolvedSessionId = sessionId;
        const mainKey = (cfg.session?.mainKey ?? "main").trim() || "main";
        if (requestedSessionKey === mainKey) {
          addChatRun(idem, {
            sessionKey: requestedSessionKey,
            clientRunId: idem,
          });
          bestEffortDeliver = true;
        }
        registerAgentRunContext(idem, { sessionKey: requestedSessionKey });
      }

      const runId = idem;

      const requestedChannelRaw =
        typeof params.channel === "string" ? params.channel.trim() : "";
      const requestedChannelNormalized = requestedChannelRaw
        ? requestedChannelRaw.toLowerCase()
        : "last";
      const requestedChannel =
        requestedChannelNormalized === "imsg"
          ? "imessage"
          : requestedChannelNormalized;

      const lastChannel = sessionEntry?.lastChannel;
      const lastTo =
        typeof sessionEntry?.lastTo === "string"
          ? sessionEntry.lastTo.trim()
          : "";

      const resolvedChannel = (() => {
        if (requestedChannel === "last") {
          // WebChat is not a deliverable surface. Treat it as "unset" for routing,
          // so VoiceWake and CLI callers don't get stuck with deliver=false.
          return lastChannel && lastChannel !== "webchat"
            ? lastChannel
            : "whatsapp";
        }
        if (
          requestedChannel === "whatsapp" ||
          requestedChannel === "telegram" ||
          requestedChannel === "discord" ||
          requestedChannel === "signal" ||
          requestedChannel === "imessage" ||
          requestedChannel === "webchat"
        ) {
          return requestedChannel;
        }
        return lastChannel && lastChannel !== "webchat"
          ? lastChannel
          : "whatsapp";
      })();

      const resolvedTo = (() => {
        const explicit =
          typeof params.to === "string" && params.to.trim()
            ? params.to.trim()
            : undefined;
        if (explicit) return explicit;
        if (
          resolvedChannel === "whatsapp" ||
          resolvedChannel === "telegram" ||
          resolvedChannel === "discord" ||
          resolvedChannel === "signal" ||
          resolvedChannel === "imessage"
        ) {
          return lastTo || undefined;
        }
        return undefined;
      })();

      const sanitizedTo = (() => {
        // If we derived a WhatsApp recipient from session "lastTo", ensure it is still valid
        // for the configured allowlist. Otherwise, fall back to the first allowed number so
        // voice wake doesn't silently route to stale/test recipients.
        if (resolvedChannel !== "whatsapp") return resolvedTo;
        const explicit =
          typeof params.to === "string" && params.to.trim()
            ? params.to.trim()
            : undefined;
        if (explicit) return resolvedTo;

        const cfg = cfgForAgent ?? loadConfig();
        const rawAllow = cfg.whatsapp?.allowFrom ?? [];
        if (rawAllow.includes("*")) return resolvedTo;
        const allowFrom = rawAllow
          .map((val) => normalizeE164(val))
          .filter((val) => val.length > 1);
        if (allowFrom.length === 0) return resolvedTo;

        const normalizedLast =
          typeof resolvedTo === "string" && resolvedTo.trim()
            ? normalizeE164(resolvedTo)
            : undefined;
        if (normalizedLast && allowFrom.includes(normalizedLast)) {
          return normalizedLast;
        }
        return allowFrom[0];
      })();

      const deliver = params.deliver === true && resolvedChannel !== "webchat";

      const accepted = {
        runId,
        status: "accepted" as const,
        acceptedAt: Date.now(),
      };
      // Store an in-flight ack so retries do not spawn a second run.
      dedupe.set(`agent:${idem}`, {
        ts: Date.now(),
        ok: true,
        payload: accepted,
      });
      respond(true, accepted, undefined, { runId });

      void agentCommand(
        {
          message,
          to: sanitizedTo,
          sessionId: resolvedSessionId,
          thinking: params.thinking,
          deliver,
          provider: resolvedChannel,
          timeout: params.timeout?.toString(),
          bestEffortDeliver,
          surface: "VoiceWake",
          runId,
          lane: params.lane,
          extraSystemPrompt: params.extraSystemPrompt,
        },
        defaultRuntime,
        deps,
      )
        .then(() => {
          const payload = {
            runId,
            status: "ok" as const,
            summary: "completed",
          };
          dedupe.set(`agent:${idem}`, {
            ts: Date.now(),
            ok: true,
            payload,
          });
          // Send a second res frame (same id) so TS clients with expectFinal can wait.
          // Swift clients will typically treat the first res as the result and ignore this.
          respond(true, payload, undefined, { runId });
        })
        .catch((err) => {
          const error = errorShape(ErrorCodes.UNAVAILABLE, String(err));
          const payload = {
            runId,
            status: "error" as const,
            summary: String(err),
          };
          dedupe.set(`agent:${idem}`, {
            ts: Date.now(),
            ok: false,
            payload,
            error,
          });
          respond(false, payload, error, {
            runId,
            error: formatForLog(err),
          });
        });
      break;
    }
    case "agent.wait": {
      const params = (req.params ?? {}) as Record<string, unknown>;
      if (!validateAgentWaitParams(params)) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            `invalid agent.wait params: ${formatValidationErrors(validateAgentWaitParams.errors)}`,
          ),
        );
        break;
      }
      const p = params as AgentWaitParams;
      const runId = p.runId.trim();
      const afterMs =
        typeof p.afterMs === "number" && Number.isFinite(p.afterMs)
          ? Math.max(0, Math.floor(p.afterMs))
          : undefined;
      const timeoutMs =
        typeof p.timeoutMs === "number" && Number.isFinite(p.timeoutMs)
          ? Math.max(0, Math.floor(p.timeoutMs))
          : 30_000;

      const snapshot = await waitForAgentJob({
        runId,
        afterMs,
        timeoutMs,
      });
      if (!snapshot) {
        respond(true, {
          runId,
          status: "timeout",
        });
        break;
      }
      respond(true, {
        runId,
        status: snapshot.state === "done" ? "ok" : "error",
        startedAt: snapshot.startedAt,
        endedAt: snapshot.endedAt,
        error: snapshot.error,
      });
      break;
    }
    default: {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `unknown method: ${req.method}`),
      );
      break;
    }
  }
}
