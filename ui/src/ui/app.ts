import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import { GatewayBrowserClient, type GatewayEventFrame, type GatewayHelloOk } from "./gateway";
import { loadSettings, saveSettings, type UiSettings } from "./storage";
import { renderApp } from "./app-render";
import { normalizePath, pathForTab, tabFromPath, type Tab } from "./navigation";
import {
  resolveTheme,
  type ResolvedTheme,
  type ThemeMode,
} from "./theme";
import {
  startThemeTransition,
  type ThemeTransitionContext,
} from "./theme-transition";
import type {
  ConfigSnapshot,
  CronJob,
  CronRunLogEntry,
  CronStatus,
  HealthSnapshot,
  PresenceEntry,
  ProvidersStatusSnapshot,
  SessionsListResult,
  SkillStatusReport,
  StatusSummary,
} from "./types";
import type { CronFormState, TelegramForm } from "./ui-types";
import { loadChatHistory, sendChat, handleChatEvent } from "./controllers/chat";
import { loadNodes } from "./controllers/nodes";
import { loadConfig } from "./controllers/config";
import {
  loadProviders,
  logoutWhatsApp,
  saveTelegramConfig,
  startWhatsAppLogin,
  waitWhatsAppLogin,
} from "./controllers/connections";
import { loadPresence } from "./controllers/presence";
import { loadSessions } from "./controllers/sessions";
import {
  loadCronJobs,
  loadCronStatus,
} from "./controllers/cron";
import {
  loadSkills,
} from "./controllers/skills";
import { loadDebug } from "./controllers/debug";

type EventLogEntry = {
  ts: number;
  event: string;
  payload?: unknown;
};

const DEFAULT_CRON_FORM: CronFormState = {
  name: "",
  description: "",
  enabled: true,
  scheduleKind: "every",
  scheduleAt: "",
  everyAmount: "30",
  everyUnit: "minutes",
  cronExpr: "0 7 * * *",
  cronTz: "",
  sessionTarget: "main",
  wakeMode: "next-heartbeat",
  payloadKind: "systemEvent",
  payloadText: "",
  deliver: false,
  channel: "last",
  to: "",
  timeoutSeconds: "",
  postToMainPrefix: "",
};

@customElement("clawdis-app")
export class ClawdisApp extends LitElement {
  @state() settings: UiSettings = loadSettings();
  @state() password = "";
  @state() tab: Tab = "chat";
  @state() connected = false;
  @state() theme: ThemeMode = this.settings.theme ?? "system";
  @state() themeResolved: ResolvedTheme = "dark";
  @state() hello: GatewayHelloOk | null = null;
  @state() lastError: string | null = null;
  @state() eventLog: EventLogEntry[] = [];

  @state() sessionKey = this.settings.sessionKey;
  @state() chatLoading = false;
  @state() chatSending = false;
  @state() chatMessage = "";
  @state() chatMessages: unknown[] = [];
  @state() chatStream: string | null = null;
  @state() chatRunId: string | null = null;
  @state() chatThinkingLevel: string | null = null;

  @state() nodesLoading = false;
  @state() nodes: Array<Record<string, unknown>> = [];

  @state() configLoading = false;
  @state() configRaw = "{\n}\n";
  @state() configValid: boolean | null = null;
  @state() configIssues: unknown[] = [];
  @state() configSaving = false;
  @state() configSnapshot: ConfigSnapshot | null = null;

  @state() providersLoading = false;
  @state() providersSnapshot: ProvidersStatusSnapshot | null = null;
  @state() providersError: string | null = null;
  @state() providersLastSuccess: number | null = null;
  @state() whatsappLoginMessage: string | null = null;
  @state() whatsappLoginQrDataUrl: string | null = null;
  @state() whatsappLoginConnected: boolean | null = null;
  @state() whatsappBusy = false;
  @state() telegramForm: TelegramForm = {
    token: "",
    requireMention: true,
    allowFrom: "",
    proxy: "",
    webhookUrl: "",
    webhookSecret: "",
    webhookPath: "",
  };
  @state() telegramSaving = false;
  @state() telegramTokenLocked = false;
  @state() telegramConfigStatus: string | null = null;

  @state() presenceLoading = false;
  @state() presenceEntries: PresenceEntry[] = [];
  @state() presenceError: string | null = null;
  @state() presenceStatus: string | null = null;

  @state() sessionsLoading = false;
  @state() sessionsResult: SessionsListResult | null = null;
  @state() sessionsError: string | null = null;
  @state() sessionsFilterActive = "";
  @state() sessionsFilterLimit = "120";
  @state() sessionsIncludeGlobal = true;
  @state() sessionsIncludeUnknown = false;

  @state() cronLoading = false;
  @state() cronJobs: CronJob[] = [];
  @state() cronStatus: CronStatus | null = null;
  @state() cronError: string | null = null;
  @state() cronForm: CronFormState = { ...DEFAULT_CRON_FORM };
  @state() cronRunsJobId: string | null = null;
  @state() cronRuns: CronRunLogEntry[] = [];
  @state() cronBusy = false;

