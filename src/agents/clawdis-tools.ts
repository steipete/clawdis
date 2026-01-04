import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import {
  browserCloseTab,
  browserFocusTab,
  browserOpenTab,
  browserSnapshot,
  browserStart,
  browserStatus,
  browserStop,
  browserTabs,
} from "../browser/client.js";
import {
  browserAct,
  browserArmDialog,
  browserArmFileChooser,
  browserConsoleMessages,
  browserNavigate,
  browserPdfSave,
  browserScreenshotAction,
} from "../browser/client-actions.js";
import { resolveBrowserConfig } from "../browser/config.js";
import {
  type CameraFacing,
  cameraTempPath,
  parseCameraClipPayload,
  parseCameraSnapPayload,
  writeBase64ToFile,
} from "../cli/nodes-camera.js";
import {
  canvasSnapshotTempPath,
  parseCanvasSnapshotPayload,
} from "../cli/nodes-canvas.js";
import {
  parseScreenRecordPayload,
  screenRecordTempPath,
  writeScreenRecordToFile,
} from "../cli/nodes-screen.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import {
  type ClawdisConfig,
  type DiscordActionConfig,
  loadConfig,
  type SlackActionConfig,
} from "../config/config.js";
import {
  addRoleDiscord,
  banMemberDiscord,
  createScheduledEventDiscord,
  createThreadDiscord,
  deleteMessageDiscord,
  editMessageDiscord,
  fetchChannelInfoDiscord,
  fetchChannelPermissionsDiscord,
  fetchMemberInfoDiscord,
  fetchReactionsDiscord,
  fetchRoleInfoDiscord,
  fetchVoiceStatusDiscord,
  kickMemberDiscord,
  listGuildChannelsDiscord,
  listGuildEmojisDiscord,
  listPinsDiscord,
  listScheduledEventsDiscord,
  listThreadsDiscord,
  pinMessageDiscord,
  reactMessageDiscord,
  readMessagesDiscord,
  removeRoleDiscord,
  searchMessagesDiscord,
  sendMessageDiscord,
  sendPollDiscord,
  sendStickerDiscord,
  timeoutMemberDiscord,
  unpinMessageDiscord,
  uploadEmojiDiscord,
  uploadStickerDiscord,
} from "../discord/send.js";
import { callGateway } from "../gateway/call.js";
import { detectMime, imageMimeFromFormat } from "../media/mime.js";
import {
  deleteSlackMessage,
  editSlackMessage,
  getSlackChannelInfo,
  getSlackMemberInfo,
  listSlackChannels,
  listSlackEmojis,
  listSlackPins,
  listSlackReactions,
  pinSlackMessage,
  reactSlackMessage,
  readSlackMessages,
  searchSlackMessages,
  sendSlackMessage,
  unpinSlackMessage,
} from "../slack/actions.js";
import { sanitizeToolResultImages } from "./tool-images.js";

// biome-ignore lint/suspicious/noExplicitAny: TypeBox schema type from pi-agent-core uses a different module instance.
type AnyAgentTool = AgentTool<any, unknown>;

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

type GatewayCallOptions = {
  gatewayUrl?: string;
  gatewayToken?: string;
  timeoutMs?: number;
};

function resolveGatewayOptions(opts?: GatewayCallOptions) {
  const url =
    typeof opts?.gatewayUrl === "string" && opts.gatewayUrl.trim()
      ? opts.gatewayUrl.trim()
      : DEFAULT_GATEWAY_URL;
  const token =
    typeof opts?.gatewayToken === "string" && opts.gatewayToken.trim()
      ? opts.gatewayToken.trim()
      : undefined;
  const timeoutMs =
    typeof opts?.timeoutMs === "number" && Number.isFinite(opts.timeoutMs)
      ? Math.max(1, Math.floor(opts.timeoutMs))
      : 10_000;
  return { url, token, timeoutMs };
}

type StringParamOptions = {
  required?: boolean;
  trim?: boolean;
  label?: string;
};

function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string;
function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string | undefined;
function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, trim = true, label = key } = options;
  const raw = params[key];
  if (typeof raw !== "string") {
    if (required) throw new Error(`${label} required`);
    return undefined;
  }
  const value = trim ? raw.trim() : raw;
  if (!value) {
    if (required) throw new Error(`${label} required`);
    return undefined;
  }
  return value;
}

function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions & { required: true },
): string[];
function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options?: StringParamOptions,
): string[] | undefined;
function readStringArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: StringParamOptions = {},
) {
  const { required = false, label = key } = options;
  const raw = params[key];
  if (Array.isArray(raw)) {
    const values = raw
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (values.length === 0) {
      if (required) throw new Error(`${label} required`);
      return undefined;
    }
    return values;
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (!value) {
      if (required) throw new Error(`${label} required`);
      return undefined;
    }
    return [value];
  }
  if (required) throw new Error(`${label} required`);
  return undefined;
}

async function callGatewayTool<T = unknown>(
  method: string,
  opts: GatewayCallOptions,
  params?: unknown,
  extra?: { expectFinal?: boolean },
) {
  const gateway = resolveGatewayOptions(opts);
  return await callGateway<T>({
    url: gateway.url,
    token: gateway.token,
    method,
    params,
    timeoutMs: gateway.timeoutMs,
    expectFinal: extra?.expectFinal,
    clientName: "agent",
    mode: "agent",
  });
}

function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
    details: payload,
  };
}

type SessionKind = "main" | "group" | "cron" | "hook" | "node" | "other";
type SessionListRow = {
  key: string;
  kind: SessionKind;
  provider: string;
  displayName?: string;
  updatedAt?: number | null;
  sessionId?: string;
  model?: string;
  contextTokens?: number | null;
  totalTokens?: number | null;
  thinkingLevel?: string;
  verboseLevel?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  sendPolicy?: string;
  lastChannel?: string;
  lastTo?: string;
  transcriptPath?: string;
  messages?: unknown[];
};

function normalizeKey(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveMainSessionAlias(cfg: ClawdisConfig) {
  const mainKey = normalizeKey(cfg.session?.mainKey) ?? "main";
  const scope = cfg.session?.scope ?? "per-sender";
  const alias = scope === "global" ? "global" : mainKey;
  return { mainKey, alias, scope };
}

function resolveDisplaySessionKey(params: {
  key: string;
  alias: string;
  mainKey: string;
}) {
  if (params.key === params.alias) return "main";
  if (params.key === params.mainKey) return "main";
  return params.key;
}

function resolveInternalSessionKey(params: {
  key: string;
  alias: string;
  mainKey: string;
}) {
  if (params.key === "main") return params.alias;
  return params.key;
}

function classifySessionKind(params: {
  key: string;
  gatewayKind?: string | null;
  alias: string;
  mainKey: string;
}): SessionKind {
  const key = params.key;
  if (key === params.alias || key === params.mainKey) return "main";
  if (key.startsWith("cron:")) return "cron";
  if (key.startsWith("hook:")) return "hook";
  if (key.startsWith("node-") || key.startsWith("node:")) return "node";
  if (params.gatewayKind === "group") return "group";
  if (
    key.startsWith("group:") ||
    key.includes(":group:") ||
    key.includes(":channel:")
  ) {
    return "group";
  }
  return "other";
}

function deriveProvider(params: {
  key: string;
  kind: SessionKind;
  surface?: string | null;
  lastChannel?: string | null;
}): string {
  if (
    params.kind === "cron" ||
    params.kind === "hook" ||
    params.kind === "node"
  )
    return "internal";
  const surface = normalizeKey(params.surface ?? undefined);
  if (surface) return surface;
  const lastChannel = normalizeKey(params.lastChannel ?? undefined);
  if (lastChannel) return lastChannel;
  const parts = params.key.split(":").filter(Boolean);
  if (parts.length >= 3 && (parts[1] === "group" || parts[1] === "channel")) {
    return parts[0];
  }
  return "unknown";
}

function stripToolMessages(messages: unknown[]): unknown[] {
  return messages.filter((msg) => {
    if (!msg || typeof msg !== "object") return true;
    const role = (msg as { role?: unknown }).role;
    return role !== "toolResult";
  });
}

function extractAssistantText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  if ((message as { role?: unknown }).role !== "assistant") return undefined;
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const chunks: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if ((block as { type?: unknown }).type !== "text") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) {
      chunks.push(text);
    }
  }
  const joined = chunks.join("").trim();
  return joined ? joined : undefined;
}

async function imageResult(params: {
  label: string;
  path: string;
  base64: string;
  mimeType: string;
  extraText?: string;
  details?: Record<string, unknown>;
}): Promise<AgentToolResult<unknown>> {
  const content: AgentToolResult<unknown>["content"] = [
    {
      type: "text",
      text: params.extraText ?? `MEDIA:${params.path}`,
    },
    {
      type: "image",
      data: params.base64,
      mimeType: params.mimeType,
    },
  ];
  const result: AgentToolResult<unknown> = {
    content,
    details: { path: params.path, ...params.details },
  };
  return await sanitizeToolResultImages(result, params.label);
}

async function imageResultFromFile(params: {
  label: string;
  path: string;
  extraText?: string;
  details?: Record<string, unknown>;
}): Promise<AgentToolResult<unknown>> {
  const buf = await fs.readFile(params.path);
  const mimeType =
    (await detectMime({ buffer: buf.slice(0, 256) })) ?? "image/png";
  return await imageResult({
    label: params.label,
    path: params.path,
    base64: buf.toString("base64"),
    mimeType,
    extraText: params.extraText,
    details: params.details,
  });
}

function resolveBrowserBaseUrl(controlUrl?: string) {
  const cfg = loadConfig();
  const resolved = resolveBrowserConfig(cfg.browser);
  if (!resolved.enabled && !controlUrl?.trim()) {
    throw new Error(
      "Browser control is disabled. Set browser.enabled=true in ~/.clawdis/clawdis.json.",
    );
  }
  const url = controlUrl?.trim() ? controlUrl.trim() : resolved.controlUrl;
  return url.replace(/\/$/, "");
}

type NodeListNode = {
  nodeId: string;
  displayName?: string;
  platform?: string;
  remoteIp?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  paired?: boolean;
  connected?: boolean;
};

type PendingRequest = {
  requestId: string;
  nodeId: string;
  displayName?: string;
  platform?: string;
  version?: string;
  remoteIp?: string;
  isRepair?: boolean;
  ts: number;
};

type PairedNode = {
  nodeId: string;
  token?: string;
  displayName?: string;
  platform?: string;
  version?: string;
  remoteIp?: string;
  permissions?: Record<string, boolean>;
  createdAtMs?: number;
  approvedAtMs?: number;
};

type PairingList = {
  pending: PendingRequest[];
  paired: PairedNode[];
};

function parseNodeList(value: unknown): NodeListNode[] {
  const obj =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  return Array.isArray(obj.nodes) ? (obj.nodes as NodeListNode[]) : [];
}

function parsePairingList(value: unknown): PairingList {
  const obj =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const pending = Array.isArray(obj.pending)
    ? (obj.pending as PendingRequest[])
    : [];
  const paired = Array.isArray(obj.paired) ? (obj.paired as PairedNode[]) : [];
  return { pending, paired };
}

function normalizeNodeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

async function loadNodes(opts: GatewayCallOptions): Promise<NodeListNode[]> {
  try {
    const res = (await callGatewayTool("node.list", opts, {})) as unknown;
    return parseNodeList(res);
  } catch {
    const res = (await callGatewayTool("node.pair.list", opts, {})) as unknown;
    const { paired } = parsePairingList(res);
    return paired.map((n) => ({
      nodeId: n.nodeId,
      displayName: n.displayName,
      platform: n.platform,
      remoteIp: n.remoteIp,
    }));
  }
}

function pickDefaultNode(nodes: NodeListNode[]): NodeListNode | null {
  const withCanvas = nodes.filter((n) =>
    Array.isArray(n.caps) ? n.caps.includes("canvas") : true,
  );
  if (withCanvas.length === 0) return null;

  const connected = withCanvas.filter((n) => n.connected);
  const candidates = connected.length > 0 ? connected : withCanvas;
  if (candidates.length === 1) return candidates[0];

  const local = candidates.filter(
    (n) =>
      n.platform?.toLowerCase().startsWith("mac") &&
      typeof n.nodeId === "string" &&
      n.nodeId.startsWith("mac-"),
  );
  if (local.length === 1) return local[0];

  return null;
}

async function resolveNodeId(
  opts: GatewayCallOptions,
  query?: string,
  allowDefault = false,
) {
  const nodes = await loadNodes(opts);
  const q = String(query ?? "").trim();
  if (!q) {
    if (allowDefault) {
      const picked = pickDefaultNode(nodes);
      if (picked) return picked.nodeId;
    }
    throw new Error("node required");
  }

  const qNorm = normalizeNodeKey(q);
  const matches = nodes.filter((n) => {
    if (n.nodeId === q) return true;
    if (typeof n.remoteIp === "string" && n.remoteIp === q) return true;
    const name = typeof n.displayName === "string" ? n.displayName : "";
    if (name && normalizeNodeKey(name) === qNorm) return true;
    if (q.length >= 6 && n.nodeId.startsWith(q)) return true;
    return false;
  });

  if (matches.length === 1) return matches[0].nodeId;
  if (matches.length === 0) {
    const known = nodes
      .map((n) => n.displayName || n.remoteIp || n.nodeId)
      .filter(Boolean)
      .join(", ");
    throw new Error(`unknown node: ${q}${known ? ` (known: ${known})` : ""}`);
  }
  throw new Error(
    `ambiguous node: ${q} (matches: ${matches
      .map((n) => n.displayName || n.remoteIp || n.nodeId)
      .join(", ")})`,
  );
}

const BrowserActSchema = Type.Union([
  Type.Object({
    kind: Type.Literal("click"),
    ref: Type.String(),
    targetId: Type.Optional(Type.String()),
    doubleClick: Type.Optional(Type.Boolean()),
    button: Type.Optional(Type.String()),
    modifiers: Type.Optional(Type.Array(Type.String())),
  }),
  Type.Object({
    kind: Type.Literal("type"),
    ref: Type.String(),
    text: Type.String(),
    targetId: Type.Optional(Type.String()),
    submit: Type.Optional(Type.Boolean()),
    slowly: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    kind: Type.Literal("press"),
    key: Type.String(),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("hover"),
    ref: Type.String(),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("drag"),
    startRef: Type.String(),
    endRef: Type.String(),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("select"),
    ref: Type.String(),
    values: Type.Array(Type.String()),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("fill"),
    fields: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("resize"),
    width: Type.Number(),
    height: Type.Number(),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("wait"),
    timeMs: Type.Optional(Type.Number()),
    text: Type.Optional(Type.String()),
    textGone: Type.Optional(Type.String()),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("evaluate"),
    fn: Type.String(),
    ref: Type.Optional(Type.String()),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    kind: Type.Literal("close"),
    targetId: Type.Optional(Type.String()),
  }),
]);

const BrowserToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("status"),
    controlUrl: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("start"),
    controlUrl: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("stop"),
    controlUrl: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("tabs"),
    controlUrl: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("open"),
    controlUrl: Type.Optional(Type.String()),
    targetUrl: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("focus"),
    controlUrl: Type.Optional(Type.String()),
    targetId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("close"),
    controlUrl: Type.Optional(Type.String()),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("snapshot"),
    controlUrl: Type.Optional(Type.String()),
    format: Type.Optional(
      Type.Union([Type.Literal("aria"), Type.Literal("ai")]),
    ),
    targetId: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("screenshot"),
    controlUrl: Type.Optional(Type.String()),
    targetId: Type.Optional(Type.String()),
    fullPage: Type.Optional(Type.Boolean()),
    ref: Type.Optional(Type.String()),
    element: Type.Optional(Type.String()),
    type: Type.Optional(
      Type.Union([Type.Literal("png"), Type.Literal("jpeg")]),
    ),
  }),
  Type.Object({
    action: Type.Literal("navigate"),
    controlUrl: Type.Optional(Type.String()),
    targetUrl: Type.String(),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("console"),
    controlUrl: Type.Optional(Type.String()),
    level: Type.Optional(Type.String()),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("pdf"),
    controlUrl: Type.Optional(Type.String()),
    targetId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("upload"),
    controlUrl: Type.Optional(Type.String()),
    paths: Type.Array(Type.String()),
    ref: Type.Optional(Type.String()),
    inputRef: Type.Optional(Type.String()),
    element: Type.Optional(Type.String()),
    targetId: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("dialog"),
    controlUrl: Type.Optional(Type.String()),
    accept: Type.Boolean(),
    promptText: Type.Optional(Type.String()),
    targetId: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("act"),
    controlUrl: Type.Optional(Type.String()),
    request: BrowserActSchema,
  }),
]);

