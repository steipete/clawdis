import { spawnSync } from "node:child_process";
import os from "node:os";

export type SystemPresence = {
  host?: string;
  ip?: string;
  version?: string;
  platform?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  lastInputSeconds?: number;
  mode?: string;
  reason?: string;
  instanceId?: string;
  text: string;
  ts: number;
};

export type SystemPresenceUpdate = {
  key: string;
  previous?: SystemPresence;
  next: SystemPresence;
  changes: Partial<SystemPresence>;
  changedKeys: (keyof SystemPresence)[];
};

const entries = new Map<string, SystemPresence>();
const TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ENTRIES = 200;

function normalizePresenceKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (!trimmed) return undefined;
  return trimmed.toLowerCase();
}

function resolvePrimaryIPv4(): string | undefined {
  const nets = os.networkInterfaces();
  const prefer = ["en0", "eth0"];
  const pick = (names: string[]) => {
    for (const name of names) {
      const list = nets[name];
      const entry = list?.find((n) => n.family === "IPv4" && !n.internal);
      if (entry?.address) return entry.address;
    }
    for (const list of Object.values(nets)) {
      const entry = list?.find((n) => n.family === "IPv4" && !n.internal);
      if (entry?.address) return entry.address;
    }
    return undefined;
  };
  return pick(prefer) ?? os.hostname();
}

function initSelfPresence() {
  const host = os.hostname();
  const ip = resolvePrimaryIPv4() ?? undefined;
  const version =
    process.env.CLAWDIS_VERSION ?? process.env.npm_package_version ?? "unknown";
  const modelIdentifier = (() => {
    const p = os.platform();
    if (p === "darwin") {
      const res = spawnSync("sysctl", ["-n", "hw.model"], {
        encoding: "utf-8",
      });
      const out = typeof res.stdout === "string" ? res.stdout.trim() : "";
      return out.length > 0 ? out : undefined;
    }
    return os.arch();
  })();
  const macOSVersion = () => {
    const res = spawnSync("sw_vers", ["-productVersion"], {
      encoding: "utf-8",
    });
    const out = typeof res.stdout === "string" ? res.stdout.trim() : "";
    return out.length > 0 ? out : os.release();
  };
  const platform = (() => {
    const p = os.platform();
    const rel = os.release();
    if (p === "darwin") return `macos ${macOSVersion()}`;
    if (p === "win32") return `windows ${rel}`;
    return `${p} ${rel}`;
  })();
  const deviceFamily = (() => {
    const p = os.platform();
    if (p === "darwin") return "Mac";
    if (p === "win32") return "Windows";
    if (p === "linux") return "Linux";
    return p;
  })();
  const text = `Gateway: ${host}${ip ? ` (${ip})` : ""} · app ${version} · mode gateway · reason self`;
  const selfEntry: SystemPresence = {
    host,
    ip,
    version,
    platform,
    deviceFamily,
    modelIdentifier,
    mode: "gateway",
    reason: "self",
    text,
    ts: Date.now(),
  };
  const key = host.toLowerCase();
  entries.set(key, selfEntry);
}

function ensureSelfPresence() {
  // If the map was somehow cleared (e.g., hot reload or a new worker spawn that
  // skipped module evaluation), re-seed with a local entry so UIs always show
  // at least the current gateway.
  if (entries.size === 0) {
    initSelfPresence();
  }
}

function touchSelfPresence() {
  const host = os.hostname();
  const key = host.toLowerCase();
  const existing = entries.get(key);
  if (existing) {
    entries.set(key, { ...existing, ts: Date.now() });
  } else {
    initSelfPresence();
  }
}

initSelfPresence();

function parsePresence(text: string): SystemPresence {
  const trimmed = text.trim();
  const pattern =
    /Node:\s*([^ (]+)\s*\(([^)]+)\)\s*·\s*app\s*([^·]+?)\s*·\s*last input\s*([0-9]+)s ago\s*·\s*mode\s*([^·]+?)\s*·\s*reason\s*(.+)$/i;
  const match = trimmed.match(pattern);
  if (!match) {
    return { text: trimmed, ts: Date.now() };
  }
  const [, host, ip, version, lastInputStr, mode, reasonRaw] = match;
  const lastInputSeconds = Number.parseInt(lastInputStr, 10);
  const reason = reasonRaw.trim();
  return {
    host: host.trim(),
    ip: ip.trim(),
    version: version.trim(),
    lastInputSeconds: Number.isFinite(lastInputSeconds)
      ? lastInputSeconds
      : undefined,
    mode: mode.trim(),
    reason,
    text: trimmed,
    ts: Date.now(),
  };
}