  @state() skillsLoading = false;
  @state() skillsReport: SkillStatusReport | null = null;
  @state() skillsError: string | null = null;
  @state() skillsFilter = "";
  @state() skillEdits: Record<string, string> = {};
  @state() skillsBusyKey: string | null = null;

  @state() debugLoading = false;
  @state() debugStatus: StatusSummary | null = null;
  @state() debugHealth: HealthSnapshot | null = null;
  @state() debugModels: unknown[] = [];
  @state() debugHeartbeat: unknown | null = null;
  @state() debugCallMethod = "";
  @state() debugCallParams = "{}";
  @state() debugCallResult: string | null = null;
  @state() debugCallError: string | null = null;

  client: GatewayBrowserClient | null = null;
  private chatScrollFrame: number | null = null;
  private nodesPollInterval: number | null = null;
  basePath = "";
  private popStateHandler = () => this.onPopState();
  private themeMedia: MediaQueryList | null = null;
  private themeMediaHandler: ((event: MediaQueryListEvent) => void) | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.basePath = this.inferBasePath();
    this.syncTabWithLocation(true);
    this.syncThemeWithSettings();
    this.attachThemeListener();
    window.addEventListener("popstate", this.popStateHandler);
    this.connect();
    this.startNodesPolling();
  }

  disconnectedCallback() {
    window.removeEventListener("popstate", this.popStateHandler);
    this.stopNodesPolling();
    this.detachThemeListener();
    super.disconnectedCallback();
  }

  protected updated(changed: Map<PropertyKey, unknown>) {
    if (
      this.tab === "chat" &&
      (changed.has("chatMessages") ||
        changed.has("chatStream") ||
        changed.has("chatLoading") ||
        changed.has("tab"))
    ) {
      this.scheduleChatScroll();
    }
  }

  connect() {
    this.lastError = null;
    this.hello = null;
    this.connected = false;

    this.client?.stop();
    this.client = new GatewayBrowserClient({
      url: this.settings.gatewayUrl,
      token: this.settings.token.trim() ? this.settings.token : undefined,
      password: this.password.trim() ? this.password : undefined,
      clientName: "clawdis-control-ui",
      mode: "webchat",
      onHello: (hello) => {
        this.connected = true;
        this.hello = hello;
        this.applySnapshot(hello);
        void loadNodes(this, { quiet: true });
        void this.refreshActiveTab();
      },
      onClose: ({ code, reason }) => {
        this.connected = false;
        this.lastError = `disconnected (${code}): ${reason || "no reason"}`;
      },
      onEvent: (evt) => this.onEvent(evt),
      onGap: ({ expected, received }) => {
        this.lastError = `event gap detected (expected seq ${expected}, got ${received}); refresh recommended`;
      },
    });
    this.client.start();
  }

  private scheduleChatScroll() {
    if (this.chatScrollFrame) cancelAnimationFrame(this.chatScrollFrame);
    this.chatScrollFrame = requestAnimationFrame(() => {
      this.chatScrollFrame = null;
      const container = this.querySelector(".chat-thread") as HTMLElement | null;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
    });
  }

  private startNodesPolling() {
    if (this.nodesPollInterval != null) return;
    this.nodesPollInterval = window.setInterval(
      () => void loadNodes(this, { quiet: true }),
      5000,
    );
  }

  private stopNodesPolling() {
    if (this.nodesPollInterval == null) return;
    clearInterval(this.nodesPollInterval);
    this.nodesPollInterval = null;
  }

  private hasConnectedMobileNode() {
    return this.nodes.some((n) => {
      if (!Boolean(n.connected)) return false;
      const p =
        typeof n.platform === "string" ? n.platform.trim().toLowerCase() : "";
      return (
        p.startsWith("ios") || p.startsWith("ipados") || p.startsWith("android")
      );
    });
  }

  private onEvent(evt: GatewayEventFrame) {
    this.eventLog = [
      { ts: Date.now(), event: evt.event, payload: evt.payload },
      ...this.eventLog,
    ].slice(0, 250);

    if (evt.event === "chat") {
      const state = handleChatEvent(this, evt.payload as unknown);
      if (state === "final") void loadChatHistory(this);
      return;
    }

    if (evt.event === "presence") {
      const payload = evt.payload as { presence?: PresenceEntry[] } | undefined;
      if (payload?.presence && Array.isArray(payload.presence)) {
        this.presenceEntries = payload.presence;
        this.presenceError = null;
        this.presenceStatus = null;
      }
      return;
    }

    if (evt.event === "cron" && this.tab === "cron") {
      void this.loadCron();
    }
  }

  private applySnapshot(hello: GatewayHelloOk) {
    const snapshot = hello.snapshot as
      | { presence?: PresenceEntry[]; health?: HealthSnapshot }
      | undefined;
    if (snapshot?.presence && Array.isArray(snapshot.presence)) {
      this.presenceEntries = snapshot.presence;
    }
    if (snapshot?.health) {
      this.debugHealth = snapshot.health;
    }
  }

  applySettings(next: UiSettings) {
    this.settings = next;
    saveSettings(next);
    if (next.theme !== this.theme) {
      this.theme = next.theme;
      this.applyResolvedTheme(resolveTheme(next.theme));
    }
  }

  setTab(next: Tab) {
    if (this.tab !== next) this.tab = next;
    void this.refreshActiveTab();
    this.syncUrlWithTab(next, false);
  }

  setTheme(next: ThemeMode, context?: ThemeTransitionContext) {
    const applyTheme = () => {
      this.theme = next;
      this.applySettings({ ...this.settings, theme: next });
      this.applyResolvedTheme(resolveTheme(next));
    };
    startThemeTransition({
      nextTheme: next,
      applyTheme,
      context,
      currentTheme: this.theme,
    });
  }

  private async refreshActiveTab() {
    if (this.tab === "overview") await this.loadOverview();
    if (this.tab === "connections") await this.loadConnections();
    if (this.tab === "instances") await loadPresence(this);
    if (this.tab === "sessions") await loadSessions(this);
    if (this.tab === "cron") await this.loadCron();
    if (this.tab === "skills") await loadSkills(this);
    if (this.tab === "nodes") await loadNodes(this);
    if (this.tab === "chat") {
      await loadChatHistory(this);
      this.scheduleChatScroll();
    }
    if (this.tab === "config") await loadConfig(this);
    if (this.tab === "debug") await loadDebug(this);
  }

  private inferBasePath() {
    if (typeof window === "undefined") return "";
    const path = window.location.pathname;
    if (path === "/ui" || path.startsWith("/ui/")) return "/ui";
    return "";
  }

  private syncThemeWithSettings() {
    this.theme = this.settings.theme ?? "system";
    this.applyResolvedTheme(resolveTheme(this.theme));
  }

  private applyResolvedTheme(resolved: ResolvedTheme) {
    this.themeResolved = resolved;
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  }

  private attachThemeListener() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return;
    this.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
    this.themeMediaHandler = (event) => {
      if (this.theme !== "system") return;
      this.applyResolvedTheme(event.matches ? "dark" : "light");
    };
    if ("addEventListener" in this.themeMedia) {
      this.themeMedia.addEventListener("change", this.themeMediaHandler);
    } else {
      this.themeMedia.addListener(this.themeMediaHandler);
    }
  }

  private detachThemeListener() {
    if (!this.themeMedia || !this.themeMediaHandler) return;
    if ("removeEventListener" in this.themeMedia) {
      this.themeMedia.removeEventListener("change", this.themeMediaHandler);
    } else {
      this.themeMedia.removeListener(this.themeMediaHandler);
    }
    this.themeMedia = null;
    this.themeMediaHandler = null;
  }

  private syncTabWithLocation(replace: boolean) {
    if (typeof window === "undefined") return;
    const resolved = tabFromPath(window.location.pathname, this.basePath) ?? "chat";
    this.setTabFromRoute(resolved);
    this.syncUrlWithTab(resolved, replace);
  }

  private onPopState() {
    if (typeof window === "undefined") return;
    const resolved = tabFromPath(window.location.pathname, this.basePath);
    if (!resolved) return;
    this.setTabFromRoute(resolved);
  }

  private setTabFromRoute(next: Tab) {
    if (this.tab !== next) this.tab = next;
    if (this.connected) void this.refreshActiveTab();
  }

  private syncUrlWithTab(tab: Tab, replace: boolean) {
    if (typeof window === "undefined") return;
    const targetPath = normalizePath(pathForTab(tab, this.basePath));
    const currentPath = normalizePath(window.location.pathname);
    if (currentPath === targetPath) return;
    const url = new URL(window.location.href);
    url.pathname = targetPath;
    if (replace) {
      window.history.replaceState({}, "", url.toString());
    } else {
      window.history.pushState({}, "", url.toString());
    }
  }

  async loadOverview() {
    await Promise.all([
      loadProviders(this, false),
      loadPresence(this),
      loadSessions(this),
      loadCronStatus(this),
      loadDebug(this),
    ]);
  }

  private async loadConnections() {
    await Promise.all([loadProviders(this, true), loadConfig(this)]);
  }

  async loadCron() {
    await Promise.all([loadCronStatus(this), loadCronJobs(this)]);
  }

  async handleSendChat() {
    if (!this.connected || !this.hasConnectedMobileNode()) return;
    await sendChat(this);
    void loadChatHistory(this);
  }

  async handleWhatsAppStart(force: boolean) {
    await startWhatsAppLogin(this, force);
    await loadProviders(this, true);
  }

  async handleWhatsAppWait() {
    await waitWhatsAppLogin(this);
    await loadProviders(this, true);
  }

  async handleWhatsAppLogout() {
    await logoutWhatsApp(this);
    await loadProviders(this, true);
  }

  async handleTelegramSave() {
    await saveTelegramConfig(this);
    await loadConfig(this);
    await loadProviders(this, true);
  }

  render() {
    return renderApp(this);
  }
}
