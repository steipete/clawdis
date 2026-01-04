import crypto from "node:crypto";

import { lookupContextTokens } from "../agents/context.js";
import {
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
} from "../agents/defaults.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
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
  isEmbeddedPiRunStreaming,
  queueEmbeddedPiMessage,
  resolveEmbeddedSessionLane,
  runEmbeddedPiAgent,
} from "../agents/pi-embedded.js";
import {
  buildWorkspaceSkillSnapshot,
  type SkillSnapshot,
} from "../agents/skills.js";
import {
  DEFAULT_AGENT_WORKSPACE_DIR,
  ensureAgentWorkspace,
} from "../agents/workspace.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { type ClawdisConfig, loadConfig } from "../config/config.js";
import {
  buildGroupDisplayName,
  DEFAULT_IDLE_MINUTES,
  DEFAULT_RESET_TRIGGERS,
  loadSessionStore,
  resolveGroupSessionKey,
  resolveSessionKey,
  resolveSessionTranscriptPath,
  resolveStorePath,
  type SessionEntry,
  saveSessionStore,
} from "../config/sessions.js";
import { logVerbose } from "../globals.js";
import { registerAgentRunContext } from "../infra/agent-events.js";
import { buildProviderSummary } from "../infra/provider-summary.js";
import { triggerClawdisRestart } from "../infra/restart.js";
import {
  drainSystemEvents,
  enqueueSystemEvent,
} from "../infra/system-events.js";
import { clearCommandLane, getQueueSize } from "../process/command-queue.js";
import { defaultRuntime } from "../runtime.js";
import { resolveSendPolicy } from "../sessions/send-policy.js";
import { normalizeE164 } from "../utils.js";
import { resolveHeartbeatSeconds } from "../web/reconnect.js";
import { getWebAuthAgeMs, webAuthExists } from "../web/session.js";
import { resolveTextChunkLimit, type TextChunkSurface } from "./chunk.js";
import {
  normalizeGroupActivation,
  parseActivationCommand,
} from "./group-activation.js";
import { stripHeartbeatToken } from "./heartbeat.js";
import { extractModelDirective } from "./model.js";
import { parseSendPolicyCommand } from "./send-policy.js";
import { buildStatusMessage } from "./status.js";
import type { MsgContext, TemplateContext } from "./templating.js";
import {
  normalizeThinkLevel,
  normalizeVerboseLevel,
  type ThinkLevel,
  type VerboseLevel,
} from "./thinking.js";
import { SILENT_REPLY_TOKEN } from "./tokens.js";
import { isAudio, transcribeInboundAudio } from "./transcription.js";
import type { GetReplyOptions, ReplyPayload } from "./types.js";

export type { GetReplyOptions, ReplyPayload } from "./types.js";

const ABORT_TRIGGERS = new Set(["stop", "esc", "abort", "wait", "exit"]);
const ABORT_MEMORY = new Map<string, boolean>();
const SYSTEM_MARK = "⚙️";
const DEFAULT_BLOCK_STREAM_MIN = 800;
const DEFAULT_BLOCK_STREAM_MAX = 1200;

const BLOCK_CHUNK_SURFACES = new Set<TextChunkSurface>([
  "whatsapp",
  "telegram",
  "discord",
  "slack",
  "signal",
  "imessage",
  "webchat",
]);

function normalizeChunkSurface(surface?: string): TextChunkSurface | undefined {
  if (!surface) return undefined;
  const cleaned = surface.trim().toLowerCase();
  return BLOCK_CHUNK_SURFACES.has(cleaned as TextChunkSurface)
    ? (cleaned as TextChunkSurface)
    : undefined;
}

function resolveBlockStreamingChunking(
  cfg: ClawdisConfig | undefined,
  surface?: string,
): {
  minChars: number;
  maxChars: number;
  breakPreference: "paragraph" | "newline" | "sentence";
} {
  const surfaceKey = normalizeChunkSurface(surface);
  const textLimit = resolveTextChunkLimit(cfg, surfaceKey);
  const chunkCfg = cfg?.agent?.blockStreamingChunk;
  const maxRequested = Math.max(
    1,
    Math.floor(chunkCfg?.maxChars ?? DEFAULT_BLOCK_STREAM_MAX),
  );
  const maxChars = Math.max(1, Math.min(maxRequested, textLimit));
  const minRequested = Math.max(
    1,
    Math.floor(chunkCfg?.minChars ?? DEFAULT_BLOCK_STREAM_MIN),
  );
  const minChars = Math.min(minRequested, maxChars);
  const breakPreference =
    chunkCfg?.breakPreference === "newline" ||
    chunkCfg?.breakPreference === "sentence"
      ? chunkCfg.breakPreference
      : "paragraph";
  return { minChars, maxChars, breakPreference };
}

type QueueMode =
  | "steer"
  | "followup"
  | "collect"
  | "steer-backlog"
  | "interrupt"
  | "queue";

type QueueDropPolicy = "old" | "new" | "summarize";

type QueueSettings = {
  mode: QueueMode;
  debounceMs?: number;
  cap?: number;
  dropPolicy?: QueueDropPolicy;
};

type FollowupRun = {
  prompt: string;
  summaryLine?: string;
  enqueuedAt: number;
  run: {
    sessionId: string;
    sessionKey?: string;
    surface?: string;
    sessionFile: string;
    workspaceDir: string;
    config: ClawdisConfig;
    skillsSnapshot?: SkillSnapshot;
    provider: string;
    model: string;
    thinkLevel?: ThinkLevel;
    verboseLevel?: VerboseLevel;
    timeoutMs: number;
    blockReplyBreak: "text_end" | "message_end";
    ownerNumbers?: string[];
    extraSystemPrompt?: string;
    enforceFinalTag?: boolean;
  };
};

type FollowupQueueState = {
  items: FollowupRun[];
  draining: boolean;
  lastEnqueuedAt: number;
  mode: QueueMode;
  debounceMs: number;
  cap: number;
  dropPolicy: QueueDropPolicy;
  droppedCount: number;
  summaryLines: string[];
  lastRun?: FollowupRun["run"];
};

const DEFAULT_QUEUE_DEBOUNCE_MS = 1000;
const DEFAULT_QUEUE_CAP = 20;
const DEFAULT_QUEUE_DROP: QueueDropPolicy = "summarize";

const FOLLOWUP_QUEUES = new Map<string, FollowupQueueState>();

const BARE_SESSION_RESET_PROMPT =
  "A new session was started via /new or /reset. Say hi briefly (1-2 sentences) and ask what the user wants to do next. Do not mention internal steps, files, tools, or reasoning.";

export function extractThinkDirective(body?: string): {
  cleaned: string;
  thinkLevel?: ThinkLevel;
  rawLevel?: string;
  hasDirective: boolean;
} {
  if (!body) return { cleaned: "", hasDirective: false };
  // Match the longest keyword first to avoid partial captures (e.g. "/think:high")
  const match = body.match(
    /(?:^|\s)\/(?:thinking|think|t)\s*:?\s*([a-zA-Z-]+)\b/i,
  );
  const thinkLevel = normalizeThinkLevel(match?.[1]);
  const cleaned = match
    ? body.replace(match[0], "").replace(/\s+/g, " ").trim()
    : body.trim();
  return {
    cleaned,
    thinkLevel,
    rawLevel: match?.[1],
    hasDirective: !!match,
  };
}

export function extractVerboseDirective(body?: string): {
  cleaned: string;
  verboseLevel?: VerboseLevel;
  rawLevel?: string;
  hasDirective: boolean;
} {
  if (!body) return { cleaned: "", hasDirective: false };
  const match = body.match(
    /(?:^|\s)\/(?:verbose|v)(?=$|\s|:)\s*:?\s*([a-zA-Z-]+)\b/i,
  );
  const verboseLevel = normalizeVerboseLevel(match?.[1]);
  const cleaned = match
    ? body.replace(match[0], "").replace(/\s+/g, " ").trim()
    : body.trim();
  return {
    cleaned,
    verboseLevel,
    rawLevel: match?.[1],
    hasDirective: !!match,
  };
}

function normalizeQueueMode(raw?: string): QueueMode | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === "queue" || cleaned === "queued") return "steer";
  if (
    cleaned === "interrupt" ||
    cleaned === "interrupts" ||
    cleaned === "abort"
  )
    return "interrupt";
  if (cleaned === "steer" || cleaned === "steering") return "steer";
  if (
    cleaned === "followup" ||
    cleaned === "follow-ups" ||
    cleaned === "followups"
  )
    return "followup";
  if (cleaned === "collect" || cleaned === "coalesce") return "collect";
  if (
    cleaned === "steer+backlog" ||
    cleaned === "steer-backlog" ||
    cleaned === "steer_backlog"
  )
    return "steer-backlog";
  return undefined;
}

function normalizeQueueDropPolicy(raw?: string): QueueDropPolicy | undefined {
  if (!raw) return undefined;
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === "old" || cleaned === "oldest") return "old";
  if (cleaned === "new" || cleaned === "newest") return "new";
  if (cleaned === "summarize" || cleaned === "summary") return "summarize";
  return undefined;
}

function parseQueueDebounce(raw?: string): number | undefined {
  if (!raw) return undefined;
  try {
    const parsed = parseDurationMs(raw.trim(), { defaultUnit: "ms" });
    if (!parsed || parsed < 0) return undefined;
    return Math.round(parsed);
  } catch {
    return undefined;
  }
}

function parseQueueCap(raw?: string): number | undefined {
  if (!raw) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  const cap = Math.floor(num);
  if (cap < 1) return undefined;
  return cap;
}

