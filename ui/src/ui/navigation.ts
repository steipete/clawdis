export const TAB_GROUPS = [
  { label: "Chat", tabs: ["chat"] },
  {
    label: "Control",
    tabs: ["overview", "connections", "instances", "sessions", "cron"],
  },
  { label: "Agent", tabs: ["skills", "nodes"] },
  { label: "Settings", tabs: ["config", "debug"] },
] as const;

export type Tab =
  | "overview"
  | "connections"
  | "instances"
  | "sessions"
  | "cron"
  | "skills"
  | "nodes"
  | "chat"
  | "config"
  | "debug";

const TAB_PATHS: Record<Tab, string> = {
  overview: "/overview",
  connections: "/connections",
  instances: "/instances",
  sessions: "/sessions",
  cron: "/cron",
  skills: "/skills",
  nodes: "/nodes",
  chat: "/chat",
  config: "/config",
  debug: "/debug",
};

const PATH_TO_TAB = new Map(
  Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as Tab]),
);

function normalizeBasePath(basePath: string): string {
  if (!basePath) return "";
  let base = basePath.trim();
  if (!base.startsWith("/")) base = `/${base}`;
  if (base === "/") return "";
  if (base.endsWith("/")) base = base.slice(0, -1);
  return base;
}

export function normalizePath(path: string): string {
  if (!path) return "/";
  let normalized = path.trim();
  if (!normalized.startsWith("/")) normalized = `/${normalized}`;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function pathForTab(tab: Tab, basePath = ""): string {
  const base = normalizeBasePath(basePath);
  const path = TAB_PATHS[tab];
  return base ? `${base}${path}` : path;
}

export function tabFromPath(pathname: string, basePath = ""): Tab | null {
  const base = normalizeBasePath(basePath);
  let path = pathname || "/";
  if (base) {
    if (path === base) {
      path = "/";
    } else if (path.startsWith(`${base}/`)) {
      path = path.slice(base.length);
    }
  }
  let normalized = normalizePath(path).toLowerCase();
  if (normalized.endsWith("/index.html")) normalized = "/";
  if (normalized === "/") return "chat";
  return PATH_TO_TAB.get(normalized) ?? null;
}

export function titleForTab(tab: Tab) {
  switch (tab) {
    case "overview":
      return "Overview";
    case "connections":
      return "Connections";
    case "instances":
      return "Instances";
    case "sessions":
      return "Sessions";
    case "cron":
      return "Cron Jobs";
    case "skills":
      return "Skills";
    case "nodes":
      return "Nodes";
    case "chat":
      return "Chat";
    case "config":
      return "Config";
    case "debug":
      return "Debug";
    default:
      return "Control";
  }
}

export function subtitleForTab(tab: Tab) {
  switch (tab) {
    case "overview":
      return "Gateway status, entry points, and a fast health read.";
    case "connections":
      return "Link providers and keep transport settings in sync.";
    case "instances":
      return "Presence beacons from connected clients and nodes.";
    case "sessions":
      return "Inspect active sessions and adjust per-session defaults.";
    case "cron":
      return "Schedule wakeups and recurring agent runs.";
    case "skills":
      return "Manage skill availability and API key injection.";
    case "nodes":
      return "Paired devices, capabilities, and command exposure.";
    case "chat":
      return "Direct gateway chat session for quick interventions.";
    case "config":
      return "Edit ~/.clawdis/clawdis.json safely.";
    case "debug":
      return "Gateway snapshots, events, and manual RPC calls.";
    default:
      return "";
  }
}