function createBrowserTool(opts?: {
  defaultControlUrl?: string;
}): AnyAgentTool {
  return {
    label: "Browser",
    name: "browser",
    description:
      "Control clawd's dedicated browser (status/start/stop/tabs/open/snapshot/screenshot/actions). Use snapshot+act for UI automation. Avoid act:wait by default; use only in exceptional cases when no reliable UI state exists.",
    parameters: BrowserToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const controlUrl = readStringParam(params, "controlUrl");
      const baseUrl = resolveBrowserBaseUrl(
        controlUrl ?? opts?.defaultControlUrl,
      );

      switch (action) {
        case "status":
          return jsonResult(await browserStatus(baseUrl));
        case "start":
          await browserStart(baseUrl);
          return jsonResult(await browserStatus(baseUrl));
        case "stop":
          await browserStop(baseUrl);
          return jsonResult(await browserStatus(baseUrl));
        case "tabs":
          return jsonResult({ tabs: await browserTabs(baseUrl) });
        case "open": {
          const targetUrl = readStringParam(params, "targetUrl", {
            required: true,
          });
          return jsonResult(await browserOpenTab(baseUrl, targetUrl));
        }
        case "focus": {
          const targetId = readStringParam(params, "targetId", {
            required: true,
          });
          await browserFocusTab(baseUrl, targetId);
          return jsonResult({ ok: true });
        }
        case "close": {
          const targetId = readStringParam(params, "targetId");
          if (targetId) await browserCloseTab(baseUrl, targetId);
          else await browserAct(baseUrl, { kind: "close" });
          return jsonResult({ ok: true });
        }
        case "snapshot": {
          const format =
            params.format === "ai" || params.format === "aria"
              ? (params.format as "ai" | "aria")
              : "ai";
          const targetId =
            typeof params.targetId === "string"
              ? params.targetId.trim()
              : undefined;
          const limit =
            typeof params.limit === "number" && Number.isFinite(params.limit)
              ? params.limit
              : undefined;
          const snapshot = await browserSnapshot(baseUrl, {
            format,
            targetId,
            limit,
          });
          if (snapshot.format === "ai") {
            return {
              content: [{ type: "text", text: snapshot.snapshot }],
              details: snapshot,
            };
          }
          return jsonResult(snapshot);
        }
        case "screenshot": {
          const targetId = readStringParam(params, "targetId");
          const fullPage = Boolean(params.fullPage);
          const ref = readStringParam(params, "ref");
          const element = readStringParam(params, "element");
          const type = params.type === "jpeg" ? "jpeg" : "png";
          const result = await browserScreenshotAction(baseUrl, {
            targetId,
            fullPage,
            ref,
            element,
            type,
          });
          return await imageResultFromFile({
            label: "browser:screenshot",
            path: result.path,
            details: result,
          });
        }
        case "navigate": {
          const targetUrl = readStringParam(params, "targetUrl", {
            required: true,
          });
          const targetId = readStringParam(params, "targetId");
          return jsonResult(
            await browserNavigate(baseUrl, { url: targetUrl, targetId }),
          );
        }
        case "console": {
          const level =
            typeof params.level === "string" ? params.level.trim() : undefined;
          const targetId =
            typeof params.targetId === "string"
              ? params.targetId.trim()
              : undefined;
          return jsonResult(
            await browserConsoleMessages(baseUrl, { level, targetId }),
          );
        }
        case "pdf": {
          const targetId =
            typeof params.targetId === "string"
              ? params.targetId.trim()
              : undefined;
          const result = await browserPdfSave(baseUrl, { targetId });
          return {
            content: [{ type: "text", text: `FILE:${result.path}` }],
            details: result,
          };
        }
        case "upload": {
          const paths = Array.isArray(params.paths)
            ? params.paths.map((p) => String(p))
            : [];
          if (paths.length === 0) throw new Error("paths required");
          const ref = readStringParam(params, "ref");
          const inputRef = readStringParam(params, "inputRef");
          const element = readStringParam(params, "element");
          const targetId =
            typeof params.targetId === "string"
              ? params.targetId.trim()
              : undefined;
          const timeoutMs =
            typeof params.timeoutMs === "number" &&
            Number.isFinite(params.timeoutMs)
              ? params.timeoutMs
              : undefined;
          return jsonResult(
            await browserArmFileChooser(baseUrl, {
              paths,
              ref,
              inputRef,
              element,
              targetId,
              timeoutMs,
            }),
          );
        }
        case "dialog": {
          const accept = Boolean(params.accept);
          const promptText =
            typeof params.promptText === "string"
              ? params.promptText
              : undefined;
          const targetId =
            typeof params.targetId === "string"
              ? params.targetId.trim()
              : undefined;
          const timeoutMs =
            typeof params.timeoutMs === "number" &&
            Number.isFinite(params.timeoutMs)
              ? params.timeoutMs
              : undefined;
          return jsonResult(
            await browserArmDialog(baseUrl, {
              accept,
              promptText,
              targetId,
              timeoutMs,
            }),
          );
        }
        case "act": {
          const request = params.request as Record<string, unknown> | undefined;
          if (!request || typeof request !== "object") {
            throw new Error("request required");
          }
          const result = await browserAct(
            baseUrl,
            request as Parameters<typeof browserAct>[1],
          );
          return jsonResult(result);
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}

const CanvasToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("present"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.Optional(Type.String()),
    target: Type.Optional(Type.String()),
    x: Type.Optional(Type.Number()),
    y: Type.Optional(Type.Number()),
    width: Type.Optional(Type.Number()),
    height: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("hide"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("navigate"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.Optional(Type.String()),
    url: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("eval"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.Optional(Type.String()),
    javaScript: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("snapshot"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.Optional(Type.String()),
    format: Type.Optional(
      Type.Union([
        Type.Literal("png"),
        Type.Literal("jpg"),
        Type.Literal("jpeg"),
      ]),
    ),
    maxWidth: Type.Optional(Type.Number()),
    quality: Type.Optional(Type.Number()),
    delayMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("a2ui_push"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.Optional(Type.String()),
    jsonl: Type.Optional(Type.String()),
    jsonlPath: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("a2ui_reset"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.Optional(Type.String()),
  }),
]);

function createCanvasTool(): AnyAgentTool {
  return {
    label: "Canvas",
    name: "canvas",
    description:
      "Control node canvases (present/hide/navigate/eval/snapshot/A2UI). Use snapshot to capture the rendered UI.",
    parameters: CanvasToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
        gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs:
          typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      };

      const nodeId = await resolveNodeId(
        gatewayOpts,
        readStringParam(params, "node", { trim: true }),
        true,
      );

      const invoke = async (
        command: string,
        invokeParams?: Record<string, unknown>,
      ) =>
        await callGatewayTool("node.invoke", gatewayOpts, {
          nodeId,
          command,
          params: invokeParams,
          idempotencyKey: crypto.randomUUID(),
        });

      switch (action) {
        case "present": {
          const placement = {
            x: typeof params.x === "number" ? params.x : undefined,
            y: typeof params.y === "number" ? params.y : undefined,
            width: typeof params.width === "number" ? params.width : undefined,
            height:
              typeof params.height === "number" ? params.height : undefined,
          };
          const invokeParams: Record<string, unknown> = {};
          if (typeof params.target === "string" && params.target.trim()) {
            invokeParams.url = params.target.trim();
          }
          if (
            Number.isFinite(placement.x) ||
            Number.isFinite(placement.y) ||
            Number.isFinite(placement.width) ||
            Number.isFinite(placement.height)
          ) {
            invokeParams.placement = placement;
          }
          await invoke("canvas.present", invokeParams);
          return jsonResult({ ok: true });
        }
        case "hide":
          await invoke("canvas.hide", undefined);
          return jsonResult({ ok: true });
        case "navigate": {
          const url = readStringParam(params, "url", { required: true });
          await invoke("canvas.navigate", { url });
          return jsonResult({ ok: true });
        }
        case "eval": {
          const javaScript = readStringParam(params, "javaScript", {
            required: true,
          });
          const raw = (await invoke("canvas.eval", { javaScript })) as {
            payload?: { result?: string };
          };
          const result = raw?.payload?.result;
          if (result) {
            return {
              content: [{ type: "text", text: result }],
              details: { result },
            };
          }
          return jsonResult({ ok: true });
        }
        case "snapshot": {
          const formatRaw =
            typeof params.format === "string"
              ? params.format.toLowerCase()
              : "png";
          const format =
            formatRaw === "jpg" || formatRaw === "jpeg" ? "jpeg" : "png";
          const maxWidth =
            typeof params.maxWidth === "number" &&
            Number.isFinite(params.maxWidth)
              ? params.maxWidth
              : undefined;
          const quality =
            typeof params.quality === "number" &&
            Number.isFinite(params.quality)
              ? params.quality
              : undefined;
          const raw = (await invoke("canvas.snapshot", {
            format,
            maxWidth,
            quality,
          })) as { payload?: unknown };
          const payload = parseCanvasSnapshotPayload(raw?.payload);
          const filePath = canvasSnapshotTempPath({
            ext: payload.format === "jpeg" ? "jpg" : payload.format,
          });
          await writeBase64ToFile(filePath, payload.base64);
          const mimeType = imageMimeFromFormat(payload.format) ?? "image/png";
          return await imageResult({
            label: "canvas:snapshot",
            path: filePath,
            base64: payload.base64,
            mimeType,
            details: { format: payload.format },
          });
        }
        case "a2ui_push": {
          const jsonl =
            typeof params.jsonl === "string" && params.jsonl.trim()
              ? params.jsonl
              : typeof params.jsonlPath === "string" && params.jsonlPath.trim()
                ? await fs.readFile(params.jsonlPath.trim(), "utf8")
                : "";
          if (!jsonl.trim()) throw new Error("jsonl or jsonlPath required");
          await invoke("canvas.a2ui.pushJSONL", { jsonl });
          return jsonResult({ ok: true });
        }
        case "a2ui_reset":
          await invoke("canvas.a2ui.reset", undefined);
          return jsonResult({ ok: true });
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}

const NodesToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("status"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("describe"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("pending"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("approve"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    requestId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("reject"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    requestId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("notify"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.String(),
    title: Type.Optional(Type.String()),
    body: Type.Optional(Type.String()),
    sound: Type.Optional(Type.String()),
    priority: Type.Optional(
      Type.Union([
        Type.Literal("passive"),
        Type.Literal("active"),
        Type.Literal("timeSensitive"),
      ]),
    ),
    delivery: Type.Optional(
      Type.Union([
        Type.Literal("system"),
        Type.Literal("overlay"),
        Type.Literal("auto"),
      ]),
    ),
  }),
  Type.Object({
    action: Type.Literal("camera_snap"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.String(),
    facing: Type.Optional(
      Type.Union([
        Type.Literal("front"),
        Type.Literal("back"),
        Type.Literal("both"),
      ]),
    ),
    maxWidth: Type.Optional(Type.Number()),
    quality: Type.Optional(Type.Number()),
    delayMs: Type.Optional(Type.Number()),
    deviceId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("camera_list"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("camera_clip"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.String(),
    facing: Type.Optional(
      Type.Union([Type.Literal("front"), Type.Literal("back")]),
    ),
    duration: Type.Optional(Type.String()),
    durationMs: Type.Optional(Type.Number()),
    includeAudio: Type.Optional(Type.Boolean()),
    deviceId: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("screen_record"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.String(),
    duration: Type.Optional(Type.String()),
    durationMs: Type.Optional(Type.Number()),
    fps: Type.Optional(Type.Number()),
    screenIndex: Type.Optional(Type.Number()),
    includeAudio: Type.Optional(Type.Boolean()),
    outPath: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("location_get"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    node: Type.String(),
    maxAgeMs: Type.Optional(Type.Number()),
    locationTimeoutMs: Type.Optional(Type.Number()),
    desiredAccuracy: Type.Optional(
      Type.Union([
        Type.Literal("coarse"),
        Type.Literal("balanced"),
        Type.Literal("precise"),
      ]),
    ),
  }),
]);

function createNodesTool(): AnyAgentTool {
  return {
    label: "Nodes",
    name: "nodes",
    description:
      "Discover and control paired nodes (status/describe/pairing/notify/camera/screen/location).",
    parameters: NodesToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
        gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs:
          typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      };

      switch (action) {
        case "status":
          return jsonResult(
            await callGatewayTool("node.list", gatewayOpts, {}),
          );
        case "describe": {
          const node = readStringParam(params, "node", { required: true });
          const nodeId = await resolveNodeId(gatewayOpts, node);
          return jsonResult(
            await callGatewayTool("node.describe", gatewayOpts, { nodeId }),
          );
        }
        case "pending":
          return jsonResult(
            await callGatewayTool("node.pair.list", gatewayOpts, {}),
          );
        case "approve": {
          const requestId = readStringParam(params, "requestId", {
            required: true,
          });
          return jsonResult(
            await callGatewayTool("node.pair.approve", gatewayOpts, {
              requestId,
            }),
          );
        }
        case "reject": {
          const requestId = readStringParam(params, "requestId", {
            required: true,
          });
          return jsonResult(
            await callGatewayTool("node.pair.reject", gatewayOpts, {
              requestId,
            }),
          );
        }
        case "notify": {
          const node = readStringParam(params, "node", { required: true });
          const title = typeof params.title === "string" ? params.title : "";
          const body = typeof params.body === "string" ? params.body : "";
          if (!title.trim() && !body.trim()) {
            throw new Error("title or body required");
          }
          const nodeId = await resolveNodeId(gatewayOpts, node);
          await callGatewayTool("node.invoke", gatewayOpts, {
            nodeId,
            command: "system.notify",
            params: {
              title: title.trim() || undefined,
              body: body.trim() || undefined,
              sound:
                typeof params.sound === "string" ? params.sound : undefined,
              priority:
                typeof params.priority === "string"
                  ? params.priority
                  : undefined,
              delivery:
                typeof params.delivery === "string"
                  ? params.delivery
                  : undefined,
            },
            idempotencyKey: crypto.randomUUID(),
          });
          return jsonResult({ ok: true });
        }
        case "camera_snap": {
          const node = readStringParam(params, "node", { required: true });
          const nodeId = await resolveNodeId(gatewayOpts, node);
          const facingRaw =
            typeof params.facing === "string"
              ? params.facing.toLowerCase()
              : "both";
          const facings: CameraFacing[] =
            facingRaw === "both"
              ? ["front", "back"]
              : facingRaw === "front" || facingRaw === "back"
                ? [facingRaw]
                : (() => {
                    throw new Error("invalid facing (front|back|both)");
                  })();
          const maxWidth =
            typeof params.maxWidth === "number" &&
            Number.isFinite(params.maxWidth)
              ? params.maxWidth
              : undefined;
          const quality =
            typeof params.quality === "number" &&
            Number.isFinite(params.quality)
              ? params.quality
              : undefined;
          const delayMs =
            typeof params.delayMs === "number" &&
            Number.isFinite(params.delayMs)
              ? params.delayMs
              : undefined;
          const deviceId =
            typeof params.deviceId === "string" && params.deviceId.trim()
              ? params.deviceId.trim()
              : undefined;

          const content: AgentToolResult<unknown>["content"] = [];
          const details: Array<Record<string, unknown>> = [];

          for (const facing of facings) {
            const raw = (await callGatewayTool("node.invoke", gatewayOpts, {
              nodeId,
              command: "camera.snap",
              params: {
                facing,
                maxWidth,
                quality,
                format: "jpg",
                delayMs,
                deviceId,
              },
              idempotencyKey: crypto.randomUUID(),
            })) as { payload?: unknown };
            const payload = parseCameraSnapPayload(raw?.payload);
            const normalizedFormat = payload.format.toLowerCase();
            if (
              normalizedFormat !== "jpg" &&
              normalizedFormat !== "jpeg" &&
              normalizedFormat !== "png"
            ) {
              throw new Error(
                `unsupported camera.snap format: ${payload.format}`,
              );
            }

            const isJpeg =
              normalizedFormat === "jpg" || normalizedFormat === "jpeg";
            const filePath = cameraTempPath({
              kind: "snap",
              facing,
              ext: isJpeg ? "jpg" : "png",
            });
            await writeBase64ToFile(filePath, payload.base64);
            content.push({ type: "text", text: `MEDIA:${filePath}` });
            content.push({
              type: "image",
              data: payload.base64,
              mimeType:
                imageMimeFromFormat(payload.format) ??
                (isJpeg ? "image/jpeg" : "image/png"),
            });
            details.push({
              facing,
              path: filePath,
              width: payload.width,
              height: payload.height,
            });
          }

          const result: AgentToolResult<unknown> = { content, details };
          return await sanitizeToolResultImages(result, "nodes:camera_snap");
        }
        case "camera_list": {
          const node = readStringParam(params, "node", { required: true });
          const nodeId = await resolveNodeId(gatewayOpts, node);
          const raw = (await callGatewayTool("node.invoke", gatewayOpts, {
            nodeId,
            command: "camera.list",
            params: {},
            idempotencyKey: crypto.randomUUID(),
          })) as { payload?: unknown };
          const payload =
            raw && typeof raw.payload === "object" && raw.payload !== null
              ? raw.payload
              : {};
          return jsonResult(payload);
        }
        case "camera_clip": {
          const node = readStringParam(params, "node", { required: true });
          const nodeId = await resolveNodeId(gatewayOpts, node);
          const facing =
            typeof params.facing === "string"
              ? params.facing.toLowerCase()
              : "front";
          if (facing !== "front" && facing !== "back") {
            throw new Error("invalid facing (front|back)");
          }
          const durationMs =
            typeof params.durationMs === "number" &&
            Number.isFinite(params.durationMs)
              ? params.durationMs
              : typeof params.duration === "string"
                ? parseDurationMs(params.duration)
                : 3000;
          const includeAudio =
            typeof params.includeAudio === "boolean"
              ? params.includeAudio
              : true;
          const deviceId =
            typeof params.deviceId === "string" && params.deviceId.trim()
              ? params.deviceId.trim()
              : undefined;
          const raw = (await callGatewayTool("node.invoke", gatewayOpts, {
            nodeId,
            command: "camera.clip",
            params: {
              facing,
              durationMs,
              includeAudio,
              format: "mp4",
              deviceId,
            },
            idempotencyKey: crypto.randomUUID(),
          })) as { payload?: unknown };
          const payload = parseCameraClipPayload(raw?.payload);
          const filePath = cameraTempPath({
            kind: "clip",
            facing,
            ext: payload.format,
          });
          await writeBase64ToFile(filePath, payload.base64);
          return {
            content: [{ type: "text", text: `FILE:${filePath}` }],
            details: {
              facing,
              path: filePath,
              durationMs: payload.durationMs,
              hasAudio: payload.hasAudio,
            },
          };
        }
        case "screen_record": {
          const node = readStringParam(params, "node", { required: true });
          const nodeId = await resolveNodeId(gatewayOpts, node);
          const durationMs =
            typeof params.durationMs === "number" &&
            Number.isFinite(params.durationMs)
              ? params.durationMs
              : typeof params.duration === "string"
                ? parseDurationMs(params.duration)
                : 10_000;
          const fps =
            typeof params.fps === "number" && Number.isFinite(params.fps)
              ? params.fps
              : 10;
          const screenIndex =
            typeof params.screenIndex === "number" &&
            Number.isFinite(params.screenIndex)
              ? params.screenIndex
              : 0;
          const includeAudio =
            typeof params.includeAudio === "boolean"
              ? params.includeAudio
              : true;
          const raw = (await callGatewayTool("node.invoke", gatewayOpts, {
            nodeId,
            command: "screen.record",
            params: {
              durationMs,
              screenIndex,
              fps,
              format: "mp4",
              includeAudio,
            },
            idempotencyKey: crypto.randomUUID(),
          })) as { payload?: unknown };
          const payload = parseScreenRecordPayload(raw?.payload);
          const filePath =
            typeof params.outPath === "string" && params.outPath.trim()
              ? params.outPath.trim()
              : screenRecordTempPath({ ext: payload.format || "mp4" });
          const written = await writeScreenRecordToFile(
            filePath,
            payload.base64,
          );
          return {
            content: [{ type: "text", text: `FILE:${written.path}` }],
            details: {
              path: written.path,
              durationMs: payload.durationMs,
              fps: payload.fps,
              screenIndex: payload.screenIndex,
              hasAudio: payload.hasAudio,
            },
          };
        }
        case "location_get": {
          const node = readStringParam(params, "node", { required: true });
          const nodeId = await resolveNodeId(gatewayOpts, node);
          const maxAgeMs =
            typeof params.maxAgeMs === "number" &&
            Number.isFinite(params.maxAgeMs)
              ? params.maxAgeMs
              : undefined;
          const desiredAccuracy =
            params.desiredAccuracy === "coarse" ||
            params.desiredAccuracy === "balanced" ||
            params.desiredAccuracy === "precise"
              ? params.desiredAccuracy
              : undefined;
          const locationTimeoutMs =
            typeof params.locationTimeoutMs === "number" &&
            Number.isFinite(params.locationTimeoutMs)
              ? params.locationTimeoutMs
              : undefined;
          const raw = (await callGatewayTool("node.invoke", gatewayOpts, {
            nodeId,
            command: "location.get",
            params: {
              maxAgeMs,
              desiredAccuracy,
              timeoutMs: locationTimeoutMs,
            },
            idempotencyKey: crypto.randomUUID(),
          })) as { payload?: unknown };
          return jsonResult(raw?.payload ?? {});
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}

const CronToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("status"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("list"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    includeDisabled: Type.Optional(Type.Boolean()),
  }),
  Type.Object({
    action: Type.Literal("add"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    job: Type.Object({}, { additionalProperties: true }),
  }),
  Type.Object({
    action: Type.Literal("update"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    jobId: Type.String(),
    patch: Type.Object({}, { additionalProperties: true }),
  }),
  Type.Object({
    action: Type.Literal("remove"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    jobId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("run"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    jobId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("runs"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    jobId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("wake"),
    gatewayUrl: Type.Optional(Type.String()),
    gatewayToken: Type.Optional(Type.String()),
    timeoutMs: Type.Optional(Type.Number()),
    text: Type.String(),
    mode: Type.Optional(
      Type.Union([Type.Literal("now"), Type.Literal("next-heartbeat")]),
    ),
  }),
]);

function createCronTool(): AnyAgentTool {
  return {
    label: "Cron",
    name: "cron",
    description:
      "Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events.",
    parameters: CronToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts: GatewayCallOptions = {
        gatewayUrl: readStringParam(params, "gatewayUrl", { trim: false }),
        gatewayToken: readStringParam(params, "gatewayToken", { trim: false }),
        timeoutMs:
          typeof params.timeoutMs === "number" ? params.timeoutMs : undefined,
      };

      switch (action) {
        case "status":
          return jsonResult(
            await callGatewayTool("cron.status", gatewayOpts, {}),
          );
        case "list":
          return jsonResult(
            await callGatewayTool("cron.list", gatewayOpts, {
              includeDisabled: Boolean(params.includeDisabled),
            }),
          );
        case "add": {
          if (!params.job || typeof params.job !== "object") {
            throw new Error("job required");
          }
          return jsonResult(
            await callGatewayTool("cron.add", gatewayOpts, params.job),
          );
        }
        case "update": {
          const jobId = readStringParam(params, "jobId", { required: true });
          if (!params.patch || typeof params.patch !== "object") {
            throw new Error("patch required");
          }
          return jsonResult(
            await callGatewayTool("cron.update", gatewayOpts, {
              jobId,
              patch: params.patch,
            }),
          );
        }
        case "remove": {
          const jobId = readStringParam(params, "jobId", { required: true });
          return jsonResult(
            await callGatewayTool("cron.remove", gatewayOpts, { jobId }),
          );
        }
        case "run": {
          const jobId = readStringParam(params, "jobId", { required: true });
          return jsonResult(
            await callGatewayTool("cron.run", gatewayOpts, { jobId }),
          );
        }
        case "runs": {
          const jobId = readStringParam(params, "jobId", { required: true });
          return jsonResult(
            await callGatewayTool("cron.runs", gatewayOpts, { jobId }),
          );
        }
        case "wake": {
          const text = readStringParam(params, "text", { required: true });
          const mode =
            params.mode === "now" || params.mode === "next-heartbeat"
              ? params.mode
              : "next-heartbeat";
          return jsonResult(
            await callGatewayTool(
              "wake",
              gatewayOpts,
              { mode, text },
              { expectFinal: false },
            ),
          );
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}

const GatewayToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("restart"),
    delayMs: Type.Optional(Type.Number()),
    reason: Type.Optional(Type.String()),
  }),
]);

const DiscordToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("react"),
    channelId: Type.String(),
    messageId: Type.String(),
    emoji: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("reactions"),
    channelId: Type.String(),
    messageId: Type.String(),
    limit: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("sticker"),
    to: Type.String(),
    stickerIds: Type.Array(Type.String()),
    content: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("poll"),
    to: Type.String(),
    question: Type.String(),
    answers: Type.Array(Type.String()),
    allowMultiselect: Type.Optional(Type.Boolean()),
    durationHours: Type.Optional(Type.Number()),
    content: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("permissions"),
    channelId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("readMessages"),
    channelId: Type.String(),
    limit: Type.Optional(Type.Number()),
    before: Type.Optional(Type.String()),
    after: Type.Optional(Type.String()),
    around: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("sendMessage"),
    to: Type.String(),
    content: Type.String(),
    mediaUrl: Type.Optional(Type.String()),
    replyTo: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("editMessage"),
    channelId: Type.String(),
    messageId: Type.String(),
    content: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("deleteMessage"),
    channelId: Type.String(),
    messageId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("threadCreate"),
    channelId: Type.String(),
    name: Type.String(),
    messageId: Type.Optional(Type.String()),
    autoArchiveMinutes: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("threadList"),
    guildId: Type.String(),
    channelId: Type.Optional(Type.String()),
    includeArchived: Type.Optional(Type.Boolean()),
    before: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("threadReply"),
    channelId: Type.String(),
    content: Type.String(),
    mediaUrl: Type.Optional(Type.String()),
    replyTo: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("pinMessage"),
    channelId: Type.String(),
    messageId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("unpinMessage"),
    channelId: Type.String(),
    messageId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("listPins"),
    channelId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("searchMessages"),
    guildId: Type.String(),
    content: Type.String(),
    channelId: Type.Optional(Type.String()),
    channelIds: Type.Optional(Type.Array(Type.String())),
    authorId: Type.Optional(Type.String()),
    authorIds: Type.Optional(Type.Array(Type.String())),
    limit: Type.Optional(Type.Number()),
  }),
  Type.Object({
    action: Type.Literal("memberInfo"),
    guildId: Type.String(),
    userId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("roleInfo"),
    guildId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("emojiList"),
    guildId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("emojiUpload"),
    guildId: Type.String(),
    name: Type.String(),
    mediaUrl: Type.String(),
    roleIds: Type.Optional(Type.Array(Type.String())),
  }),
  Type.Object({
    action: Type.Literal("stickerUpload"),
    guildId: Type.String(),
    name: Type.String(),
    description: Type.String(),
    tags: Type.String(),
    mediaUrl: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("roleAdd"),
    guildId: Type.String(),
    userId: Type.String(),
    roleId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("roleRemove"),
    guildId: Type.String(),
    userId: Type.String(),
    roleId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("channelInfo"),
    channelId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("channelList"),
    guildId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("voiceStatus"),
    guildId: Type.String(),
    userId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("eventList"),
    guildId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("eventCreate"),
    guildId: Type.String(),
    name: Type.String(),
    startTime: Type.String(),
    endTime: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    channelId: Type.Optional(Type.String()),
    entityType: Type.Optional(
      Type.Union([
        Type.Literal("voice"),
        Type.Literal("stage"),
        Type.Literal("external"),
      ]),
    ),
    location: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("timeout"),
    guildId: Type.String(),
    userId: Type.String(),
    durationMinutes: Type.Optional(Type.Number()),
    until: Type.Optional(Type.String()),
    reason: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("kick"),
    guildId: Type.String(),
    userId: Type.String(),
    reason: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("ban"),
    guildId: Type.String(),
    userId: Type.String(),
    reason: Type.Optional(Type.String()),
    deleteMessageDays: Type.Optional(Type.Number()),
  }),
]);

const SlackToolSchema = Type.Union([
  Type.Object({
    action: Type.Literal("react"),
    channelId: Type.String(),
    messageId: Type.String(),
    emoji: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("reactions"),
    channelId: Type.String(),
    messageId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("sendMessage"),
    to: Type.String(),
    content: Type.String(),
    mediaUrl: Type.Optional(Type.String()),
    replyTo: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("editMessage"),
    channelId: Type.String(),
    messageId: Type.String(),
    content: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("deleteMessage"),
    channelId: Type.String(),
    messageId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("readMessages"),
    channelId: Type.String(),
    limit: Type.Optional(Type.Number()),
    before: Type.Optional(Type.String()),
    after: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("searchMessages"),
    query: Type.String(),
    limit: Type.Optional(Type.Number()),
    channelIds: Type.Optional(Type.Array(Type.String())),
    channelNames: Type.Optional(Type.Array(Type.String())),
  }),
  Type.Object({
    action: Type.Literal("pinMessage"),
    channelId: Type.String(),
    messageId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("unpinMessage"),
    channelId: Type.String(),
    messageId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("listPins"),
    channelId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("permissions"),
    channelId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("memberInfo"),
    userId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("channelInfo"),
    channelId: Type.String(),
  }),
  Type.Object({
    action: Type.Literal("channelList"),
    limit: Type.Optional(Type.Number()),
    cursor: Type.Optional(Type.String()),
  }),
  Type.Object({
    action: Type.Literal("emojiList"),
  }),
]);

function createDiscordTool(): AnyAgentTool {
  return {
    label: "Discord",
    name: "discord",
    description: "Manage Discord messages, reactions, and moderation.",
    parameters: DiscordToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const cfg = loadConfig();
      const isActionEnabled = (
        key: keyof DiscordActionConfig,
        defaultValue = true,
      ) => {
        const value = cfg.discord?.actions?.[key];
        if (value === undefined) return defaultValue;
        return value !== false;
      };

      switch (action) {
        case "react": {
          if (!isActionEnabled("reactions")) {
            throw new Error("Discord reactions are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          const emoji = readStringParam(params, "emoji", { required: true });
          await reactMessageDiscord(channelId, messageId, emoji);
          return jsonResult({ ok: true });
        }
        case "reactions": {
          if (!isActionEnabled("reactions")) {
            throw new Error("Discord reactions are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          const limitRaw = params.limit;
          const limit =
            typeof limitRaw === "number" && Number.isFinite(limitRaw)
              ? limitRaw
              : undefined;
          const reactions = await fetchReactionsDiscord(channelId, messageId, {
            limit,
          });
          return jsonResult({ ok: true, reactions });
        }
        case "sticker": {
          if (!isActionEnabled("stickers")) {
            throw new Error("Discord stickers are disabled.");
          }
          const to = readStringParam(params, "to", { required: true });
          const content = readStringParam(params, "content");
          const stickerIds = readStringArrayParam(params, "stickerIds", {
            required: true,
            label: "stickerIds",
          });
          await sendStickerDiscord(to, stickerIds, { content });
          return jsonResult({ ok: true });
        }
        case "poll": {
          if (!isActionEnabled("polls")) {
            throw new Error("Discord polls are disabled.");
          }
          const to = readStringParam(params, "to", { required: true });
          const content = readStringParam(params, "content");
          const question = readStringParam(params, "question", {
            required: true,
          });
          const answers = readStringArrayParam(params, "answers", {
            required: true,
            label: "answers",
          });
          const allowMultiselectRaw = params.allowMultiselect;
          const allowMultiselect =
            typeof allowMultiselectRaw === "boolean"
              ? allowMultiselectRaw
              : undefined;
          const durationRaw = params.durationHours;
          const durationHours =
            typeof durationRaw === "number" && Number.isFinite(durationRaw)
              ? durationRaw
              : undefined;
          await sendPollDiscord(
            to,
            { question, answers, allowMultiselect, durationHours },
            { content },
          );
          return jsonResult({ ok: true });
        }
        case "permissions": {
          if (!isActionEnabled("permissions")) {
            throw new Error("Discord permissions are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const permissions = await fetchChannelPermissionsDiscord(channelId);
          return jsonResult({ ok: true, permissions });
        }
        case "readMessages": {
          if (!isActionEnabled("messages")) {
            throw new Error("Discord message reads are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messages = await readMessagesDiscord(channelId, {
            limit:
              typeof params.limit === "number" && Number.isFinite(params.limit)
                ? params.limit
                : undefined,
            before: readStringParam(params, "before"),
            after: readStringParam(params, "after"),
            around: readStringParam(params, "around"),
          });
          return jsonResult({ ok: true, messages });
        }
        case "sendMessage": {
          if (!isActionEnabled("messages")) {
            throw new Error("Discord message sends are disabled.");
          }
          const to = readStringParam(params, "to", { required: true });
          const content = readStringParam(params, "content", {
            required: true,
          });
          const mediaUrl = readStringParam(params, "mediaUrl");
          const replyTo = readStringParam(params, "replyTo");
          const result = await sendMessageDiscord(to, content, {
            mediaUrl,
            replyTo,
          });
          return jsonResult({ ok: true, result });
        }
        case "editMessage": {
          if (!isActionEnabled("messages")) {
            throw new Error("Discord message edits are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          const content = readStringParam(params, "content", {
            required: true,
          });
          const message = await editMessageDiscord(channelId, messageId, {
            content,
          });
          return jsonResult({ ok: true, message });
        }
        case "deleteMessage": {
          if (!isActionEnabled("messages")) {
            throw new Error("Discord message deletes are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          await deleteMessageDiscord(channelId, messageId);
          return jsonResult({ ok: true });
        }
        case "threadCreate": {
          if (!isActionEnabled("threads")) {
            throw new Error("Discord threads are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const name = readStringParam(params, "name", { required: true });
          const messageId = readStringParam(params, "messageId");
          const autoArchiveMinutesRaw = params.autoArchiveMinutes;
          const autoArchiveMinutes =
            typeof autoArchiveMinutesRaw === "number" &&
            Number.isFinite(autoArchiveMinutesRaw)
              ? autoArchiveMinutesRaw
              : undefined;
          const thread = await createThreadDiscord(channelId, {
            name,
            messageId,
            autoArchiveMinutes,
          });
          return jsonResult({ ok: true, thread });
        }
        case "threadList": {
          if (!isActionEnabled("threads")) {
            throw new Error("Discord threads are disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const channelId = readStringParam(params, "channelId");
          const includeArchived =
            typeof params.includeArchived === "boolean"
              ? params.includeArchived
              : undefined;
          const before = readStringParam(params, "before");
          const limit =
            typeof params.limit === "number" && Number.isFinite(params.limit)
              ? params.limit
              : undefined;
          const threads = await listThreadsDiscord({
            guildId,
            channelId,
            includeArchived,
            before,
            limit,
          });
          return jsonResult({ ok: true, threads });
        }
        case "threadReply": {
          if (!isActionEnabled("threads")) {
            throw new Error("Discord threads are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const content = readStringParam(params, "content", {
            required: true,
          });
          const mediaUrl = readStringParam(params, "mediaUrl");
          const replyTo = readStringParam(params, "replyTo");
          const result = await sendMessageDiscord(
            `channel:${channelId}`,
            content,
            {
              mediaUrl,
              replyTo,
            },
          );
          return jsonResult({ ok: true, result });
        }
        case "pinMessage": {
          if (!isActionEnabled("pins")) {
            throw new Error("Discord pins are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          await pinMessageDiscord(channelId, messageId);
          return jsonResult({ ok: true });
        }
        case "unpinMessage": {
          if (!isActionEnabled("pins")) {
            throw new Error("Discord pins are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          await unpinMessageDiscord(channelId, messageId);
          return jsonResult({ ok: true });
        }
        case "listPins": {
          if (!isActionEnabled("pins")) {
            throw new Error("Discord pins are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const pins = await listPinsDiscord(channelId);
          return jsonResult({ ok: true, pins });
        }
        case "searchMessages": {
          if (!isActionEnabled("search")) {
            throw new Error("Discord search is disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const content = readStringParam(params, "content", {
            required: true,
          });
          const channelId = readStringParam(params, "channelId");
          const channelIds = readStringArrayParam(params, "channelIds");
          const authorId = readStringParam(params, "authorId");
          const authorIds = readStringArrayParam(params, "authorIds");
          const limit =
            typeof params.limit === "number" && Number.isFinite(params.limit)
              ? params.limit
              : undefined;
          const channelIdList = [
            ...(channelIds ?? []),
            ...(channelId ? [channelId] : []),
          ];
          const authorIdList = [
            ...(authorIds ?? []),
            ...(authorId ? [authorId] : []),
          ];
          const results = await searchMessagesDiscord({
            guildId,
            content,
            channelIds: channelIdList.length ? channelIdList : undefined,
            authorIds: authorIdList.length ? authorIdList : undefined,
            limit,
          });
          return jsonResult({ ok: true, results });
        }
        case "memberInfo": {
          if (!isActionEnabled("memberInfo")) {
            throw new Error("Discord member info is disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const userId = readStringParam(params, "userId", {
            required: true,
          });
          const member = await fetchMemberInfoDiscord(guildId, userId);
          return jsonResult({ ok: true, member });
        }
        case "roleInfo": {
          if (!isActionEnabled("roleInfo")) {
            throw new Error("Discord role info is disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const roles = await fetchRoleInfoDiscord(guildId);
          return jsonResult({ ok: true, roles });
        }
        case "emojiList": {
          if (!isActionEnabled("reactions")) {
            throw new Error("Discord reactions are disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const emojis = await listGuildEmojisDiscord(guildId);
          return jsonResult({ ok: true, emojis });
        }
        case "emojiUpload": {
          if (!isActionEnabled("emojiUploads")) {
            throw new Error("Discord emoji uploads are disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const name = readStringParam(params, "name", { required: true });
          const mediaUrl = readStringParam(params, "mediaUrl", {
            required: true,
          });
          const roleIds = readStringArrayParam(params, "roleIds");
          const emoji = await uploadEmojiDiscord({
            guildId,
            name,
            mediaUrl,
            roleIds: roleIds?.length ? roleIds : undefined,
          });
          return jsonResult({ ok: true, emoji });
        }
        case "stickerUpload": {
          if (!isActionEnabled("stickerUploads")) {
            throw new Error("Discord sticker uploads are disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const name = readStringParam(params, "name", { required: true });
          const description = readStringParam(params, "description", {
            required: true,
          });
          const tags = readStringParam(params, "tags", { required: true });
          const mediaUrl = readStringParam(params, "mediaUrl", {
            required: true,
          });
          const sticker = await uploadStickerDiscord({
            guildId,
            name,
            description,
            tags,
            mediaUrl,
          });
          return jsonResult({ ok: true, sticker });
        }
        case "roleAdd": {
          if (!isActionEnabled("roles", false)) {
            throw new Error("Discord role changes are disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const userId = readStringParam(params, "userId", {
            required: true,
          });
          const roleId = readStringParam(params, "roleId", {
            required: true,
          });
          await addRoleDiscord({ guildId, userId, roleId });
          return jsonResult({ ok: true });
        }
        case "roleRemove": {
          if (!isActionEnabled("roles", false)) {
            throw new Error("Discord role changes are disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const userId = readStringParam(params, "userId", {
            required: true,
          });
          const roleId = readStringParam(params, "roleId", {
            required: true,
          });
          await removeRoleDiscord({ guildId, userId, roleId });
          return jsonResult({ ok: true });
        }
        case "channelInfo": {
          if (!isActionEnabled("channelInfo")) {
            throw new Error("Discord channel info is disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const channel = await fetchChannelInfoDiscord(channelId);
          return jsonResult({ ok: true, channel });
        }
        case "channelList": {
          if (!isActionEnabled("channelInfo")) {
            throw new Error("Discord channel info is disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const channels = await listGuildChannelsDiscord(guildId);
          return jsonResult({ ok: true, channels });
        }
        case "voiceStatus": {
          if (!isActionEnabled("voiceStatus")) {
            throw new Error("Discord voice status is disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const userId = readStringParam(params, "userId", {
            required: true,
          });
          const voice = await fetchVoiceStatusDiscord(guildId, userId);
          return jsonResult({ ok: true, voice });
        }
        case "eventList": {
          if (!isActionEnabled("events")) {
            throw new Error("Discord events are disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const events = await listScheduledEventsDiscord(guildId);
          return jsonResult({ ok: true, events });
        }
        case "eventCreate": {
          if (!isActionEnabled("events")) {
            throw new Error("Discord events are disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const name = readStringParam(params, "name", { required: true });
          const startTime = readStringParam(params, "startTime", {
            required: true,
          });
          const endTime = readStringParam(params, "endTime");
          const description = readStringParam(params, "description");
          const channelId = readStringParam(params, "channelId");
          const location = readStringParam(params, "location");
          const entityTypeRaw = readStringParam(params, "entityType");
          const entityType =
            entityTypeRaw === "stage"
              ? 1
              : entityTypeRaw === "external"
                ? 3
                : 2;
          const payload = {
            name,
            description,
            scheduled_start_time: startTime,
            scheduled_end_time: endTime,
            entity_type: entityType,
            channel_id: channelId,
            entity_metadata:
              entityType === 3 && location ? { location } : undefined,
            privacy_level: 2,
          };
          const event = await createScheduledEventDiscord(guildId, payload);
          return jsonResult({ ok: true, event });
        }
        case "timeout": {
          if (!isActionEnabled("moderation", false)) {
            throw new Error("Discord moderation is disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const userId = readStringParam(params, "userId", {
            required: true,
          });
          const durationMinutes =
            typeof params.durationMinutes === "number" &&
            Number.isFinite(params.durationMinutes)
              ? params.durationMinutes
              : undefined;
          const until = readStringParam(params, "until");
          const reason = readStringParam(params, "reason");
          const member = await timeoutMemberDiscord({
            guildId,
            userId,
            durationMinutes,
            until,
            reason,
          });
          return jsonResult({ ok: true, member });
        }
        case "kick": {
          if (!isActionEnabled("moderation", false)) {
            throw new Error("Discord moderation is disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const userId = readStringParam(params, "userId", {
            required: true,
          });
          const reason = readStringParam(params, "reason");
          await kickMemberDiscord({ guildId, userId, reason });
          return jsonResult({ ok: true });
        }
        case "ban": {
          if (!isActionEnabled("moderation", false)) {
            throw new Error("Discord moderation is disabled.");
          }
          const guildId = readStringParam(params, "guildId", {
            required: true,
          });
          const userId = readStringParam(params, "userId", {
            required: true,
          });
          const reason = readStringParam(params, "reason");
          const deleteMessageDays =
            typeof params.deleteMessageDays === "number" &&
            Number.isFinite(params.deleteMessageDays)
              ? params.deleteMessageDays
              : undefined;
          await banMemberDiscord({
            guildId,
            userId,
            reason,
            deleteMessageDays,
          });
          return jsonResult({ ok: true });
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}

function createGatewayTool(): AnyAgentTool {
  return {
    label: "Gateway",
    name: "gateway",
    description:
      "Restart the running gateway process in-place (SIGUSR1) without needing an external supervisor. Use delayMs to avoid interrupting an in-flight reply.",
    parameters: GatewayToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action !== "restart") throw new Error(`Unknown action: ${action}`);

      const delayMsRaw =
        typeof params.delayMs === "number" && Number.isFinite(params.delayMs)
          ? Math.floor(params.delayMs)
          : 2000;
      const delayMs = Math.min(Math.max(delayMsRaw, 0), 60_000);
      const reason =
        typeof params.reason === "string" && params.reason.trim()
          ? params.reason.trim().slice(0, 200)
          : undefined;

      const pid = process.pid;
      setTimeout(() => {
        try {
          process.kill(pid, "SIGUSR1");
        } catch {
          /* ignore */
        }
      }, delayMs);

      return jsonResult({
        ok: true,
        pid,
        signal: "SIGUSR1",
        delayMs,
        reason: reason ?? null,
      });
    },
  };
}

const SessionsListToolSchema = Type.Object({
  kinds: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  activeMinutes: Type.Optional(Type.Integer({ minimum: 1 })),
  messageLimit: Type.Optional(Type.Integer({ minimum: 0 })),
});

const SessionsHistoryToolSchema = Type.Object({
  sessionKey: Type.String(),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  includeTools: Type.Optional(Type.Boolean()),
});

const SessionsSendToolSchema = Type.Object({
  sessionKey: Type.String(),
  message: Type.String(),
  timeoutSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
});

function createSessionsListTool(): AnyAgentTool {
  return {
    label: "Sessions",
    name: "sessions_list",
    description: "List sessions with optional filters and last messages.",
    parameters: SessionsListToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);

      const kindsRaw = readStringArrayParam(params, "kinds")?.map((value) =>
        value.trim().toLowerCase(),
      );
      const allowedKindsList = (kindsRaw ?? []).filter((value) =>
        ["main", "group", "cron", "hook", "node", "other"].includes(value),
      );
      const allowedKinds = allowedKindsList.length
        ? new Set(allowedKindsList)
        : undefined;

      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.floor(params.limit))
          : undefined;
      const activeMinutes =
        typeof params.activeMinutes === "number" &&
        Number.isFinite(params.activeMinutes)
          ? Math.max(1, Math.floor(params.activeMinutes))
          : undefined;
      const messageLimitRaw =
        typeof params.messageLimit === "number" &&
        Number.isFinite(params.messageLimit)
          ? Math.max(0, Math.floor(params.messageLimit))
          : 0;
      const messageLimit = Math.min(messageLimitRaw, 20);

      const list = (await callGateway({
        method: "sessions.list",
        params: {
          limit,
          activeMinutes,
          includeGlobal: true,
          includeUnknown: true,
        },
      })) as {
        path?: string;
        sessions?: Array<Record<string, unknown>>;
      };

      const sessions = Array.isArray(list?.sessions) ? list.sessions : [];
      const storePath = typeof list?.path === "string" ? list.path : undefined;
      const rows: SessionListRow[] = [];

      for (const entry of sessions) {
        if (!entry || typeof entry !== "object") continue;
        const key = typeof entry.key === "string" ? entry.key : "";
        if (!key) continue;
        if (key === "unknown") continue;
        if (key === "global" && alias !== "global") continue;

        const gatewayKind =
          typeof entry.kind === "string" ? entry.kind : undefined;
        const kind = classifySessionKind({ key, gatewayKind, alias, mainKey });
        if (allowedKinds && !allowedKinds.has(kind)) continue;

        const displayKey = resolveDisplaySessionKey({
          key,
          alias,
          mainKey,
        });

        const surface =
          typeof entry.surface === "string" ? entry.surface : undefined;
        const lastChannel =
          typeof entry.lastChannel === "string" ? entry.lastChannel : undefined;
        const provider = deriveProvider({
          key,
          kind,
          surface,
          lastChannel,
        });

        const sessionId =
          typeof entry.sessionId === "string" ? entry.sessionId : undefined;
        const transcriptPath =
          sessionId && storePath
            ? path.join(path.dirname(storePath), `${sessionId}.jsonl`)
            : undefined;

        const row: SessionListRow = {
          key: displayKey,
          kind,
          provider,
          displayName:
            typeof entry.displayName === "string"
              ? entry.displayName
              : undefined,
          updatedAt:
            typeof entry.updatedAt === "number" ? entry.updatedAt : undefined,
          sessionId,
          model: typeof entry.model === "string" ? entry.model : undefined,
          contextTokens:
            typeof entry.contextTokens === "number"
              ? entry.contextTokens
              : undefined,
          totalTokens:
            typeof entry.totalTokens === "number"
              ? entry.totalTokens
              : undefined,
          thinkingLevel:
            typeof entry.thinkingLevel === "string"
              ? entry.thinkingLevel
              : undefined,
          verboseLevel:
            typeof entry.verboseLevel === "string"
              ? entry.verboseLevel
              : undefined,
          systemSent:
            typeof entry.systemSent === "boolean"
              ? entry.systemSent
              : undefined,
          abortedLastRun:
            typeof entry.abortedLastRun === "boolean"
              ? entry.abortedLastRun
              : undefined,
          sendPolicy:
            typeof entry.sendPolicy === "string" ? entry.sendPolicy : undefined,
          lastChannel,
          lastTo: typeof entry.lastTo === "string" ? entry.lastTo : undefined,
          transcriptPath,
        };

        if (messageLimit > 0) {
          const resolvedKey = resolveInternalSessionKey({
            key: displayKey,
            alias,
            mainKey,
          });
          const history = (await callGateway({
            method: "chat.history",
            params: { sessionKey: resolvedKey, limit: messageLimit },
          })) as { messages?: unknown[] };
          const rawMessages = Array.isArray(history?.messages)
            ? history.messages
            : [];
          const filtered = stripToolMessages(rawMessages);
          row.messages =
            filtered.length > messageLimit
              ? filtered.slice(-messageLimit)
              : filtered;
        }

        rows.push(row);
      }

      return jsonResult({
        count: rows.length,
        sessions: rows,
      });
    },
  };
}

function createSessionsHistoryTool(): AnyAgentTool {
  return {
    label: "Session History",
    name: "sessions_history",
    description: "Fetch message history for a session.",
    parameters: SessionsHistoryToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sessionKey = readStringParam(params, "sessionKey", {
        required: true,
      });
      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const resolvedKey = resolveInternalSessionKey({
        key: sessionKey,
        alias,
        mainKey,
      });
      const limit =
        typeof params.limit === "number" && Number.isFinite(params.limit)
          ? Math.max(1, Math.floor(params.limit))
          : undefined;
      const includeTools = Boolean(params.includeTools);
      const result = (await callGateway({
        method: "chat.history",
        params: { sessionKey: resolvedKey, limit },
      })) as { messages?: unknown[] };
      const rawMessages = Array.isArray(result?.messages)
        ? result.messages
        : [];
      const messages = includeTools
        ? rawMessages
        : stripToolMessages(rawMessages);
      return jsonResult({
        sessionKey: resolveDisplaySessionKey({
          key: sessionKey,
          alias,
          mainKey,
        }),
        messages,
      });
    },
  };
}

const ANNOUNCE_SKIP_TOKEN = "ANNOUNCE_SKIP";
const REPLY_SKIP_TOKEN = "REPLY_SKIP";
const DEFAULT_PING_PONG_TURNS = 5;
const MAX_PING_PONG_TURNS = 5;

type AnnounceTarget = {
  channel: string;
  to: string;
};

function resolveAnnounceTargetFromKey(
  sessionKey: string,
): AnnounceTarget | null {
  const parts = sessionKey.split(":").filter(Boolean);
  if (parts.length < 3) return null;
  const [surface, kind, ...rest] = parts;
  if (kind !== "group" && kind !== "channel") return null;
  const id = rest.join(":").trim();
  if (!id) return null;
  if (!surface) return null;
  const channel = surface.toLowerCase();
  if (channel === "discord") {
    return { channel, to: `channel:${id}` };
  }
  if (channel === "signal") {
    return { channel, to: `group:${id}` };
  }
  return { channel, to: id };
}

function buildAgentToAgentMessageContext(params: {
  requesterSessionKey?: string;
  requesterSurface?: string;
  targetSessionKey: string;
}) {
  const lines = [
    "Agent-to-agent message context:",
    params.requesterSessionKey
      ? `Agent 1 (requester) session: ${params.requesterSessionKey}.`
      : undefined,
    params.requesterSurface
      ? `Agent 1 (requester) surface: ${params.requesterSurface}.`
      : undefined,
    `Agent 2 (target) session: ${params.targetSessionKey}.`,
  ].filter(Boolean);
  return lines.join("\n");
}

function buildAgentToAgentReplyContext(params: {
  requesterSessionKey?: string;
  requesterSurface?: string;
  targetSessionKey: string;
  targetChannel?: string;
  currentRole: "requester" | "target";
  turn: number;
  maxTurns: number;
}) {
  const currentLabel =
    params.currentRole === "requester"
      ? "Agent 1 (requester)"
      : "Agent 2 (target)";
  const lines = [
    "Agent-to-agent reply step:",
    `Current agent: ${currentLabel}.`,
    `Turn ${params.turn} of ${params.maxTurns}.`,
    params.requesterSessionKey
      ? `Agent 1 (requester) session: ${params.requesterSessionKey}.`
      : undefined,
    params.requesterSurface
      ? `Agent 1 (requester) surface: ${params.requesterSurface}.`
      : undefined,
    `Agent 2 (target) session: ${params.targetSessionKey}.`,
    params.targetChannel
      ? `Agent 2 (target) surface: ${params.targetChannel}.`
      : undefined,
    `If you want to stop the ping-pong, reply exactly "${REPLY_SKIP_TOKEN}".`,
  ].filter(Boolean);
  return lines.join("\n");
}

function buildAgentToAgentAnnounceContext(params: {
  requesterSessionKey?: string;
  requesterSurface?: string;
  targetSessionKey: string;
  targetChannel?: string;
  originalMessage: string;
  roundOneReply?: string;
  latestReply?: string;
}) {
  const lines = [
    "Agent-to-agent announce step:",
    params.requesterSessionKey
      ? `Agent 1 (requester) session: ${params.requesterSessionKey}.`
      : undefined,
    params.requesterSurface
      ? `Agent 1 (requester) surface: ${params.requesterSurface}.`
      : undefined,
    `Agent 2 (target) session: ${params.targetSessionKey}.`,
    params.targetChannel
      ? `Agent 2 (target) surface: ${params.targetChannel}.`
      : undefined,
    `Original request: ${params.originalMessage}`,
    params.roundOneReply
      ? `Round 1 reply: ${params.roundOneReply}`
      : "Round 1 reply: (not available).",
    params.latestReply
      ? `Latest reply: ${params.latestReply}`
      : "Latest reply: (not available).",
    `If you want to remain silent, reply exactly "${ANNOUNCE_SKIP_TOKEN}".`,
    "Any other reply will be posted to the target channel.",
    "After this reply, the agent-to-agent conversation is over.",
  ].filter(Boolean);
  return lines.join("\n");
}

function isAnnounceSkip(text?: string) {
  return (text ?? "").trim() === ANNOUNCE_SKIP_TOKEN;
}

function isReplySkip(text?: string) {
  return (text ?? "").trim() === REPLY_SKIP_TOKEN;
}

function resolvePingPongTurns(cfg?: ClawdisConfig) {
  const raw = cfg?.session?.agentToAgent?.maxPingPongTurns;
  const fallback = DEFAULT_PING_PONG_TURNS;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const rounded = Math.floor(raw);
  return Math.max(0, Math.min(MAX_PING_PONG_TURNS, rounded));
}

function createSessionsSendTool(opts?: {
  agentSessionKey?: string;
  agentSurface?: string;
}): AnyAgentTool {
  return {
    label: "Session Send",
    name: "sessions_send",
    description: "Send a message into another session.",
    parameters: SessionsSendToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sessionKey = readStringParam(params, "sessionKey", {
        required: true,
      });
      const message = readStringParam(params, "message", { required: true });
      const cfg = loadConfig();
      const { mainKey, alias } = resolveMainSessionAlias(cfg);
      const resolvedKey = resolveInternalSessionKey({
        key: sessionKey,
        alias,
        mainKey,
      });
      const timeoutSeconds =
        typeof params.timeoutSeconds === "number" &&
        Number.isFinite(params.timeoutSeconds)
          ? Math.max(0, Math.floor(params.timeoutSeconds))
          : 30;
      const timeoutMs = timeoutSeconds * 1000;
      const announceTimeoutMs = timeoutSeconds === 0 ? 30_000 : timeoutMs;
      const idempotencyKey = crypto.randomUUID();
      let runId: string = idempotencyKey;
      const displayKey = resolveDisplaySessionKey({
        key: sessionKey,
        alias,
        mainKey,
      });
      const agentMessageContext = buildAgentToAgentMessageContext({
        requesterSessionKey: opts?.agentSessionKey,
        requesterSurface: opts?.agentSurface,
        targetSessionKey: displayKey,
      });
      const sendParams = {
        message,
        sessionKey: resolvedKey,
        idempotencyKey,
        deliver: false,
        lane: "nested",
        extraSystemPrompt: agentMessageContext,
      };
      const requesterSessionKey = opts?.agentSessionKey;
      const requesterSurface = opts?.agentSurface;
      const maxPingPongTurns = resolvePingPongTurns(cfg);

      const resolveAnnounceTarget =
        async (): Promise<AnnounceTarget | null> => {
          const parsed = resolveAnnounceTargetFromKey(resolvedKey);
          if (parsed) return parsed;
          try {
            const list = (await callGateway({
              method: "sessions.list",
              params: {
                includeGlobal: true,
                includeUnknown: true,
                limit: 200,
              },
            })) as { sessions?: Array<Record<string, unknown>> };
            const sessions = Array.isArray(list?.sessions) ? list.sessions : [];
            const match =
              sessions.find((entry) => entry?.key === resolvedKey) ??
              sessions.find((entry) => entry?.key === displayKey);
            const channel =
              typeof match?.lastChannel === "string"
                ? match.lastChannel
                : undefined;
            const to =
              typeof match?.lastTo === "string" ? match.lastTo : undefined;
            if (channel && to) return { channel, to };
          } catch {
            // ignore; fall through to null
          }
          return null;
        };

      const readLatestAssistantReply = async (
        sessionKeyToRead: string,
      ): Promise<string | undefined> => {
        const history = (await callGateway({
          method: "chat.history",
          params: { sessionKey: sessionKeyToRead, limit: 50 },
        })) as { messages?: unknown[] };
        const filtered = stripToolMessages(
          Array.isArray(history?.messages) ? history.messages : [],
        );
        const last =
          filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
        return last ? extractAssistantText(last) : undefined;
      };

      const runAgentStep = async (params: {
        sessionKey: string;
        message: string;
        extraSystemPrompt: string;
        timeoutMs: number;
      }): Promise<string | undefined> => {
        const stepIdem = crypto.randomUUID();
        const response = (await callGateway({
          method: "agent",
          params: {
            message: params.message,
            sessionKey: params.sessionKey,
            idempotencyKey: stepIdem,
            deliver: false,
            lane: "nested",
            extraSystemPrompt: params.extraSystemPrompt,
          },
          timeoutMs: 10_000,
        })) as { runId?: string; acceptedAt?: number };
        const stepRunId =
          typeof response?.runId === "string" && response.runId
            ? response.runId
            : stepIdem;
        const stepAcceptedAt =
          typeof response?.acceptedAt === "number"
            ? response.acceptedAt
            : undefined;
        const stepWaitMs = Math.min(params.timeoutMs, 60_000);
        const wait = (await callGateway({
          method: "agent.wait",
          params: {
            runId: stepRunId,
            afterMs: stepAcceptedAt,
            timeoutMs: stepWaitMs,
          },
          timeoutMs: stepWaitMs + 2000,
        })) as { status?: string };
        if (wait?.status !== "ok") return undefined;
        return readLatestAssistantReply(params.sessionKey);
      };

      const runAgentToAgentFlow = async (
        roundOneReply?: string,
        runInfo?: { runId: string; acceptedAt?: number },
      ) => {
        try {
          let primaryReply = roundOneReply;
          let latestReply = roundOneReply;
          if (!primaryReply && runInfo?.runId) {
            const waitMs = Math.min(announceTimeoutMs, 60_000);
            const wait = (await callGateway({
              method: "agent.wait",
              params: {
                runId: runInfo.runId,
                afterMs: runInfo.acceptedAt,
                timeoutMs: waitMs,
              },
              timeoutMs: waitMs + 2000,
            })) as { status?: string };
            if (wait?.status === "ok") {
              primaryReply = await readLatestAssistantReply(resolvedKey);
              latestReply = primaryReply;
            }
          }
          if (!latestReply) return;
          const announceTarget = await resolveAnnounceTarget();
          const targetChannel = announceTarget?.channel ?? "unknown";
          if (
            maxPingPongTurns > 0 &&
            requesterSessionKey &&
            requesterSessionKey !== resolvedKey
          ) {
            let currentSessionKey = requesterSessionKey;
            let nextSessionKey = resolvedKey;
            let incomingMessage = latestReply;
            for (let turn = 1; turn <= maxPingPongTurns; turn += 1) {
              const currentRole =
                currentSessionKey === requesterSessionKey
                  ? "requester"
                  : "target";
              const replyPrompt = buildAgentToAgentReplyContext({
                requesterSessionKey,
                requesterSurface,
                targetSessionKey: displayKey,
                targetChannel,
                currentRole,
                turn,
                maxTurns: maxPingPongTurns,
              });
              const replyText = await runAgentStep({
                sessionKey: currentSessionKey,
                message: incomingMessage,
                extraSystemPrompt: replyPrompt,
                timeoutMs: announceTimeoutMs,
              });
              if (!replyText || isReplySkip(replyText)) {
                break;
              }
              latestReply = replyText;
              incomingMessage = replyText;
              const swap = currentSessionKey;
              currentSessionKey = nextSessionKey;
              nextSessionKey = swap;
            }
          }
          const announcePrompt = buildAgentToAgentAnnounceContext({
            requesterSessionKey,
            requesterSurface,
            targetSessionKey: displayKey,
            targetChannel,
            originalMessage: message,
            roundOneReply: primaryReply,
            latestReply,
          });
          const announceReply = await runAgentStep({
            sessionKey: resolvedKey,
            message: "Agent-to-agent announce step.",
            extraSystemPrompt: announcePrompt,
            timeoutMs: announceTimeoutMs,
          });
          if (
            announceTarget &&
            announceReply &&
            announceReply.trim() &&
            !isAnnounceSkip(announceReply)
          ) {
            await callGateway({
              method: "send",
              params: {
                to: announceTarget.to,
                message: announceReply.trim(),
                provider: announceTarget.channel,
                idempotencyKey: crypto.randomUUID(),
              },
              timeoutMs: 10_000,
            });
          }
        } catch {
          // Best-effort follow-ups; ignore failures to avoid breaking the caller response.
        }
      };

      if (timeoutSeconds === 0) {
        try {
          const response = (await callGateway({
            method: "agent",
            params: sendParams,
            timeoutMs: 10_000,
          })) as { runId?: string; acceptedAt?: number };
          const acceptedAt =
            typeof response?.acceptedAt === "number"
              ? response.acceptedAt
              : undefined;
          if (typeof response?.runId === "string" && response.runId) {
            runId = response.runId;
          }
          void runAgentToAgentFlow(undefined, { runId, acceptedAt });
          return jsonResult({
            runId,
            status: "accepted",
            sessionKey: displayKey,
          });
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : "error";
          return jsonResult({
            runId,
            status: "error",
            error: message,
            sessionKey: displayKey,
          });
        }
      }

      let acceptedAt: number | undefined;
      try {
        const response = (await callGateway({
          method: "agent",
          params: sendParams,
          timeoutMs: 10_000,
        })) as { runId?: string; acceptedAt?: number };
        if (typeof response?.runId === "string" && response.runId) {
          runId = response.runId;
        }
        if (typeof response?.acceptedAt === "number") {
          acceptedAt = response.acceptedAt;
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "error";
        return jsonResult({
          runId,
          status: "error",
          error: message,
          sessionKey: displayKey,
        });
      }

      let waitStatus: string | undefined;
      let waitError: string | undefined;
      try {
        const wait = (await callGateway({
          method: "agent.wait",
          params: {
            runId,
            afterMs: acceptedAt,
            timeoutMs,
          },
          timeoutMs: timeoutMs + 2000,
        })) as { status?: string; error?: string };
        waitStatus = typeof wait?.status === "string" ? wait.status : undefined;
        waitError = typeof wait?.error === "string" ? wait.error : undefined;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "error";
        return jsonResult({
          runId,
          status: message.includes("gateway timeout") ? "timeout" : "error",
          error: message,
          sessionKey: displayKey,
        });
      }

      if (waitStatus === "timeout") {
        return jsonResult({
          runId,
          status: "timeout",
          error: waitError,
          sessionKey: displayKey,
        });
      }
      if (waitStatus === "error") {
        return jsonResult({
          runId,
          status: "error",
          error: waitError ?? "agent error",
          sessionKey: displayKey,
        });
      }

      const history = (await callGateway({
        method: "chat.history",
        params: { sessionKey: resolvedKey, limit: 50 },
      })) as { messages?: unknown[] };
      const filtered = stripToolMessages(
        Array.isArray(history?.messages) ? history.messages : [],
      );
      const last =
        filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
      const reply = last ? extractAssistantText(last) : undefined;
      void runAgentToAgentFlow(reply ?? undefined);

      return jsonResult({
        runId,
        status: "ok",
        reply,
        sessionKey: displayKey,
      });
    },
  };
}

function createSlackTool(): AnyAgentTool {
  return {
    label: "Slack",
    name: "slack",
    description: "Manage Slack messages, reactions, pins, and lookup actions.",
    parameters: SlackToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const cfg = loadConfig();
      const isActionEnabled = (
        key: keyof SlackActionConfig,
        defaultValue = true,
      ) => {
        const value = cfg.slack?.actions?.[key];
        if (value === undefined) return defaultValue;
        return value !== false;
      };

      switch (action) {
        case "react": {
          if (!isActionEnabled("reactions")) {
            throw new Error("Slack reactions are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          const emoji = readStringParam(params, "emoji", { required: true });
          await reactSlackMessage(channelId, messageId, emoji);
          return jsonResult({ ok: true });
        }
        case "reactions": {
          if (!isActionEnabled("reactions")) {
            throw new Error("Slack reactions are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          const reactions = await listSlackReactions(channelId, messageId);
          return jsonResult({ ok: true, reactions });
        }
        case "sendMessage": {
          if (!isActionEnabled("messages")) {
            throw new Error("Slack messages are disabled.");
          }
          const to = readStringParam(params, "to", { required: true });
          const content = readStringParam(params, "content", {
            required: true,
          });
          const mediaUrl = readStringParam(params, "mediaUrl");
          const replyTo = readStringParam(params, "replyTo");
          const result = await sendSlackMessage(to, content, {
            mediaUrl: mediaUrl ?? undefined,
            replyTo: replyTo ?? undefined,
          });
          return jsonResult({ ok: true, result });
        }
        case "editMessage": {
          if (!isActionEnabled("messages")) {
            throw new Error("Slack messages are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          const content = readStringParam(params, "content", {
            required: true,
          });
          await editSlackMessage(channelId, messageId, content);
          return jsonResult({ ok: true });
        }
        case "deleteMessage": {
          if (!isActionEnabled("messages")) {
            throw new Error("Slack messages are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          await deleteSlackMessage(channelId, messageId);
          return jsonResult({ ok: true });
        }
        case "readMessages": {
          if (!isActionEnabled("messages")) {
            throw new Error("Slack messages are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const limitRaw = params.limit;
          const limit =
            typeof limitRaw === "number" && Number.isFinite(limitRaw)
              ? limitRaw
              : undefined;
          const before = readStringParam(params, "before");
          const after = readStringParam(params, "after");
          const result = await readSlackMessages(channelId, {
            limit,
            before: before ?? undefined,
            after: after ?? undefined,
          });
          return jsonResult({ ok: true, ...result });
        }
        case "searchMessages": {
          if (!isActionEnabled("search")) {
            throw new Error("Slack search is disabled.");
          }
          const query = readStringParam(params, "query", {
            required: true,
          });
          const limitRaw = params.limit;
          const limit =
            typeof limitRaw === "number" && Number.isFinite(limitRaw)
              ? limitRaw
              : undefined;
          const channelIds =
            readStringArrayParam(params, "channelIds", {
              label: "channelIds",
            }) ?? [];
          const channelNames =
            readStringArrayParam(params, "channelNames", {
              label: "channelNames",
            }) ?? [];
          const result = await searchSlackMessages(query, {
            limit,
            channelIds: channelIds.length > 0 ? channelIds : undefined,
            channelNames: channelNames.length > 0 ? channelNames : undefined,
          });
          return jsonResult({ ok: true, ...result });
        }
        case "pinMessage": {
          if (!isActionEnabled("pins")) {
            throw new Error("Slack pins are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          await pinSlackMessage(channelId, messageId);
          return jsonResult({ ok: true });
        }
        case "unpinMessage": {
          if (!isActionEnabled("pins")) {
            throw new Error("Slack pins are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const messageId = readStringParam(params, "messageId", {
            required: true,
          });
          await unpinSlackMessage(channelId, messageId);
          return jsonResult({ ok: true });
        }
        case "listPins": {
          if (!isActionEnabled("pins")) {
            throw new Error("Slack pins are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const pins = await listSlackPins(channelId);
          return jsonResult({ ok: true, pins });
        }
        case "permissions": {
          if (!isActionEnabled("permissions")) {
            throw new Error("Slack permissions are disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const info = await getSlackChannelInfo(channelId);
          return jsonResult({ ok: true, info });
        }
        case "memberInfo": {
          if (!isActionEnabled("memberInfo")) {
            throw new Error("Slack member info is disabled.");
          }
          const userId = readStringParam(params, "userId", { required: true });
          const info = await getSlackMemberInfo(userId);
          return jsonResult({ ok: true, info });
        }
        case "channelInfo": {
          if (!isActionEnabled("channelInfo")) {
            throw new Error("Slack channel info is disabled.");
          }
          const channelId = readStringParam(params, "channelId", {
            required: true,
          });
          const info = await getSlackChannelInfo(channelId);
          return jsonResult({ ok: true, info });
        }
        case "channelList": {
          if (!isActionEnabled("channelInfo")) {
            throw new Error("Slack channel info is disabled.");
          }
          const limitRaw = params.limit;
          const limit =
            typeof limitRaw === "number" && Number.isFinite(limitRaw)
              ? limitRaw
              : undefined;
          const cursor = readStringParam(params, "cursor");
          const info = await listSlackChannels({
            limit,
            cursor: cursor ?? undefined,
          });
          return jsonResult({ ok: true, info });
        }
        case "emojiList": {
          if (!isActionEnabled("emojiList")) {
            throw new Error("Slack emoji list is disabled.");
          }
          const emojis = await listSlackEmojis();
          return jsonResult({ ok: true, emojis });
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}

export function createClawdisTools(options?: {
  browserControlUrl?: string;
  agentSessionKey?: string;
  agentSurface?: string;
}): AnyAgentTool[] {
  return [
    createBrowserTool({ defaultControlUrl: options?.browserControlUrl }),
    createCanvasTool(),
    createNodesTool(),
    createCronTool(),
    createDiscordTool(),
    createSlackTool(),
    createGatewayTool(),
    createSessionsListTool(),
    createSessionsHistoryTool(),
    createSessionsSendTool({
      agentSessionKey: options?.agentSessionKey,
      agentSurface: options?.agentSurface,
    }),
  ];
}