function parseQueueDirectiveArgs(raw: string): {
  consumed: number;
  queueMode?: QueueMode;
  queueReset: boolean;
  rawMode?: string;
  debounceMs?: number;
  cap?: number;
  dropPolicy?: QueueDropPolicy;
  rawDebounce?: string;
  rawCap?: string;
  rawDrop?: string;
  hasOptions: boolean;
} {
  let i = 0;
  const len = raw.length;
  while (i < len && /\s/.test(raw[i])) i += 1;
  if (raw[i] === ":") {
    i += 1;
    while (i < len && /\s/.test(raw[i])) i += 1;
  }

  let consumed = i;
  let queueMode: QueueMode | undefined;
  let queueReset = false;
  let rawMode: string | undefined;
  let debounceMs: number | undefined;
  let cap: number | undefined;
  let dropPolicy: QueueDropPolicy | undefined;
  let rawDebounce: string | undefined;
  let rawCap: string | undefined;
  let rawDrop: string | undefined;
  let hasOptions = false;

  const takeToken = (): string | null => {
    if (i >= len) return null;
    const start = i;
    while (i < len && !/\s/.test(raw[i])) i += 1;
    if (start === i) return null;
    const token = raw.slice(start, i);
    while (i < len && /\s/.test(raw[i])) i += 1;
    return token;
  };

  while (i < len) {
    const token = takeToken();
    if (!token) break;
    const lowered = token.trim().toLowerCase();
    if (lowered === "default" || lowered === "reset" || lowered === "clear") {
      queueReset = true;
      consumed = i;
      break;
    }

    if (lowered.startsWith("debounce:") || lowered.startsWith("debounce=")) {
      rawDebounce = token.split(/[:=]/)[1] ?? "";
      debounceMs = parseQueueDebounce(rawDebounce);
      hasOptions = true;
      consumed = i;
      continue;
    }
    if (lowered.startsWith("cap:") || lowered.startsWith("cap=")) {
      rawCap = token.split(/[:=]/)[1] ?? "";
      cap = parseQueueCap(rawCap);
      hasOptions = true;
      consumed = i;
      continue;
    }
    if (lowered.startsWith("drop:") || lowered.startsWith("drop=")) {
      rawDrop = token.split(/[:=]/)[1] ?? "";
      dropPolicy = normalizeQueueDropPolicy(rawDrop);
      hasOptions = true;
      consumed = i;
      continue;
    }

    const mode = normalizeQueueMode(token);
    if (mode) {
      queueMode = mode;
      rawMode = token;
      consumed = i;
      continue;
    }

    // Stop at first unrecognized token.
    break;
  }

  return {
    consumed,
    queueMode,
    queueReset,
    rawMode,
    debounceMs,
    cap,
    dropPolicy,
    rawDebounce,
    rawCap,
    rawDrop,
    hasOptions,
  };
}

export function extractQueueDirective(body?: string): {
  cleaned: string;
  queueMode?: QueueMode;
  queueReset: boolean;
  rawMode?: string;
  hasDirective: boolean;
  debounceMs?: number;
  cap?: number;
  dropPolicy?: QueueDropPolicy;
  rawDebounce?: string;
  rawCap?: string;
  rawDrop?: string;
  hasOptions: boolean;
} {
  if (!body)
    return {
      cleaned: "",
      hasDirective: false,
      queueReset: false,
      hasOptions: false,
    };
  const re = /(?:^|\s)\/queue(?=$|\s|:)/i;
  const match = re.exec(body);
  if (!match) {
    return {
      cleaned: body.trim(),
      hasDirective: false,
      queueReset: false,
      hasOptions: false,
    };
  }
  const start = match.index + match[0].indexOf("/queue");
  const argsStart = start + "/queue".length;
  const args = body.slice(argsStart);
  const parsed = parseQueueDirectiveArgs(args);
  const cleanedRaw =
    body.slice(0, start) + body.slice(argsStart + parsed.consumed);
  const cleaned = cleanedRaw.replace(/\s+/g, " ").trim();
  return {
    cleaned,
    queueMode: parsed.queueMode,
    queueReset: parsed.queueReset,
    rawMode: parsed.rawMode,
    debounceMs: parsed.debounceMs,
    cap: parsed.cap,
    dropPolicy: parsed.dropPolicy,
    rawDebounce: parsed.rawDebounce,
    rawCap: parsed.rawCap,
    rawDrop: parsed.rawDrop,
    hasDirective: true,
    hasOptions: parsed.hasOptions,
  };
}

export function extractReplyToTag(
  text?: string,
  currentMessageId?: string,
): {
  cleaned: string;
  replyToId?: string;
  hasTag: boolean;
} {
  if (!text) return { cleaned: "", hasTag: false };
  let cleaned = text;
  let replyToId: string | undefined;
  let hasTag = false;

  const currentMatch = cleaned.match(/\[\[reply_to_current\]\]/i);
  if (currentMatch) {
    cleaned = cleaned.replace(/\[\[reply_to_current\]\]/gi, " ");
    hasTag = true;
    if (currentMessageId?.trim()) {
      replyToId = currentMessageId.trim();
    }
  }

  const idMatch = cleaned.match(/\[\[reply_to:([^\]\n]+)\]\]/i);
  if (idMatch?.[1]) {
    cleaned = cleaned.replace(/\[\[reply_to:[^\]\n]+\]\]/gi, " ");
    replyToId = idMatch[1].trim();
    hasTag = true;
  }

  cleaned = cleaned
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
  return { cleaned, replyToId, hasTag };
}

function elideText(text: string, limit = 140): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function buildQueueSummaryLine(run: FollowupRun): string {
  const base = run.summaryLine?.trim() || run.prompt.trim();
  const cleaned = base.replace(/\s+/g, " ").trim();
  return elideText(cleaned, 160);
}

function getFollowupQueue(
  key: string,
  settings: QueueSettings,
): FollowupQueueState {
  const existing = FOLLOWUP_QUEUES.get(key);
  if (existing) {
    existing.mode = settings.mode;
    existing.debounceMs =
      typeof settings.debounceMs === "number"
        ? Math.max(0, settings.debounceMs)
        : existing.debounceMs;
    existing.cap =
      typeof settings.cap === "number" && settings.cap > 0
        ? Math.floor(settings.cap)
        : existing.cap;
    existing.dropPolicy = settings.dropPolicy ?? existing.dropPolicy;
    return existing;
  }
  const created: FollowupQueueState = {
    items: [],
    draining: false,
    lastEnqueuedAt: 0,
    mode: settings.mode,
    debounceMs:
      typeof settings.debounceMs === "number"
        ? Math.max(0, settings.debounceMs)
        : DEFAULT_QUEUE_DEBOUNCE_MS,
    cap:
      typeof settings.cap === "number" && settings.cap > 0
        ? Math.floor(settings.cap)
        : DEFAULT_QUEUE_CAP,
    dropPolicy: settings.dropPolicy ?? DEFAULT_QUEUE_DROP,
    droppedCount: 0,
    summaryLines: [],
  };
  FOLLOWUP_QUEUES.set(key, created);
  return created;
}

function enqueueFollowupRun(
  key: string,
  run: FollowupRun,
  settings: QueueSettings,
): boolean {
  const queue = getFollowupQueue(key, settings);
  queue.lastEnqueuedAt = Date.now();
  queue.lastRun = run.run;

  const cap = queue.cap;
  if (cap > 0 && queue.items.length >= cap) {
    if (queue.dropPolicy === "new") {
      return false;
    }

    const dropCount = queue.items.length - cap + 1;
    const dropped = queue.items.splice(0, dropCount);
    if (queue.dropPolicy === "summarize") {
      for (const item of dropped) {
        queue.droppedCount += 1;
        queue.summaryLines.push(buildQueueSummaryLine(item));
      }
      while (queue.summaryLines.length > cap) queue.summaryLines.shift();
    }
  }

  queue.items.push(run);
  return true;
}

async function waitForQueueDebounce(queue: FollowupQueueState): Promise<void> {
  const debounceMs = Math.max(0, queue.debounceMs);
  if (debounceMs <= 0) return;
  while (true) {
    const since = Date.now() - queue.lastEnqueuedAt;
    if (since >= debounceMs) return;
    await new Promise((resolve) => setTimeout(resolve, debounceMs - since));
  }
}

function buildSummaryPrompt(queue: FollowupQueueState): string | undefined {
  if (queue.dropPolicy !== "summarize" || queue.droppedCount <= 0) {
    return undefined;
  }
  const lines = [
    `[Queue overflow] Dropped ${queue.droppedCount} message${queue.droppedCount === 1 ? "" : "s"} due to cap.`,
  ];
  if (queue.summaryLines.length > 0) {
    lines.push("Summary:");
    for (const line of queue.summaryLines) {
      lines.push(`- ${line}`);
    }
  }
  queue.droppedCount = 0;
  queue.summaryLines = [];
  return lines.join("\n");
}

function buildCollectPrompt(items: FollowupRun[], summary?: string): string {
  const blocks: string[] = ["[Queued messages while agent was busy]"];
  if (summary) {
    blocks.push(summary);
  }
  items.forEach((item, idx) => {
    blocks.push(`---\nQueued #${idx + 1}\n${item.prompt}`.trim());
  });
  return blocks.join("\n\n");
}

function scheduleFollowupDrain(
  key: string,
  runFollowup: (run: FollowupRun) => Promise<void>,
): void {
  const queue = FOLLOWUP_QUEUES.get(key);
  if (!queue || queue.draining) return;
  queue.draining = true;
  void (async () => {
    try {
      while (queue.items.length > 0 || queue.droppedCount > 0) {
        await waitForQueueDebounce(queue);
        if (queue.mode === "collect") {
          const items = queue.items.splice(0, queue.items.length);
          const summary = buildSummaryPrompt(queue);
          const run = items.at(-1)?.run ?? queue.lastRun;
          if (!run) break;
          const prompt = buildCollectPrompt(items, summary);
          await runFollowup({
            prompt,
            run,
            enqueuedAt: Date.now(),
          });
          continue;
        }

        const summaryPrompt = buildSummaryPrompt(queue);
        if (summaryPrompt) {
          const run = queue.lastRun;
          if (!run) break;
          await runFollowup({
            prompt: summaryPrompt,
            run,
            enqueuedAt: Date.now(),
          });
          continue;
        }

        const next = queue.items.shift();
        if (!next) break;
        await runFollowup(next);
      }
    } catch (err) {
      defaultRuntime.error?.(
        `followup queue drain failed for ${key}: ${String(err)}`,
      );
    } finally {
      queue.draining = false;
      if (queue.items.length === 0 && queue.droppedCount === 0) {
        FOLLOWUP_QUEUES.delete(key);
      } else {
        scheduleFollowupDrain(key, runFollowup);
      }
    }
  })();
}

function isAbortTrigger(text?: string): boolean {
  if (!text) return false;
  const normalized = text.trim().toLowerCase();
  return ABORT_TRIGGERS.has(normalized);
}