type SystemPresencePayload = {
  text: string;
  instanceId?: string;
  host?: string;
  ip?: string;
  version?: string;
  platform?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  lastInputSeconds?: number;
  mode?: string;
  reason?: string;
  tags?: string[];
};

export function updateSystemPresence(
  payload: SystemPresencePayload,
): SystemPresenceUpdate {
  ensureSelfPresence();
  const parsed = parsePresence(payload.text);
  const key =
    normalizePresenceKey(payload.instanceId) ||
    normalizePresenceKey(parsed.instanceId) ||
    normalizePresenceKey(parsed.host) ||
    parsed.ip ||
    parsed.text.slice(0, 64) ||
    os.hostname().toLowerCase();
  const hadExisting = entries.has(key);
  const existing = entries.get(key) ?? ({} as SystemPresence);
  const merged: SystemPresence = {
    ...existing,
    ...parsed,
    host: payload.host ?? parsed.host ?? existing.host,
    ip: payload.ip ?? parsed.ip ?? existing.ip,
    version: payload.version ?? parsed.version ?? existing.version,
    platform: payload.platform ?? existing.platform,
    deviceFamily: payload.deviceFamily ?? existing.deviceFamily,
    modelIdentifier: payload.modelIdentifier ?? existing.modelIdentifier,
    mode: payload.mode ?? parsed.mode ?? existing.mode,
    lastInputSeconds:
      payload.lastInputSeconds ??
      parsed.lastInputSeconds ??
      existing.lastInputSeconds,
    reason: payload.reason ?? parsed.reason ?? existing.reason,
    instanceId: payload.instanceId ?? parsed.instanceId ?? existing.instanceId,
    text: payload.text || parsed.text || existing.text,
    ts: Date.now(),
  };
  entries.set(key, merged);
  const trackKeys = ["host", "ip", "version", "mode", "reason"] as const;
  type TrackKey = (typeof trackKeys)[number];
  const changes: Partial<Pick<SystemPresence, TrackKey>> = {};
  const changedKeys: TrackKey[] = [];
  for (const k of trackKeys) {
    const prev = existing[k];
    const next = merged[k];
    if (prev !== next) {
      changes[k] = next;
      changedKeys.push(k);
    }
  }
  return {
    key,
    previous: hadExisting ? existing : undefined,
    next: merged,
    changes,
    changedKeys,
  } satisfies SystemPresenceUpdate;
}

export function upsertPresence(key: string, presence: Partial<SystemPresence>) {
  ensureSelfPresence();
  const normalizedKey =
    normalizePresenceKey(key) ?? os.hostname().toLowerCase();
  const existing = entries.get(normalizedKey) ?? ({} as SystemPresence);
  const merged: SystemPresence = {
    ...existing,
    ...presence,
    ts: Date.now(),
    text:
      presence.text ||
      existing.text ||
      `Node: ${presence.host ?? existing.host ?? "unknown"} · mode ${
        presence.mode ?? existing.mode ?? "unknown"
      }`,
  };
  entries.set(normalizedKey, merged);
}

export function listSystemPresence(): SystemPresence[] {
  ensureSelfPresence();
  // prune expired
  const now = Date.now();
  for (const [k, v] of entries) {
    if (now - v.ts > TTL_MS) entries.delete(k);
  }
  // enforce max size (LRU by ts)
  if (entries.size > MAX_ENTRIES) {
    const sorted = [...entries.entries()].sort((a, b) => a[1].ts - b[1].ts);
    const toDrop = entries.size - MAX_ENTRIES;
    for (let i = 0; i < toDrop; i++) {
      entries.delete(sorted[i][0]);
    }
  }
  touchSelfPresence();
  return [...entries.values()].sort((a, b) => b.ts - a.ts);
}