function stripStructuralPrefixes(text: string): string {
  // Ignore wrapper labels, timestamps, and sender prefixes so directive-only
  // detection still works in group batches that include history/context.
  const marker = "[Current message - respond to this]";
  const afterMarker = text.includes(marker)
    ? text.slice(text.indexOf(marker) + marker.length)
    : text;
  return afterMarker
    .replace(/\[[^\]]+\]\s*/g, "")
    .replace(/^[ \t]*[A-Za-z0-9+()\-_. ]+:\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMentions(
  text: string,
  ctx: MsgContext,
  cfg: ClawdisConfig | undefined,
): string {
  let result = text;
  const patterns = cfg?.routing?.groupChat?.mentionPatterns ?? [];
  for (const p of patterns) {
    try {
      const re = new RegExp(p, "gi");
      result = result.replace(re, " ");
    } catch {
      // ignore invalid regex
    }
  }
  const selfE164 = (ctx.To ?? "").replace(/^whatsapp:/, "");
  if (selfE164) {
    const esc = selfE164.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result
      .replace(new RegExp(esc, "gi"), " ")
      .replace(new RegExp(`@${esc}`, "gi"), " ");
  }
  // Generic mention patterns like @123456789 or plain digits
  result = result.replace(/@[0-9+]{5,}/g, " ");
  // Discord-style mentions (<@123> or <@!123>)
  result = result.replace(/<@!?\d+>/g, " ");
  return result.replace(/\s+/g, " ").trim();
}

function defaultQueueModeForSurface(surface?: string): QueueMode {
  const normalized = surface?.trim().toLowerCase();
  if (normalized === "discord") return "collect";
  if (normalized === "webchat") return "collect";
  if (normalized === "whatsapp") return "collect";
  if (normalized === "telegram") return "collect";
  if (normalized === "imessage") return "collect";
  if (normalized === "signal") return "collect";
  return "collect";
}

function resolveQueueSettings(params: {
  cfg: ClawdisConfig;
  surface?: string;
  sessionEntry?: SessionEntry;
  inlineMode?: QueueMode;
  inlineOptions?: Partial<QueueSettings>;
}): QueueSettings {
  const surfaceKey = params.surface?.trim().toLowerCase();
  const queueCfg = params.cfg.routing?.queue;
  const surfaceModeRaw =
    surfaceKey && queueCfg?.bySurface
      ? (queueCfg.bySurface as Record<string, string | undefined>)[surfaceKey]
      : undefined;
  const resolvedMode =
    params.inlineMode ??
    normalizeQueueMode(params.sessionEntry?.queueMode) ??
    normalizeQueueMode(surfaceModeRaw) ??
    normalizeQueueMode(queueCfg?.mode) ??
    defaultQueueModeForSurface(surfaceKey);

  const debounceRaw =
    params.inlineOptions?.debounceMs ??
    params.sessionEntry?.queueDebounceMs ??
    queueCfg?.debounceMs ??
    DEFAULT_QUEUE_DEBOUNCE_MS;
  const capRaw =
    params.inlineOptions?.cap ??
    params.sessionEntry?.queueCap ??
    queueCfg?.cap ??
    DEFAULT_QUEUE_CAP;
  const dropRaw =
    params.inlineOptions?.dropPolicy ??
    params.sessionEntry?.queueDrop ??
    normalizeQueueDropPolicy(queueCfg?.drop) ??
    DEFAULT_QUEUE_DROP;

  return {
    mode: resolvedMode,
    debounceMs:
      typeof debounceRaw === "number" ? Math.max(0, debounceRaw) : undefined,
    cap:
      typeof capRaw === "number" ? Math.max(1, Math.floor(capRaw)) : undefined,
    dropPolicy: dropRaw,
  };
}

export async function getReplyFromConfig(
  ctx: MsgContext,
  opts?: GetReplyOptions,
  configOverride?: ClawdisConfig,
): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const cfg = configOverride ?? loadConfig();
  const workspaceDirRaw = cfg.agent?.workspace ?? DEFAULT_AGENT_WORKSPACE_DIR;
  const agentCfg = cfg.agent;
  const sessionCfg = cfg.session;

  const mainModel = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  const defaultProvider = mainModel.provider;
  const defaultModel = mainModel.model;
  const aliasIndex = buildModelAliasIndex({ cfg, defaultProvider });
  let provider = defaultProvider;
  let model = defaultModel;
  if (opts?.isHeartbeat) {
    const heartbeatRaw = agentCfg?.heartbeat?.model?.trim() ?? "";
    const heartbeatRef = heartbeatRaw
      ? resolveModelRefFromString({
          raw: heartbeatRaw,
          defaultProvider,
          aliasIndex,
        })
      : null;
    if (heartbeatRef) {
      provider = heartbeatRef.ref.provider;
      model = heartbeatRef.ref.model;
    }
  }
  let contextTokens =
    agentCfg?.contextTokens ??
    lookupContextTokens(model) ??
    DEFAULT_CONTEXT_TOKENS;

  // Bootstrap the workspace and the required files (AGENTS.md, SOUL.md, TOOLS.md).
  const workspace = await ensureAgentWorkspace({
    dir: workspaceDirRaw,
    ensureBootstrapFiles: true,
  });
  const workspaceDir = workspace.dir;

  const timeoutSeconds = Math.max(agentCfg?.timeoutSeconds ?? 600, 1);
  const timeoutMs = timeoutSeconds * 1000;
  let started = false;
  const triggerTyping = async () => {
    await opts?.onReplyStart?.();
  };
  const onReplyStart = async () => {
    if (started) return;
    started = true;
    await triggerTyping();
  };
  let typingTimer: NodeJS.Timeout | undefined;
  const configuredTypingSeconds =
    agentCfg?.typingIntervalSeconds ?? sessionCfg?.typingIntervalSeconds;
  const typingIntervalSeconds =
    typeof configuredTypingSeconds === "number" ? configuredTypingSeconds : 6;
  const typingIntervalMs = typingIntervalSeconds * 1000;
  const typingTtlMs = 2 * 60_000;
  const formatTypingTtl = (ms: number) => {
    if (ms % 60_000 === 0) return `${ms / 60_000}m`;
    return `${Math.round(ms / 1000)}s`;
  };
  const cleanupTyping = () => {
    if (typingTtlTimer) {
      clearTimeout(typingTtlTimer);
      typingTtlTimer = undefined;
    }
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = undefined;
    }
  };
  let typingTtlTimer: NodeJS.Timeout | undefined;
  const refreshTypingTtl = () => {
    if (!typingIntervalMs || typingIntervalMs <= 0) return;
    if (typingTtlMs <= 0) return;
    if (typingTtlTimer) {
      clearTimeout(typingTtlTimer);
    }
    typingTtlTimer = setTimeout(() => {
      if (!typingTimer) return;
      defaultRuntime.log(
        `typing TTL reached (${formatTypingTtl(typingTtlMs)}); stopping typing indicator`,
      );
      cleanupTyping();
    }, typingTtlMs);
  };
  const startTypingLoop = async () => {
    if (!opts?.onReplyStart) return;
    if (typingIntervalMs <= 0) return;
    if (typingTimer) return;
    await onReplyStart();
    refreshTypingTtl();
    typingTimer = setInterval(() => {
      void triggerTyping();
    }, typingIntervalMs);
  };
  const startTypingOnText = async (text?: string) => {
    const trimmed = text?.trim();
    if (!trimmed) return;
    if (trimmed === SILENT_REPLY_TOKEN) return;
    refreshTypingTtl();
    await startTypingLoop();
  };
  let transcribedText: string | undefined;

  // Optional audio transcription before templating/session handling.
  if (cfg.routing?.transcribeAudio && isAudio(ctx.MediaType)) {
    const transcribed = await transcribeInboundAudio(cfg, ctx, defaultRuntime);
    if (transcribed?.text) {
      transcribedText = transcribed.text;
      ctx.Body = transcribed.text;
      ctx.Transcript = transcribed.text;
      logVerbose("Replaced Body with audio transcript for reply flow");
    }
  }

  // Optional session handling (conversation reuse + /new resets)
  const mainKey = sessionCfg?.mainKey ?? "main";
  const resetTriggers = sessionCfg?.resetTriggers?.length
    ? sessionCfg.resetTriggers
    : DEFAULT_RESET_TRIGGERS;
  const idleMinutes = Math.max(
    sessionCfg?.idleMinutes ?? DEFAULT_IDLE_MINUTES,
    1,
  );
  const sessionScope = sessionCfg?.scope ?? "per-sender";
  const storePath = resolveStorePath(sessionCfg?.store);
  let sessionStore: ReturnType<typeof loadSessionStore> | undefined;
  let sessionKey: string | undefined;
  let sessionEntry: SessionEntry | undefined;

  let sessionId: string | undefined;
  let isNewSession = false;
  let bodyStripped: string | undefined;
  let systemSent = false;
  let abortedLastRun = false;

  let persistedThinking: string | undefined;
  let persistedVerbose: string | undefined;
  let persistedModelOverride: string | undefined;
  let persistedProviderOverride: string | undefined;

  const groupResolution = resolveGroupSessionKey(ctx);
  const isGroup =
    ctx.ChatType?.trim().toLowerCase() === "group" || Boolean(groupResolution);
  const triggerBodyNormalized = stripStructuralPrefixes(ctx.Body ?? "")
    .trim()
    .toLowerCase();

  const rawBody = ctx.Body ?? "";
  const trimmedBody = rawBody.trim();
  // Timestamp/message prefixes (e.g. "[Dec 4 17:35] ") are added by the
  // web inbox before we get here. They prevented reset triggers like "/new"
  // from matching, so strip structural wrappers when checking for resets.
  const strippedForReset = isGroup
    ? stripMentions(triggerBodyNormalized, ctx, cfg)
    : triggerBodyNormalized;
  for (const trigger of resetTriggers) {
    if (!trigger) continue;
    if (trimmedBody === trigger || strippedForReset === trigger) {
      isNewSession = true;
      bodyStripped = "";
      break;
    }
    const triggerPrefix = `${trigger} `;
    if (
      trimmedBody.startsWith(triggerPrefix) ||
      strippedForReset.startsWith(triggerPrefix)
    ) {
      isNewSession = true;
      bodyStripped = strippedForReset.slice(trigger.length).trimStart();
      break;
    }
  }

  sessionKey = resolveSessionKey(sessionScope, ctx, mainKey);
  sessionStore = loadSessionStore(storePath);
  if (groupResolution?.legacyKey && groupResolution.legacyKey !== sessionKey) {
    const legacyEntry = sessionStore[groupResolution.legacyKey];
    if (legacyEntry && !sessionStore[sessionKey]) {
      sessionStore[sessionKey] = legacyEntry;
      delete sessionStore[groupResolution.legacyKey];
    }
  }
  const entry = sessionStore[sessionKey];
  const idleMs = idleMinutes * 60_000;
  const freshEntry = entry && Date.now() - entry.updatedAt <= idleMs;

  if (!isNewSession && freshEntry) {
    sessionId = entry.sessionId;
    systemSent = entry.systemSent ?? false;
    abortedLastRun = entry.abortedLastRun ?? false;
    persistedThinking = entry.thinkingLevel;
    persistedVerbose = entry.verboseLevel;
    persistedModelOverride = entry.modelOverride;
    persistedProviderOverride = entry.providerOverride;
  } else {
    sessionId = crypto.randomUUID();
    isNewSession = true;
    systemSent = false;
    abortedLastRun = false;
  }

  const baseEntry = !isNewSession && freshEntry ? entry : undefined;
  sessionEntry = {
    ...baseEntry,
    sessionId,
    updatedAt: Date.now(),
    systemSent,
    abortedLastRun,
    // Persist previously stored thinking/verbose levels when present.
    thinkingLevel: persistedThinking ?? baseEntry?.thinkingLevel,
    verboseLevel: persistedVerbose ?? baseEntry?.verboseLevel,
    modelOverride: persistedModelOverride ?? baseEntry?.modelOverride,
    providerOverride: persistedProviderOverride ?? baseEntry?.providerOverride,
    sendPolicy: baseEntry?.sendPolicy,
    queueMode: baseEntry?.queueMode,
    queueDebounceMs: baseEntry?.queueDebounceMs,
    queueCap: baseEntry?.queueCap,
    queueDrop: baseEntry?.queueDrop,
    displayName: baseEntry?.displayName,
    chatType: baseEntry?.chatType,
    surface: baseEntry?.surface,
    subject: baseEntry?.subject,
    room: baseEntry?.room,
    space: baseEntry?.space,
  };
  if (groupResolution?.surface) {
    const surface = groupResolution.surface;
    const subject = ctx.GroupSubject?.trim();
    const space = ctx.GroupSpace?.trim();
    const explicitRoom = ctx.GroupRoom?.trim();
    const isRoomSurface = surface === "discord" || surface === "slack";
    const nextRoom =
      explicitRoom ??
      (isRoomSurface && subject && subject.startsWith("#")
        ? subject
        : undefined);
    const nextSubject = nextRoom ? undefined : subject;
    sessionEntry.chatType = groupResolution.chatType ?? "group";
    sessionEntry.surface = surface;
    if (nextSubject) sessionEntry.subject = nextSubject;
    if (nextRoom) sessionEntry.room = nextRoom;
    if (space) sessionEntry.space = space;
    sessionEntry.displayName = buildGroupDisplayName({
      surface: sessionEntry.surface,
      subject: sessionEntry.subject,
      room: sessionEntry.room,
      space: sessionEntry.space,
      id: groupResolution.id,
      key: sessionKey,
    });
  } else if (!sessionEntry.chatType) {
    sessionEntry.chatType = "direct";
  }
  sessionStore[sessionKey] = sessionEntry;
  await saveSessionStore(storePath, sessionStore);

  const sessionCtx: TemplateContext = {
    ...ctx,
    BodyStripped: bodyStripped ?? ctx.Body,
    SessionId: sessionId,
    IsNewSession: isNewSession ? "true" : "false",
  };

  const {
    cleaned: thinkCleaned,
    thinkLevel: inlineThink,
    rawLevel: rawThinkLevel,
    hasDirective: hasThinkDirective,
  } = extractThinkDirective(sessionCtx.BodyStripped ?? sessionCtx.Body ?? "");
  const {
    cleaned: verboseCleaned,
    verboseLevel: inlineVerbose,
    rawLevel: rawVerboseLevel,
    hasDirective: hasVerboseDirective,
  } = extractVerboseDirective(thinkCleaned);
  const {
    cleaned: modelCleaned,
    rawModel: rawModelDirective,
    hasDirective: hasModelDirective,
  } = extractModelDirective(verboseCleaned);
  const {
    cleaned: queueCleaned,
    queueMode: inlineQueueMode,
    queueReset: inlineQueueReset,
    rawMode: rawQueueMode,
    debounceMs: inlineQueueDebounceMs,
    cap: inlineQueueCap,
    dropPolicy: inlineQueueDrop,
    rawDebounce: rawQueueDebounce,
    rawCap: rawQueueCap,
    rawDrop: rawQueueDrop,
    hasDirective: hasQueueDirective,
  } = extractQueueDirective(modelCleaned);
  sessionCtx.Body = queueCleaned;
  sessionCtx.BodyStripped = queueCleaned;

  const resolveGroupRequireMention = () => {
    const surface =
      groupResolution?.surface ?? ctx.Surface?.trim().toLowerCase();
    const groupId = groupResolution?.id ?? ctx.From?.replace(/^group:/, "");
    if (surface === "telegram") {
      if (groupId) {
        const groupConfig = cfg.telegram?.groups?.[groupId];
        if (typeof groupConfig?.requireMention === "boolean") {
          return groupConfig.requireMention;
        }
      }
      const groupDefault = cfg.telegram?.groups?.["*"]?.requireMention;
      if (typeof groupDefault === "boolean") return groupDefault;
      return true;
    }
    if (surface === "whatsapp") {
      if (groupId) {
        const groupConfig = cfg.whatsapp?.groups?.[groupId];
        if (typeof groupConfig?.requireMention === "boolean") {
          return groupConfig.requireMention;
        }
      }
      const groupDefault = cfg.whatsapp?.groups?.["*"]?.requireMention;
      if (typeof groupDefault === "boolean") return groupDefault;
      return true;
    }
    if (surface === "imessage") {
      if (groupId) {
        const groupConfig = cfg.imessage?.groups?.[groupId];
        if (typeof groupConfig?.requireMention === "boolean") {
          return groupConfig.requireMention;
        }
      }
      const groupDefault = cfg.imessage?.groups?.["*"]?.requireMention;
      if (typeof groupDefault === "boolean") return groupDefault;
      return true;
    }
    return true;
  };

  const defaultGroupActivation = () => {
    const requireMention = resolveGroupRequireMention();
    return requireMention === false ? "always" : "mention";
  };

  let resolvedThinkLevel =
    inlineThink ??
    (sessionEntry?.thinkingLevel as ThinkLevel | undefined) ??
    (agentCfg?.thinkingDefault as ThinkLevel | undefined);

  const resolvedVerboseLevel =
    inlineVerbose ??
    (sessionEntry?.verboseLevel as VerboseLevel | undefined) ??
    (agentCfg?.verboseDefault as VerboseLevel | undefined);
  const resolvedBlockStreaming =
    agentCfg?.blockStreamingDefault === "off" ? "off" : "on";
  const resolvedBlockStreamingBreak =
    agentCfg?.blockStreamingBreak === "message_end"
      ? "message_end"
      : "text_end";
  const blockStreamingEnabled = resolvedBlockStreaming === "on";
  const blockReplyChunking = blockStreamingEnabled
    ? resolveBlockStreamingChunking(cfg, sessionCtx.Surface)
    : undefined;
  const streamedPayloadKeys = new Set<string>();
  const pendingStreamedPayloadKeys = new Set<string>();
  const pendingBlockTasks = new Set<Promise<void>>();
  let didStreamBlockReply = false;
  const buildPayloadKey = (payload: ReplyPayload) => {
    const text = payload.text?.trim() ?? "";
    const mediaList = payload.mediaUrls?.length
      ? payload.mediaUrls
      : payload.mediaUrl
        ? [payload.mediaUrl]
        : [];
    return JSON.stringify({
      text,
      mediaList,
      replyToId: payload.replyToId ?? null,
    });
  };
  const shouldEmitToolResult = () => {
    if (!sessionKey || !storePath) {
      return resolvedVerboseLevel === "on";
    }
    try {
      const store = loadSessionStore(storePath);
      const entry = store[sessionKey];
      const current = normalizeVerboseLevel(entry?.verboseLevel);
      if (current) return current === "on";
    } catch {
      // ignore store read failures
    }
    return resolvedVerboseLevel === "on";
  };

  const hasAllowlist = (agentCfg?.allowedModels?.length ?? 0) > 0;
  const hasStoredOverride = Boolean(
    sessionEntry?.modelOverride || sessionEntry?.providerOverride,
  );
  const needsModelCatalog =
    hasModelDirective || hasAllowlist || hasStoredOverride;
  let allowedModelKeys = new Set<string>();
  let allowedModelCatalog: Awaited<ReturnType<typeof loadModelCatalog>> = [];
  let modelCatalog: Awaited<ReturnType<typeof loadModelCatalog>> | null = null;
  let resetModelOverride = false;

  if (needsModelCatalog) {
    modelCatalog = await loadModelCatalog({ config: cfg });
    const allowed = buildAllowedModelSet({
      cfg,
      catalog: modelCatalog,
      defaultProvider,
    });
    allowedModelCatalog = allowed.allowedCatalog;
    allowedModelKeys = allowed.allowedKeys;
  }

  if (sessionEntry && sessionStore && sessionKey && hasStoredOverride) {
    const overrideProvider =
      sessionEntry.providerOverride?.trim() || defaultProvider;
    const overrideModel = sessionEntry.modelOverride?.trim();
    if (overrideModel) {
      const key = modelKey(overrideProvider, overrideModel);
      if (allowedModelKeys.size > 0 && !allowedModelKeys.has(key)) {
        delete sessionEntry.providerOverride;
        delete sessionEntry.modelOverride;
        sessionEntry.updatedAt = Date.now();
        sessionStore[sessionKey] = sessionEntry;
        await saveSessionStore(storePath, sessionStore);
        resetModelOverride = true;
      }
    }
  }

  const storedProviderOverride = sessionEntry?.providerOverride?.trim();
  const storedModelOverride = sessionEntry?.modelOverride?.trim();
  if (storedModelOverride) {
    const candidateProvider = storedProviderOverride || defaultProvider;
    const key = modelKey(candidateProvider, storedModelOverride);
    if (allowedModelKeys.size === 0 || allowedModelKeys.has(key)) {
      provider = candidateProvider;
      model = storedModelOverride;
    }
  }
  let defaultThinkingLevel: ThinkLevel | undefined;
  const resolveDefaultThinkingLevel = async () => {
    if (defaultThinkingLevel) return defaultThinkingLevel;
    let catalogForThinking = modelCatalog ?? allowedModelCatalog;
    if (!catalogForThinking || catalogForThinking.length === 0) {
      modelCatalog = await loadModelCatalog({ config: cfg });
      catalogForThinking = modelCatalog;
    }
    defaultThinkingLevel = resolveThinkingDefault({
      cfg,
      provider,
      model,
      catalog: catalogForThinking,
    });
    return defaultThinkingLevel;
  };
  contextTokens =
    agentCfg?.contextTokens ??
    lookupContextTokens(model) ??
    DEFAULT_CONTEXT_TOKENS;

  const initialModelLabel = `${provider}/${model}`;
  const formatModelSwitchEvent = (label: string, alias?: string) =>
    alias
      ? `Model switched to ${alias} (${label}).`
      : `Model switched to ${label}.`;
  const isModelListAlias =
    hasModelDirective && rawModelDirective?.trim().toLowerCase() === "status";
  const effectiveModelDirective = isModelListAlias
    ? undefined
    : rawModelDirective;

  const directiveOnly = (() => {
    if (
      !hasThinkDirective &&
      !hasVerboseDirective &&
      !hasModelDirective &&
      !hasQueueDirective
    )
      return false;
    const stripped = stripStructuralPrefixes(queueCleaned ?? "");
    const noMentions = isGroup ? stripMentions(stripped, ctx, cfg) : stripped;
    return noMentions.length === 0;
  })();

  if (directiveOnly) {
    if (hasModelDirective && (!rawModelDirective || isModelListAlias)) {
      if (allowedModelCatalog.length === 0) {
        cleanupTyping();
        return { text: "No models available." };
      }
      const current = `${provider}/${model}`;
      const defaultLabel = `${defaultProvider}/${defaultModel}`;
      const header =
        current === defaultLabel
          ? `Models (current: ${current}):`
          : `Models (current: ${current}, default: ${defaultLabel}):`;
      const lines = [header];
      if (resetModelOverride) {
        lines.push(`(previous selection reset to default)`);
      }
      for (const entry of allowedModelCatalog) {
        const label = `${entry.provider}/${entry.id}`;
        const aliases = aliasIndex.byKey.get(label);
        const aliasSuffix =
          aliases && aliases.length > 0
            ? ` (alias: ${aliases.join(", ")})`
            : "";
        const suffix =
          entry.name && entry.name !== entry.id ? ` — ${entry.name}` : "";
        lines.push(`- ${label}${aliasSuffix}${suffix}`);
      }
      cleanupTyping();
      return { text: lines.join("\n") };
    }
    if (hasThinkDirective && !inlineThink) {
      cleanupTyping();
      return {
        text: `Unrecognized thinking level "${rawThinkLevel ?? ""}". Valid levels: off, minimal, low, medium, high.`,
      };
    }
    if (hasVerboseDirective && !inlineVerbose) {
      cleanupTyping();
      return {
        text: `Unrecognized verbose level "${rawVerboseLevel ?? ""}". Valid levels: off, on.`,
      };
    }
    const queueModeInvalid =
      hasQueueDirective &&
      !inlineQueueMode &&
      !inlineQueueReset &&
      Boolean(rawQueueMode);
    const queueDebounceInvalid =
      hasQueueDirective &&
      rawQueueDebounce !== undefined &&
      typeof inlineQueueDebounceMs !== "number";
    const queueCapInvalid =
      hasQueueDirective &&
      rawQueueCap !== undefined &&
      typeof inlineQueueCap !== "number";
    const queueDropInvalid =
      hasQueueDirective && rawQueueDrop !== undefined && !inlineQueueDrop;
    if (
      queueModeInvalid ||
      queueDebounceInvalid ||
      queueCapInvalid ||
      queueDropInvalid
    ) {
      const errors: string[] = [];
      if (queueModeInvalid) {
        errors.push(
          `Unrecognized queue mode "${rawQueueMode ?? ""}". Valid modes: steer, followup, collect, steer+backlog, interrupt.`,
        );
      }
      if (queueDebounceInvalid) {
        errors.push(
          `Invalid debounce "${rawQueueDebounce ?? ""}". Use ms/s/m (e.g. debounce:1500ms, debounce:2s).`,
        );
      }
      if (queueCapInvalid) {
        errors.push(
          `Invalid cap "${rawQueueCap ?? ""}". Use a positive integer (e.g. cap:10).`,
        );
      }
      if (queueDropInvalid) {
        errors.push(
          `Invalid drop policy "${rawQueueDrop ?? ""}". Use drop:old, drop:new, or drop:summarize.`,
        );
      }
      cleanupTyping();
      return { text: errors.join(" ") };
    }

    let modelSelection:
      | { provider: string; model: string; isDefault: boolean; alias?: string }
      | undefined;
    if (hasModelDirective && effectiveModelDirective) {
      const resolved = resolveModelRefFromString({
        raw: effectiveModelDirective,
        defaultProvider,
        aliasIndex,
      });
      if (!resolved) {
        cleanupTyping();
        return {
          text: `Unrecognized model "${effectiveModelDirective}". Use /model to list available models.`,
        };
      }
      const key = modelKey(resolved.ref.provider, resolved.ref.model);
      if (allowedModelKeys.size > 0 && !allowedModelKeys.has(key)) {
        cleanupTyping();
        return {
          text: `Model "${resolved.ref.provider}/${resolved.ref.model}" is not allowed. Use /model to list available models.`,
        };
      }
      const isDefault =
        resolved.ref.provider === defaultProvider &&
        resolved.ref.model === defaultModel;
      modelSelection = {
        provider: resolved.ref.provider,
        model: resolved.ref.model,
        isDefault,
        alias: resolved.alias,
      };
      const nextLabel = `${modelSelection.provider}/${modelSelection.model}`;
      if (nextLabel !== initialModelLabel) {
        enqueueSystemEvent(
          formatModelSwitchEvent(nextLabel, modelSelection.alias),
          {
            contextKey: `model:${nextLabel}`,
          },
        );
      }
    }

    if (sessionEntry && sessionStore && sessionKey) {
      if (hasThinkDirective && inlineThink) {
        if (inlineThink === "off") delete sessionEntry.thinkingLevel;
        else sessionEntry.thinkingLevel = inlineThink;
      }
      if (hasVerboseDirective && inlineVerbose) {
        if (inlineVerbose === "off") delete sessionEntry.verboseLevel;
        else sessionEntry.verboseLevel = inlineVerbose;
      }
      if (modelSelection) {
        if (modelSelection.isDefault) {
          delete sessionEntry.providerOverride;
          delete sessionEntry.modelOverride;
        } else {
          sessionEntry.providerOverride = modelSelection.provider;
          sessionEntry.modelOverride = modelSelection.model;
        }
      }
      if (hasQueueDirective && inlineQueueReset) {
        delete sessionEntry.queueMode;
        delete sessionEntry.queueDebounceMs;
        delete sessionEntry.queueCap;
        delete sessionEntry.queueDrop;
      } else if (hasQueueDirective) {
        if (inlineQueueMode) sessionEntry.queueMode = inlineQueueMode;
        if (typeof inlineQueueDebounceMs === "number") {
          sessionEntry.queueDebounceMs = inlineQueueDebounceMs;
        }
        if (typeof inlineQueueCap === "number") {
          sessionEntry.queueCap = inlineQueueCap;
        }
        if (inlineQueueDrop) {
          sessionEntry.queueDrop = inlineQueueDrop;
        }
      }
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      await saveSessionStore(storePath, sessionStore);
    }

    const parts: string[] = [];
    if (hasThinkDirective && inlineThink) {
      parts.push(
        inlineThink === "off"
          ? "Thinking disabled."
          : `Thinking level set to ${inlineThink}.`,
      );
    }
    if (hasVerboseDirective && inlineVerbose) {
      parts.push(
        inlineVerbose === "off"
          ? `${SYSTEM_MARK} Verbose logging disabled.`
          : `${SYSTEM_MARK} Verbose logging enabled.`,
      );
    }
    if (modelSelection) {
      const label = `${modelSelection.provider}/${modelSelection.model}`;
      const labelWithAlias = modelSelection.alias
        ? `${modelSelection.alias} (${label})`
        : label;
      parts.push(
        modelSelection.isDefault
          ? `Model reset to default (${labelWithAlias}).`
          : `Model set to ${labelWithAlias}.`,
      );
    }
    if (hasQueueDirective && inlineQueueMode) {
      parts.push(`${SYSTEM_MARK} Queue mode set to ${inlineQueueMode}.`);
    } else if (hasQueueDirective && inlineQueueReset) {
      parts.push(`${SYSTEM_MARK} Queue mode reset to default.`);
    }
    if (hasQueueDirective && typeof inlineQueueDebounceMs === "number") {
      parts.push(
        `${SYSTEM_MARK} Queue debounce set to ${inlineQueueDebounceMs}ms.`,
      );
    }
    if (hasQueueDirective && typeof inlineQueueCap === "number") {
      parts.push(`${SYSTEM_MARK} Queue cap set to ${inlineQueueCap}.`);
    }
    if (hasQueueDirective && inlineQueueDrop) {
      parts.push(`${SYSTEM_MARK} Queue drop set to ${inlineQueueDrop}.`);
    }
    const ack = parts.join(" ").trim();
    cleanupTyping();
    return { text: ack || "OK." };
  }

  // Persist inline think/verbose/model settings even when additional content follows.
  if (sessionEntry && sessionStore && sessionKey) {
    let updated = false;
    if (hasThinkDirective && inlineThink) {
      if (inlineThink === "off") {
        delete sessionEntry.thinkingLevel;
      } else {
        sessionEntry.thinkingLevel = inlineThink;
      }
      updated = true;
    }
    if (hasVerboseDirective && inlineVerbose) {
      if (inlineVerbose === "off") {
        delete sessionEntry.verboseLevel;
      } else {
        sessionEntry.verboseLevel = inlineVerbose;
      }
      updated = true;
    }
    if (hasModelDirective && effectiveModelDirective) {
      const resolved = resolveModelRefFromString({
        raw: effectiveModelDirective,
        defaultProvider,
        aliasIndex,
      });
      if (resolved) {
        const key = modelKey(resolved.ref.provider, resolved.ref.model);
        if (allowedModelKeys.size === 0 || allowedModelKeys.has(key)) {
          const isDefault =
            resolved.ref.provider === defaultProvider &&
            resolved.ref.model === defaultModel;
          if (isDefault) {
            delete sessionEntry.providerOverride;
            delete sessionEntry.modelOverride;
          } else {
            sessionEntry.providerOverride = resolved.ref.provider;
            sessionEntry.modelOverride = resolved.ref.model;
          }
          provider = resolved.ref.provider;
          model = resolved.ref.model;
          const nextLabel = `${provider}/${model}`;
          if (nextLabel !== initialModelLabel) {
            enqueueSystemEvent(
              formatModelSwitchEvent(nextLabel, resolved.alias),
              { contextKey: `model:${nextLabel}` },
            );
          }
          contextTokens =
            agentCfg?.contextTokens ??
            lookupContextTokens(model) ??
            DEFAULT_CONTEXT_TOKENS;
          updated = true;
        }
      }
    }
    if (hasQueueDirective && inlineQueueReset) {
      delete sessionEntry.queueMode;
      delete sessionEntry.queueDebounceMs;
      delete sessionEntry.queueCap;
      delete sessionEntry.queueDrop;
      updated = true;
    }
    if (updated) {
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      await saveSessionStore(storePath, sessionStore);
    }
  }
  const perMessageQueueMode =
    hasQueueDirective && !inlineQueueReset ? inlineQueueMode : undefined;
  const perMessageQueueOptions =
    hasQueueDirective && !inlineQueueReset
      ? {
          debounceMs: inlineQueueDebounceMs,
          cap: inlineQueueCap,
          dropPolicy: inlineQueueDrop,
        }
      : undefined;

  const surface = (ctx.Surface ?? "").trim().toLowerCase();
  const isWhatsAppSurface =
    surface === "whatsapp" ||
    (ctx.From ?? "").startsWith("whatsapp:") ||
    (ctx.To ?? "").startsWith("whatsapp:");

  // WhatsApp owner allowlist (E.164 without whatsapp: prefix); used for group activation only.
  const configuredAllowFrom = isWhatsAppSurface
    ? cfg.whatsapp?.allowFrom
    : undefined;
  const from = (ctx.From ?? "").replace(/^whatsapp:/, "");
  const to = (ctx.To ?? "").replace(/^whatsapp:/, "");
  const isEmptyConfig = Object.keys(cfg).length === 0;
  if (isWhatsAppSurface && isEmptyConfig && from && to && from !== to) {
    cleanupTyping();
    return undefined;
  }
  const defaultAllowFrom =
    isWhatsAppSurface &&
    (!configuredAllowFrom || configuredAllowFrom.length === 0) &&
    to
      ? [to]
      : undefined;
  const allowFrom =
    configuredAllowFrom && configuredAllowFrom.length > 0
      ? configuredAllowFrom
      : defaultAllowFrom;
  const abortKey = sessionKey ?? (from || undefined) ?? (to || undefined);
  const rawBodyNormalized = triggerBodyNormalized;
  const commandBodyNormalized = isGroup
    ? stripMentions(rawBodyNormalized, ctx, cfg)
    : rawBodyNormalized;
  const activationCommand = parseActivationCommand(commandBodyNormalized);
  const sendPolicyCommand = parseSendPolicyCommand(commandBodyNormalized);
  const senderE164 = normalizeE164(ctx.SenderE164 ?? "");
  const ownerCandidates = isWhatsAppSurface
    ? (allowFrom ?? []).filter((entry) => entry && entry !== "*")
    : [];
  if (isWhatsAppSurface && ownerCandidates.length === 0 && to) {
    ownerCandidates.push(to);
  }
  const ownerList = ownerCandidates
    .map((entry) => normalizeE164(entry))
    .filter((entry): entry is string => Boolean(entry));
  const isOwnerSender =
    Boolean(senderE164) && ownerList.includes(senderE164 ?? "");

  if (!sessionEntry && abortKey) {
    abortedLastRun = ABORT_MEMORY.get(abortKey) ?? false;
  }

  if (activationCommand.hasCommand) {
    if (!isGroup) {
      cleanupTyping();
      return { text: "⚙️ Group activation only applies to group chats." };
    }
    if (!isOwnerSender) {
      logVerbose(
        `Ignoring /activation from non-owner in group: ${senderE164 || "<unknown>"}`,
      );
      cleanupTyping();
      return undefined;
    }
    if (!activationCommand.mode) {
      cleanupTyping();
      return { text: "⚙️ Usage: /activation mention|always" };
    }
    if (sessionEntry && sessionStore && sessionKey) {
      sessionEntry.groupActivation = activationCommand.mode;
      sessionEntry.groupActivationNeedsSystemIntro = true;
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      await saveSessionStore(storePath, sessionStore);
    }
    cleanupTyping();
    return {
      text: `⚙️ Group activation set to ${activationCommand.mode}.`,
    };
  }

  if (sendPolicyCommand.hasCommand) {
    if (!isOwnerSender) {
      logVerbose(`Ignoring /send from non-owner: ${senderE164 || "<unknown>"}`);
      cleanupTyping();
      return undefined;
    }
    if (!sendPolicyCommand.mode) {
      cleanupTyping();
      return { text: "⚙️ Usage: /send on|off|inherit" };
    }
    if (sessionEntry && sessionStore && sessionKey) {
      if (sendPolicyCommand.mode === "inherit") {
        delete sessionEntry.sendPolicy;
      } else {
        sessionEntry.sendPolicy = sendPolicyCommand.mode;
      }
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      await saveSessionStore(storePath, sessionStore);
    }
    cleanupTyping();
    const label =
      sendPolicyCommand.mode === "inherit"
        ? "inherit"
        : sendPolicyCommand.mode === "allow"
          ? "on"
          : "off";
    return { text: `⚙️ Send policy set to ${label}.` };
  }

  if (
    commandBodyNormalized === "/restart" ||
    commandBodyNormalized === "restart" ||
    commandBodyNormalized.startsWith("/restart ")
  ) {
    if (isGroup && !isOwnerSender) {
      logVerbose(
        `Ignoring /restart from non-owner in group: ${senderE164 || "<unknown>"}`,
      );
      cleanupTyping();
      return undefined;
    }
    const restartMethod = triggerClawdisRestart();
    cleanupTyping();
    return {
      text: `⚙️ Restarting clawdis via ${restartMethod}; give me a few seconds to come back online.`,
    };
  }

  if (
    commandBodyNormalized === "/status" ||
    commandBodyNormalized === "status" ||
    commandBodyNormalized.startsWith("/status ")
  ) {
    if (isGroup && !isOwnerSender) {
      logVerbose(
        `Ignoring /status from non-owner in group: ${senderE164 || "<unknown>"}`,
      );
      cleanupTyping();
      return undefined;
    }
    const webLinked = await webAuthExists();
    const webAuthAgeMs = getWebAuthAgeMs();
    const heartbeatSeconds = resolveHeartbeatSeconds(cfg, undefined);
    const groupActivation = isGroup
      ? (normalizeGroupActivation(sessionEntry?.groupActivation) ??
        defaultGroupActivation())
      : undefined;
    const statusText = buildStatusMessage({
      agent: {
        model,
        contextTokens,
        thinkingDefault: agentCfg?.thinkingDefault,
        verboseDefault: agentCfg?.verboseDefault,
      },
      workspaceDir,
      sessionEntry,
      sessionKey,
      sessionScope,
      storePath,
      groupActivation,
      resolvedThink:
        resolvedThinkLevel ?? (await resolveDefaultThinkingLevel()),
      resolvedVerbose: resolvedVerboseLevel,
      webLinked,
      webAuthAgeMs,
      heartbeatSeconds,
    });
    cleanupTyping();
    return { text: statusText };
  }

  const abortRequested = isAbortTrigger(rawBodyNormalized);

  if (abortRequested) {
    if (sessionEntry && sessionStore && sessionKey) {
      sessionEntry.abortedLastRun = true;
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      await saveSessionStore(storePath, sessionStore);
    } else if (abortKey) {
      ABORT_MEMORY.set(abortKey, true);
    }
    cleanupTyping();
    return { text: "⚙️ Agent was aborted." };
  }

  const sendPolicy = resolveSendPolicy({
    cfg,
    entry: sessionEntry,
    sessionKey,
    surface: sessionEntry?.surface ?? surface,
    chatType: sessionEntry?.chatType,
  });
  if (sendPolicy === "deny") {
    logVerbose(`Send blocked by policy for session ${sessionKey ?? "unknown"}`);
    cleanupTyping();
    return undefined;
  }

  const isFirstTurnInSession = isNewSession || !systemSent;
  const isGroupChat = sessionCtx.ChatType === "group";
  const wasMentioned = ctx.WasMentioned === true;
  const shouldEagerType = !isGroupChat || wasMentioned;
  const shouldInjectGroupIntro =
    isGroupChat &&
    (isFirstTurnInSession || sessionEntry?.groupActivationNeedsSystemIntro);
  const groupIntro = shouldInjectGroupIntro
    ? (() => {
        const activation =
          normalizeGroupActivation(sessionEntry?.groupActivation) ??
          defaultGroupActivation();
        const subject = sessionCtx.GroupSubject?.trim();
        const members = sessionCtx.GroupMembers?.trim();
        const surface = sessionCtx.Surface?.trim().toLowerCase();
        const surfaceLabel = (() => {
          if (!surface) return "chat";
          if (surface === "whatsapp") return "WhatsApp";
          if (surface === "telegram") return "Telegram";
          if (surface === "discord") return "Discord";
          if (surface === "webchat") return "WebChat";
          return `${surface.at(0)?.toUpperCase() ?? ""}${surface.slice(1)}`;
        })();
        const subjectLine = subject
          ? `You are replying inside the ${surfaceLabel} group "${subject}".`
          : `You are replying inside a ${surfaceLabel} group chat.`;
        const membersLine = members ? `Group members: ${members}.` : undefined;
        const activationLine =
          activation === "always"
            ? "Activation: always-on (you receive every group message)."
            : "Activation: trigger-only (you are invoked only when explicitly mentioned; recent context may be included).";
        const silenceLine =
          activation === "always"
            ? `If no response is needed, reply with exactly "${SILENT_REPLY_TOKEN}" (no other text) so Clawdis stays silent.`
            : undefined;
        const cautionLine =
          activation === "always"
            ? "Be extremely selective: reply only when you are directly addressed, asked a question, or can add clear value. Otherwise stay silent."
            : undefined;
        const lurkLine =
          "Be a good group participant: lurk and follow the conversation, but only chime in when you have something genuinely helpful or relevant to add. Don't feel obligated to respond to every message — quality over quantity. Even when lurking silently, you can use emoji reactions to acknowledge messages, show support, or react to humor — reactions are always appreciated and don't clutter the chat.";
        return [
          subjectLine,
          membersLine,
          activationLine,
          silenceLine,
          cautionLine,
          lurkLine,
        ]
          .filter(Boolean)
          .join(" ")
          .concat(" Address the specific sender noted in the message context.");
      })()
    : "";
  const baseBody = sessionCtx.BodyStripped ?? sessionCtx.Body ?? "";
  const rawBodyTrimmed = (ctx.Body ?? "").trim();
  const baseBodyTrimmedRaw = baseBody.trim();
  const isBareSessionReset =
    isNewSession &&
    baseBodyTrimmedRaw.length === 0 &&
    rawBodyTrimmed.length > 0;
  const baseBodyFinal = isBareSessionReset
    ? BARE_SESSION_RESET_PROMPT
    : baseBody;
  const baseBodyTrimmed = baseBodyFinal.trim();
  // Bail early if the cleaned body is empty to avoid sending blank prompts to the agent.
  // This can happen if an inbound platform delivers an empty text message or we strip everything out.
  if (!baseBodyTrimmed) {
    await onReplyStart();
    logVerbose("Inbound body empty after normalization; skipping agent run");
    cleanupTyping();
    return {
      text: "I didn't receive any text in your message. Please resend or add a caption.",
    };
  }
  const abortedHint = abortedLastRun
    ? "Note: The previous agent run was aborted by the user. Resume carefully or ask for clarification."
    : "";
  let prefixedBodyBase = baseBodyFinal;
  if (abortedHint) {
    prefixedBodyBase = `${abortedHint}\n\n${prefixedBodyBase}`;
    if (sessionEntry && sessionStore && sessionKey) {
      sessionEntry.abortedLastRun = false;
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      await saveSessionStore(storePath, sessionStore);
    } else if (abortKey) {
      ABORT_MEMORY.set(abortKey, false);
    }
  }
  const messageIdHint = sessionCtx.MessageSid?.trim()
    ? `[message_id: ${sessionCtx.MessageSid.trim()}]`
    : "";
  if (messageIdHint) {
    prefixedBodyBase = `${prefixedBodyBase}\n${messageIdHint}`;
  }

  // Prepend queued system events (transitions only) and (for new main sessions) a provider snapshot.
  // Token efficiency: we filter out periodic/heartbeat noise and keep the lines compact.
  const isGroupSession =
    sessionEntry?.chatType === "group" || sessionEntry?.chatType === "room";
  const isMainSession =
    !isGroupSession && sessionKey === (sessionCfg?.mainKey ?? "main");
  if (isMainSession) {
    const compactSystemEvent = (line: string): string | null => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const lower = trimmed.toLowerCase();
      if (lower.includes("reason periodic")) return null;
      if (lower.includes("heartbeat")) return null;
      if (trimmed.startsWith("Node:")) {
        // Drop the chatty "last input … ago" segment; keep connect/disconnect/launch reasons.
        return trimmed.replace(/ · last input [^·]+/i, "").trim();
      }
      return trimmed;
    };

    const systemLines: string[] = [];
    const queued = drainSystemEvents();
    systemLines.push(
      ...queued.map(compactSystemEvent).filter((v): v is string => Boolean(v)),
    );
    if (isNewSession) {
      const summary = await buildProviderSummary(cfg);
      if (summary.length > 0) systemLines.unshift(...summary);
    }
    if (systemLines.length > 0) {
      const block = systemLines.map((l) => `System: ${l}`).join("\n");
      prefixedBodyBase = `${block}\n\n${prefixedBodyBase}`;
    }
  }
  if (isFirstTurnInSession && sessionStore && sessionKey) {
    const current = sessionEntry ??
      sessionStore[sessionKey] ?? {
        sessionId: sessionId ?? crypto.randomUUID(),
        updatedAt: Date.now(),
      };
    const skillSnapshot =
      isFirstTurnInSession || !current.skillsSnapshot
        ? buildWorkspaceSkillSnapshot(workspaceDir, { config: cfg })
        : current.skillsSnapshot;
    sessionEntry = {
      ...current,
      sessionId: sessionId ?? current.sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
      systemSent: true,
      skillsSnapshot: skillSnapshot,
    };
    sessionStore[sessionKey] = sessionEntry;
    await saveSessionStore(storePath, sessionStore);
    systemSent = true;
  }

  const skillsSnapshot =
    sessionEntry?.skillsSnapshot ??
    (isFirstTurnInSession
      ? undefined
      : buildWorkspaceSkillSnapshot(workspaceDir, { config: cfg }));
  if (
    skillsSnapshot &&
    sessionStore &&
    sessionKey &&
    !isFirstTurnInSession &&
    !sessionEntry?.skillsSnapshot
  ) {
    const current = sessionEntry ?? {
      sessionId: sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
    };
    sessionEntry = {
      ...current,
      sessionId: sessionId ?? current.sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
      skillsSnapshot,
    };
    sessionStore[sessionKey] = sessionEntry;
    await saveSessionStore(storePath, sessionStore);
  }

  const prefixedBody = transcribedText
    ? [prefixedBodyBase, `Transcript:\n${transcribedText}`]
        .filter(Boolean)
        .join("\n\n")
    : prefixedBodyBase;
  const mediaNote = ctx.MediaPath?.length
    ? `[media attached: ${ctx.MediaPath}${ctx.MediaType ? ` (${ctx.MediaType})` : ""}${ctx.MediaUrl ? ` | ${ctx.MediaUrl}` : ""}]`
    : undefined;
  const mediaReplyHint = mediaNote
    ? "To send an image back, add a line like: MEDIA:https://example.com/image.jpg (no spaces). Keep caption in the text body."
    : undefined;
  let commandBody = mediaNote
    ? [mediaNote, mediaReplyHint, prefixedBody ?? ""]
        .filter(Boolean)
        .join("\n")
        .trim()
    : prefixedBody;

  // Fallback: if a stray leading level token remains, consume it
  if (!resolvedThinkLevel && commandBody) {
    const parts = commandBody.split(/\s+/);
    const maybeLevel = normalizeThinkLevel(parts[0]);
    if (maybeLevel) {
      resolvedThinkLevel = maybeLevel;
      commandBody = parts.slice(1).join(" ").trim();
    }
  }
  if (!resolvedThinkLevel) {
    resolvedThinkLevel = await resolveDefaultThinkingLevel();
  }

  const sessionIdFinal = sessionId ?? crypto.randomUUID();
  const sessionFile = resolveSessionTranscriptPath(sessionIdFinal);

  const queueBodyBase = transcribedText
    ? [baseBodyFinal, `Transcript:\n${transcribedText}`]
        .filter(Boolean)
        .join("\n\n")
    : baseBodyFinal;
  const queuedBody = mediaNote
    ? [mediaNote, mediaReplyHint, queueBodyBase]
        .filter(Boolean)
        .join("\n")
        .trim()
    : queueBodyBase;

  const resolvedQueue = resolveQueueSettings({
    cfg,
    surface: sessionCtx.Surface,
    sessionEntry,
    inlineMode: perMessageQueueMode,
    inlineOptions: perMessageQueueOptions,
  });
  const sessionLaneKey = resolveEmbeddedSessionLane(
    sessionKey ?? sessionIdFinal,
  );
  const laneSize = getQueueSize(sessionLaneKey);
  if (resolvedQueue.mode === "interrupt" && laneSize > 0) {
    const cleared = clearCommandLane(sessionLaneKey);
    const aborted = abortEmbeddedPiRun(sessionIdFinal);
    logVerbose(
      `Interrupting ${sessionLaneKey} (cleared ${cleared}, aborted=${aborted})`,
    );
  }

  const queueKey = sessionKey ?? sessionIdFinal;
  const isActive = isEmbeddedPiRunActive(sessionIdFinal);
  const isStreaming = isEmbeddedPiRunStreaming(sessionIdFinal);
  const shouldSteer =
    resolvedQueue.mode === "steer" || resolvedQueue.mode === "steer-backlog";
  const shouldFollowup =
    resolvedQueue.mode === "followup" ||
    resolvedQueue.mode === "collect" ||
    resolvedQueue.mode === "steer-backlog";

  const followupRun: FollowupRun = {
    prompt: queuedBody,
    summaryLine: baseBodyTrimmedRaw,
    enqueuedAt: Date.now(),
    run: {
      sessionId: sessionIdFinal,
      sessionKey,
      surface: sessionCtx.Surface?.trim().toLowerCase() || undefined,
      sessionFile,
      workspaceDir,
      config: cfg,
      skillsSnapshot,
      provider,
      model,
      thinkLevel: resolvedThinkLevel,
      verboseLevel: resolvedVerboseLevel,
      timeoutMs,
      blockReplyBreak: resolvedBlockStreamingBreak,
      ownerNumbers: ownerList.length > 0 ? ownerList : undefined,
      extraSystemPrompt: groupIntro || undefined,
      enforceFinalTag: provider === "ollama" ? true : undefined,
    },
  };

  if (shouldSteer && isStreaming) {
    const steered = queueEmbeddedPiMessage(sessionIdFinal, queuedBody);
    if (steered && !shouldFollowup) {
      if (sessionEntry && sessionStore && sessionKey) {
        sessionEntry.updatedAt = Date.now();
        sessionStore[sessionKey] = sessionEntry;
        await saveSessionStore(storePath, sessionStore);
      }
      cleanupTyping();
      return undefined;
    }
  }

  if (isActive && (shouldFollowup || resolvedQueue.mode === "steer")) {
    enqueueFollowupRun(queueKey, followupRun, resolvedQueue);
    if (sessionEntry && sessionStore && sessionKey) {
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      await saveSessionStore(storePath, sessionStore);
    }
    cleanupTyping();
    return undefined;
  }

  const sendFollowupPayloads = async (payloads: ReplyPayload[]) => {
    if (!opts?.onBlockReply) {
      logVerbose("followup queue: no onBlockReply handler; dropping payloads");
      return;
    }
    for (const payload of payloads) {
      if (!payload?.text && !payload?.mediaUrl && !payload?.mediaUrls?.length) {
        continue;
      }
      if (
        payload.text?.trim() === SILENT_REPLY_TOKEN &&
        !payload.mediaUrl &&
        !payload.mediaUrls?.length
      ) {
        continue;
      }
      await startTypingOnText(payload.text);
      await opts.onBlockReply(payload);
    }
  };

  const runFollowupTurn = async (queued: FollowupRun) => {
    const runId = crypto.randomUUID();
    if (queued.run.sessionKey) {
      registerAgentRunContext(runId, { sessionKey: queued.run.sessionKey });
    }
    let runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
    try {
      runResult = await runEmbeddedPiAgent({
        sessionId: queued.run.sessionId,
        sessionKey: queued.run.sessionKey,
        surface: queued.run.surface,
        sessionFile: queued.run.sessionFile,
        workspaceDir: queued.run.workspaceDir,
        config: queued.run.config,
        skillsSnapshot: queued.run.skillsSnapshot,
        prompt: queued.prompt,
        extraSystemPrompt: queued.run.extraSystemPrompt,
        ownerNumbers: queued.run.ownerNumbers,
        enforceFinalTag: queued.run.enforceFinalTag,
        provider: queued.run.provider,
        model: queued.run.model,
        thinkLevel: queued.run.thinkLevel,
        verboseLevel: queued.run.verboseLevel,
        timeoutMs: queued.run.timeoutMs,
        runId,
        blockReplyBreak: queued.run.blockReplyBreak,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      defaultRuntime.error?.(`Followup agent failed before reply: ${message}`);
      return;
    }

    const payloadArray = runResult.payloads ?? [];
    if (payloadArray.length === 0) return;
    const sanitizedPayloads = payloadArray.flatMap((payload) => {
      const text = payload.text;
      if (!text || !text.includes("HEARTBEAT_OK")) return [payload];
      const stripped = stripHeartbeatToken(text, { mode: "message" });
      const hasMedia =
        Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
      if (stripped.shouldSkip && !hasMedia) return [];
      return [{ ...payload, text: stripped.text }];
    });

    const replyTaggedPayloads: ReplyPayload[] = sanitizedPayloads
      .map((payload) => {
        const { cleaned, replyToId } = extractReplyToTag(payload.text);
        return {
          ...payload,
          text: cleaned ? cleaned : undefined,
          replyToId: replyToId ?? payload.replyToId,
        };
      })
      .filter(
        (payload) =>
          payload.text ||
          payload.mediaUrl ||
          (payload.mediaUrls && payload.mediaUrls.length > 0),
      );

    if (replyTaggedPayloads.length === 0) return;

    if (sessionStore && sessionKey) {
      const usage = runResult.meta.agentMeta?.usage;
      const modelUsed = runResult.meta.agentMeta?.model ?? defaultModel;
      const contextTokensUsed =
        agentCfg?.contextTokens ??
        lookupContextTokens(modelUsed) ??
        sessionEntry?.contextTokens ??
        DEFAULT_CONTEXT_TOKENS;

      if (usage) {
        const entry = sessionStore[sessionKey];
        if (entry) {
          const input = usage.input ?? 0;
          const output = usage.output ?? 0;
          const promptTokens =
            input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
          sessionStore[sessionKey] = {
            ...entry,
            inputTokens: input,
            outputTokens: output,
            totalTokens:
              promptTokens > 0 ? promptTokens : (usage.total ?? input),
            model: modelUsed,
            contextTokens: contextTokensUsed ?? entry.contextTokens,
            updatedAt: Date.now(),
          };
          if (storePath) {
            await saveSessionStore(storePath, sessionStore);
          }
        }
      } else if (modelUsed || contextTokensUsed) {
        const entry = sessionStore[sessionKey];
        if (entry) {
          sessionStore[sessionKey] = {
            ...entry,
            model: modelUsed ?? entry.model,
            contextTokens: contextTokensUsed ?? entry.contextTokens,
          };
          if (storePath) {
            await saveSessionStore(storePath, sessionStore);
          }
        }
      }
    }

    await sendFollowupPayloads(replyTaggedPayloads);
  };

  const finalizeWithFollowup = <T>(value: T): T => {
    scheduleFollowupDrain(queueKey, runFollowupTurn);
    return value;
  };

  let didLogHeartbeatStrip = false;
  try {
    if (shouldEagerType) {
      await startTypingLoop();
    }
    const runId = crypto.randomUUID();
    if (sessionKey) {
      registerAgentRunContext(runId, { sessionKey });
    }
    let runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
    try {
      runResult = await runEmbeddedPiAgent({
        sessionId: sessionIdFinal,
        sessionKey,
        surface: sessionCtx.Surface?.trim().toLowerCase() || undefined,
        sessionFile,
        workspaceDir,
        config: cfg,
        skillsSnapshot,
        prompt: commandBody,
        extraSystemPrompt: groupIntro || undefined,
        ownerNumbers: ownerList.length > 0 ? ownerList : undefined,
        enforceFinalTag: provider === "ollama" ? true : undefined,
        provider,
        model,
        thinkLevel: resolvedThinkLevel,
        verboseLevel: resolvedVerboseLevel,
        timeoutMs,
        runId,
        blockReplyBreak: resolvedBlockStreamingBreak,
        blockReplyChunking,
        onPartialReply: opts?.onPartialReply
          ? async (payload) => {
              let text = payload.text;
              if (!opts?.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
                const stripped = stripHeartbeatToken(text, { mode: "message" });
                if (stripped.didStrip && !didLogHeartbeatStrip) {
                  didLogHeartbeatStrip = true;
                  logVerbose("Stripped stray HEARTBEAT_OK token from reply");
                }
                if (
                  stripped.shouldSkip &&
                  (payload.mediaUrls?.length ?? 0) === 0
                ) {
                  return;
                }
                text = stripped.text;
              }
              await startTypingOnText(text);
              await opts.onPartialReply?.({
                text,
                mediaUrls: payload.mediaUrls,
              });
            }
          : undefined,
        onBlockReply:
          blockStreamingEnabled && opts?.onBlockReply
            ? async (payload) => {
                let text = payload.text;
                if (!opts?.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
                  const stripped = stripHeartbeatToken(text, {
                    mode: "message",
                  });
                  if (stripped.didStrip && !didLogHeartbeatStrip) {
                    didLogHeartbeatStrip = true;
                    logVerbose("Stripped stray HEARTBEAT_OK token from reply");
                  }
                  const hasMedia = (payload.mediaUrls?.length ?? 0) > 0;
                  if (stripped.shouldSkip && !hasMedia) return;
                  text = stripped.text;
                }
                const tagResult = extractReplyToTag(
                  text,
                  sessionCtx.MessageSid,
                );
                const cleaned = tagResult.cleaned || undefined;
                const hasMedia = (payload.mediaUrls?.length ?? 0) > 0;
                if (!cleaned && !hasMedia) return;
                if (cleaned?.trim() === SILENT_REPLY_TOKEN && !hasMedia) return;
                const blockPayload: ReplyPayload = {
                  text: cleaned,
                  mediaUrls: payload.mediaUrls,
                  mediaUrl: payload.mediaUrls?.[0],
                  replyToId: tagResult.replyToId,
                };
                const payloadKey = buildPayloadKey(blockPayload);
                if (
                  streamedPayloadKeys.has(payloadKey) ||
                  pendingStreamedPayloadKeys.has(payloadKey)
                ) {
                  return;
                }
                pendingStreamedPayloadKeys.add(payloadKey);
                const task = (async () => {
                  await startTypingOnText(cleaned);
                  await opts.onBlockReply?.(blockPayload);
                })()
                  .then(() => {
                    streamedPayloadKeys.add(payloadKey);
                    didStreamBlockReply = true;
                  })
                  .catch((err) => {
                    logVerbose(`block reply delivery failed: ${String(err)}`);
                  })
                  .finally(() => {
                    pendingStreamedPayloadKeys.delete(payloadKey);
                  });
                pendingBlockTasks.add(task);
                void task.finally(() => pendingBlockTasks.delete(task));
              }
            : undefined,
        shouldEmitToolResult,
        onToolResult: opts?.onToolResult
          ? async (payload) => {
              let text = payload.text;
              if (!opts?.isHeartbeat && text?.includes("HEARTBEAT_OK")) {
                const stripped = stripHeartbeatToken(text, { mode: "message" });
                if (stripped.didStrip && !didLogHeartbeatStrip) {
                  didLogHeartbeatStrip = true;
                  logVerbose("Stripped stray HEARTBEAT_OK token from reply");
                }
                if (
                  stripped.shouldSkip &&
                  (payload.mediaUrls?.length ?? 0) === 0
                ) {
                  return;
                }
                text = stripped.text;
              }
              await startTypingOnText(text);
              await opts.onToolResult?.({ text, mediaUrls: payload.mediaUrls });
            }
          : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isContextOverflow =
        /context.*overflow|too large|context window/i.test(message);
      defaultRuntime.error(`Embedded agent failed before reply: ${message}`);
      return finalizeWithFollowup({
        text: isContextOverflow
          ? "⚠️ Context overflow - conversation too long. Starting fresh might help!"
          : `⚠️ Agent failed before reply: ${message}. Check gateway logs for details.`,
      });
    }

    if (
      shouldInjectGroupIntro &&
      sessionEntry &&
      sessionStore &&
      sessionKey &&
      sessionEntry.groupActivationNeedsSystemIntro
    ) {
      sessionEntry.groupActivationNeedsSystemIntro = false;
      sessionEntry.updatedAt = Date.now();
      sessionStore[sessionKey] = sessionEntry;
      await saveSessionStore(storePath, sessionStore);
    }

    const payloadArray = runResult.payloads ?? [];
    if (payloadArray.length === 0) return finalizeWithFollowup(undefined);
    if (pendingBlockTasks.size > 0) {
      await Promise.allSettled(pendingBlockTasks);
    }

    const sanitizedPayloads = opts?.isHeartbeat
      ? payloadArray
      : payloadArray.flatMap((payload) => {
          const text = payload.text;
          if (!text || !text.includes("HEARTBEAT_OK")) return [payload];
          const stripped = stripHeartbeatToken(text, { mode: "message" });
          if (stripped.didStrip && !didLogHeartbeatStrip) {
            didLogHeartbeatStrip = true;
            logVerbose("Stripped stray HEARTBEAT_OK token from reply");
          }
          const hasMedia =
            Boolean(payload.mediaUrl) || (payload.mediaUrls?.length ?? 0) > 0;
          if (stripped.shouldSkip && !hasMedia) return [];
          return [{ ...payload, text: stripped.text }];
        });

    const replyTaggedPayloads: ReplyPayload[] = sanitizedPayloads
      .map((payload) => {
        const { cleaned, replyToId } = extractReplyToTag(
          payload.text,
          sessionCtx.MessageSid,
        );
        return {
          ...payload,
          text: cleaned ? cleaned : undefined,
          replyToId: replyToId ?? payload.replyToId,
        };
      })
      .filter(
        (payload) =>
          payload.text ||
          payload.mediaUrl ||
          (payload.mediaUrls && payload.mediaUrls.length > 0),
      );

    const shouldDropFinalPayloads =
      blockStreamingEnabled && didStreamBlockReply;
    const filteredPayloads = shouldDropFinalPayloads
      ? []
      : blockStreamingEnabled
        ? replyTaggedPayloads.filter(
            (payload) => !streamedPayloadKeys.has(buildPayloadKey(payload)),
          )
        : replyTaggedPayloads;

    if (filteredPayloads.length === 0) return finalizeWithFollowup(undefined);

    const shouldSignalTyping = filteredPayloads.some((payload) => {
      const trimmed = payload.text?.trim();
      if (trimmed && trimmed !== SILENT_REPLY_TOKEN) return true;
      if (payload.mediaUrl) return true;
      if (payload.mediaUrls && payload.mediaUrls.length > 0) return true;
      return false;
    });
    if (shouldSignalTyping) {
      await startTypingLoop();
    }

    if (sessionStore && sessionKey) {
      const usage = runResult.meta.agentMeta?.usage;
      const modelUsed = runResult.meta.agentMeta?.model ?? defaultModel;
      const contextTokensUsed =
        agentCfg?.contextTokens ??
        lookupContextTokens(modelUsed) ??
        sessionEntry?.contextTokens ??
        DEFAULT_CONTEXT_TOKENS;

      if (usage) {
        const entry = sessionEntry ?? sessionStore[sessionKey];
        if (entry) {
          const input = usage.input ?? 0;
          const output = usage.output ?? 0;
          const promptTokens =
            input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
          sessionEntry = {
            ...entry,
            inputTokens: input,
            outputTokens: output,
            totalTokens:
              promptTokens > 0 ? promptTokens : (usage.total ?? input),
            model: modelUsed,
            contextTokens: contextTokensUsed ?? entry.contextTokens,
            updatedAt: Date.now(),
          };
          sessionStore[sessionKey] = sessionEntry;
          await saveSessionStore(storePath, sessionStore);
        }
      } else if (modelUsed || contextTokensUsed) {
        const entry = sessionEntry ?? sessionStore[sessionKey];
        if (entry) {
          sessionEntry = {
            ...entry,
            model: modelUsed ?? entry.model,
            contextTokens: contextTokensUsed ?? entry.contextTokens,
          };
          sessionStore[sessionKey] = sessionEntry;
          await saveSessionStore(storePath, sessionStore);
        }
      }
    }

    // If verbose is enabled and this is a new session, prepend a session hint.
    let finalPayloads = filteredPayloads;
    if (resolvedVerboseLevel === "on" && isNewSession) {
      finalPayloads = [
        { text: `🧭 New session: ${sessionIdFinal}` },
        ...finalPayloads,
      ];
    }

    return finalizeWithFollowup(
      finalPayloads.length === 1 ? finalPayloads[0] : finalPayloads,
    );
  } finally {
    cleanupTyping();
  }
}
