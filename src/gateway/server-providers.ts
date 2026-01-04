import type { ClawdisConfig } from "../config/config.js";
import { monitorDiscordProvider } from "../discord/index.js";
import { probeDiscord } from "../discord/probe.js";
import { shouldLogVerbose } from "../globals.js";
import { monitorIMessageProvider } from "../imessage/index.js";
import type { createSubsystemLogger } from "../logging.js";
import { monitorWebProvider, webAuthExists } from "../providers/web/index.js";
import type { RuntimeEnv } from "../runtime.js";
import { monitorSignalProvider } from "../signal/index.js";
import { monitorSlackProvider } from "../slack/index.js";
import { probeSlack } from "../slack/probe.js";
import { monitorTelegramProvider } from "../telegram/monitor.js";
import { probeTelegram } from "../telegram/probe.js";
import { resolveTelegramToken } from "../telegram/token.js";
import type { WebProviderStatus } from "../web/auto-reply.js";
import { readWebSelfId } from "../web/session.js";
import { formatError } from "./server-utils.js";

export type TelegramRuntimeStatus = {
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  mode?: "webhook" | "polling" | null;
};

export type DiscordRuntimeStatus = {
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
};

export type SlackRuntimeStatus = {
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
};

export type SignalRuntimeStatus = {
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  baseUrl?: string | null;
};

export type IMessageRuntimeStatus = {
  running: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  cliPath?: string | null;
  dbPath?: string | null;
};

export type ProviderRuntimeSnapshot = {
  whatsapp: WebProviderStatus;
  telegram: TelegramRuntimeStatus;
  discord: DiscordRuntimeStatus;
  slack: SlackRuntimeStatus;
  signal: SignalRuntimeStatus;
  imessage: IMessageRuntimeStatus;
};

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

type ProviderManagerOptions = {
  loadConfig: () => ClawdisConfig;
  logWhatsApp: SubsystemLogger;
  logTelegram: SubsystemLogger;
  logDiscord: SubsystemLogger;
  logSlack: SubsystemLogger;
  logSignal: SubsystemLogger;
  logIMessage: SubsystemLogger;
  whatsappRuntimeEnv: RuntimeEnv;
  telegramRuntimeEnv: RuntimeEnv;
  discordRuntimeEnv: RuntimeEnv;
  slackRuntimeEnv: RuntimeEnv;
  signalRuntimeEnv: RuntimeEnv;
  imessageRuntimeEnv: RuntimeEnv;
};

export type ProviderManager = {
  getRuntimeSnapshot: () => ProviderRuntimeSnapshot;
  startProviders: () => Promise<void>;
  startWhatsAppProvider: () => Promise<void>;
  stopWhatsAppProvider: () => Promise<void>;
  startTelegramProvider: () => Promise<void>;
  stopTelegramProvider: () => Promise<void>;
  startDiscordProvider: () => Promise<void>;
  stopDiscordProvider: () => Promise<void>;
  startSlackProvider: () => Promise<void>;
  stopSlackProvider: () => Promise<void>;
  startSignalProvider: () => Promise<void>;
  stopSignalProvider: () => Promise<void>;
  startIMessageProvider: () => Promise<void>;
  stopIMessageProvider: () => Promise<void>;
  markWhatsAppLoggedOut: (cleared: boolean) => void;
};

export function createProviderManager(
  opts: ProviderManagerOptions,
): ProviderManager {
  const {
    loadConfig,
    logWhatsApp,
    logTelegram,
    logDiscord,
    logSlack,
    logSignal,
    logIMessage,
    whatsappRuntimeEnv,
    telegramRuntimeEnv,
    discordRuntimeEnv,
    slackRuntimeEnv,
    signalRuntimeEnv,
    imessageRuntimeEnv,
  } = opts;

  let whatsappAbort: AbortController | null = null;
  let telegramAbort: AbortController | null = null;
  let discordAbort: AbortController | null = null;
  let slackAbort: AbortController | null = null;
  let signalAbort: AbortController | null = null;
  let imessageAbort: AbortController | null = null;
  let whatsappTask: Promise<unknown> | null = null;
  let telegramTask: Promise<unknown> | null = null;
  let discordTask: Promise<unknown> | null = null;
  let slackTask: Promise<unknown> | null = null;
  let signalTask: Promise<unknown> | null = null;
  let imessageTask: Promise<unknown> | null = null;

  let whatsappRuntime: WebProviderStatus = {
    running: false,
    connected: false,
    reconnectAttempts: 0,
    lastConnectedAt: null,
    lastDisconnect: null,
    lastMessageAt: null,
    lastEventAt: null,
    lastError: null,
  };
  let telegramRuntime: TelegramRuntimeStatus = {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    mode: null,
  };
  let discordRuntime: DiscordRuntimeStatus = {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
  };
  let slackRuntime: SlackRuntimeStatus = {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
  };
  let signalRuntime: SignalRuntimeStatus = {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    baseUrl: null,
  };
  let imessageRuntime: IMessageRuntimeStatus = {
    running: false,
    lastStartAt: null,
    lastStopAt: null,
    lastError: null,
    cliPath: null,
    dbPath: null,
  };

  const updateWhatsAppStatus = (next: WebProviderStatus) => {
    whatsappRuntime = next;
  };

  const startWhatsAppProvider = async () => {
    if (whatsappTask) return;
    const cfg = loadConfig();
    if (cfg.web?.enabled === false) {
      whatsappRuntime = {
        ...whatsappRuntime,
        running: false,
        connected: false,
        lastError: "disabled",
      };
      logWhatsApp.info("skipping provider start (web.enabled=false)");
      return;
    }
    if (!(await webAuthExists())) {
      whatsappRuntime = {
        ...whatsappRuntime,
        running: false,
        connected: false,
        lastError: "not linked",
      };
      logWhatsApp.info("skipping provider start (no linked session)");
      return;
    }
    const { e164, jid } = readWebSelfId();
    const identity = e164 ? e164 : jid ? `jid ${jid}` : "unknown";
    logWhatsApp.info(`starting provider (${identity})`);
    whatsappAbort = new AbortController();
    whatsappRuntime = {
      ...whatsappRuntime,
      running: true,
      connected: false,
      lastError: null,
    };
    const task = monitorWebProvider(
      shouldLogVerbose(),
      undefined,
      true,
      undefined,
      whatsappRuntimeEnv,
      whatsappAbort.signal,
      { statusSink: updateWhatsAppStatus },
    )
      .catch((err) => {
        whatsappRuntime = {
          ...whatsappRuntime,
          lastError: formatError(err),
        };
        logWhatsApp.error(`provider exited: ${formatError(err)}`);
      })
      .finally(() => {
        whatsappAbort = null;
        whatsappTask = null;
        whatsappRuntime = {
          ...whatsappRuntime,
          running: false,
          connected: false,
        };
      });
    whatsappTask = task;
  };

  const stopWhatsAppProvider = async () => {
    if (!whatsappAbort && !whatsappTask) return;
    whatsappAbort?.abort();
    try {
      await whatsappTask;
    } catch {
      // ignore
    }
    whatsappAbort = null;
    whatsappTask = null;
    whatsappRuntime = {
      ...whatsappRuntime,
      running: false,
      connected: false,
    };
  };

  const startTelegramProvider = async () => {
    if (telegramTask) return;
    const cfg = loadConfig();
    if (cfg.telegram?.enabled === false) {
      telegramRuntime = {
        ...telegramRuntime,
        running: false,
        lastError: "disabled",
      };
      if (shouldLogVerbose()) {
        logTelegram.debug(
          "telegram provider disabled (telegram.enabled=false)",
        );
      }
      return;
    }
    const { token: telegramToken } = resolveTelegramToken(cfg, {
      logMissingFile: (message) => logTelegram.warn(message),
    });
    if (!telegramToken.trim()) {
      telegramRuntime = {
        ...telegramRuntime,
        running: false,
        lastError: "not configured",
      };
      // keep quiet by default; this is a normal state
      if (shouldLogVerbose()) {
        logTelegram.debug(
          "telegram provider not configured (no TELEGRAM_BOT_TOKEN)",
        );
      }
      return;
    }
    let telegramBotLabel = "";
    try {
      const probe = await probeTelegram(
        telegramToken.trim(),
        2500,
        cfg.telegram?.proxy,
      );
      const username = probe.ok ? probe.bot?.username?.trim() : null;
      if (username) telegramBotLabel = ` (@${username})`;
    } catch (err) {
      if (shouldLogVerbose()) {
        logTelegram.debug(`bot probe failed: ${String(err)}`);
      }
    }
    logTelegram.info(
      `starting provider${telegramBotLabel}${cfg.telegram ? "" : " (no telegram config; token via env)"}`,
    );
    telegramAbort = new AbortController();
    telegramRuntime = {
      ...telegramRuntime,
      running: true,
      lastStartAt: Date.now(),
      lastError: null,
      mode: cfg.telegram?.webhookUrl ? "webhook" : "polling",
    };
    const task = monitorTelegramProvider({
      token: telegramToken.trim(),
      runtime: telegramRuntimeEnv,
      abortSignal: telegramAbort.signal,
      useWebhook: Boolean(cfg.telegram?.webhookUrl),
      webhookUrl: cfg.telegram?.webhookUrl,
      webhookSecret: cfg.telegram?.webhookSecret,
      webhookPath: cfg.telegram?.webhookPath,
    })
      .catch((err) => {
        telegramRuntime = {
          ...telegramRuntime,
          lastError: formatError(err),
        };
        logTelegram.error(`provider exited: ${formatError(err)}`);
      })
      .finally(() => {
        telegramAbort = null;
        telegramTask = null;
        telegramRuntime = {
          ...telegramRuntime,
          running: false,
          lastStopAt: Date.now(),
        };
      });
    telegramTask = task;
  };

  const stopTelegramProvider = async () => {
    if (!telegramAbort && !telegramTask) return;
    telegramAbort?.abort();
    try {
      await telegramTask;
    } catch {
      // ignore
    }
    telegramAbort = null;
    telegramTask = null;
    telegramRuntime = {
      ...telegramRuntime,
      running: false,
      lastStopAt: Date.now(),
    };
  };

  const startDiscordProvider = async () => {
    if (discordTask) return;
    const cfg = loadConfig();
    if (cfg.discord?.enabled === false) {
      discordRuntime = {
        ...discordRuntime,
        running: false,
        lastError: "disabled",
      };
      if (shouldLogVerbose()) {
        logDiscord.debug("discord provider disabled (discord.enabled=false)");
      }
      return;
    }
    const discordToken =
      process.env.DISCORD_BOT_TOKEN ?? cfg.discord?.token ?? "";
    if (!discordToken.trim()) {
      discordRuntime = {
        ...discordRuntime,
        running: false,
        lastError: "not configured",
      };
      // keep quiet by default; this is a normal state
      if (shouldLogVerbose()) {
        logDiscord.debug(
          "discord provider not configured (no DISCORD_BOT_TOKEN)",
        );
      }
      return;
    }
    let discordBotLabel = "";
    try {
      const probe = await probeDiscord(discordToken.trim(), 2500);
      const username = probe.ok ? probe.bot?.username?.trim() : null;
      if (username) discordBotLabel = ` (@${username})`;
    } catch (err) {
      if (shouldLogVerbose()) {
        logDiscord.debug(`bot probe failed: ${String(err)}`);
      }
    }
    logDiscord.info(
      `starting provider${discordBotLabel}${cfg.discord ? "" : " (no discord config; token via env)"}`,
    );
    discordAbort = new AbortController();
    discordRuntime = {
      ...discordRuntime,
      running: true,
      lastStartAt: Date.now(),
      lastError: null,
    };
    const task = monitorDiscordProvider({
      token: discordToken.trim(),
      runtime: discordRuntimeEnv,
      abortSignal: discordAbort.signal,
      slashCommand: cfg.discord?.slashCommand,
      mediaMaxMb: cfg.discord?.mediaMaxMb,
      historyLimit: cfg.discord?.historyLimit,
    })
      .catch((err) => {
        discordRuntime = {
          ...discordRuntime,
          lastError: formatError(err),
        };
        logDiscord.error(`provider exited: ${formatError(err)}`);
      })
      .finally(() => {
        discordAbort = null;
        discordTask = null;
        discordRuntime = {
          ...discordRuntime,
          running: false,
          lastStopAt: Date.now(),
        };
      });
    discordTask = task;
  };

  const stopDiscordProvider = async () => {
    if (!discordAbort && !discordTask) return;
    discordAbort?.abort();
    try {
      await discordTask;
    } catch {
      // ignore
    }
    discordAbort = null;
    discordTask = null;
    discordRuntime = {
      ...discordRuntime,
      running: false,
      lastStopAt: Date.now(),
    };
  };

  const startSlackProvider = async () => {
    if (slackTask) return;
    const cfg = loadConfig();
    if (cfg.slack?.enabled === false) {
      slackRuntime = {
        ...slackRuntime,
        running: false,
        lastError: "disabled",
      };
      if (shouldLogVerbose()) {
        logSlack.debug("slack provider disabled (slack.enabled=false)");
      }
      return;
    }
    const slackBotToken =
      process.env.SLACK_BOT_TOKEN ?? cfg.slack?.botToken ?? "";
    const slackAppToken =
      process.env.SLACK_APP_TOKEN ?? cfg.slack?.appToken ?? "";
    if (!slackBotToken.trim() || !slackAppToken.trim()) {
      slackRuntime = {
        ...slackRuntime,
        running: false,
        lastError: "not configured",
      };
      if (shouldLogVerbose()) {
        logSlack.debug(
          "slack provider not configured (missing SLACK_BOT_TOKEN or SLACK_APP_TOKEN)",
        );
      }
      return;
    }
    let slackLabel = "";
    try {
      const probe = await probeSlack(slackBotToken.trim(), 2500);
      const team = probe.ok ? probe.team?.name?.trim() : null;
      if (team) slackLabel = ` (${team})`;
    } catch (err) {
      if (shouldLogVerbose()) {
        logSlack.debug(`bot probe failed: ${String(err)}`);
      }
    }
    logSlack.info(
      `starting provider${slackLabel}${cfg.slack ? "" : " (no slack config; token via env)"}`,
    );
    slackAbort = new AbortController();
    slackRuntime = {
      ...slackRuntime,
      running: true,
      lastStartAt: Date.now(),
      lastError: null,
    };
    const task = monitorSlackProvider({
      botToken: slackBotToken.trim(),
      appToken: slackAppToken.trim(),
      runtime: slackRuntimeEnv,
      abortSignal: slackAbort.signal,
      replyToMode: cfg.slack?.replyToMode,
      mediaMaxMb: cfg.slack?.mediaMaxMb,
    })
      .catch((err) => {
        slackRuntime = {
          ...slackRuntime,
          lastError: formatError(err),
        };
        logSlack.error(`provider exited: ${formatError(err)}`);
      })
      .finally(() => {
        slackAbort = null;
        slackTask = null;
        slackRuntime = {
          ...slackRuntime,
          running: false,
          lastStopAt: Date.now(),
        };
      });
    slackTask = task;
  };

  const stopSlackProvider = async () => {
    if (!slackAbort && !slackTask) return;
    slackAbort?.abort();
    try {
      await slackTask;
    } catch {
      // ignore
    }
    slackAbort = null;
    slackTask = null;
    slackRuntime = {
      ...slackRuntime,
      running: false,
      lastStopAt: Date.now(),
    };
  };

  const startSignalProvider = async () => {
    if (signalTask) return;
    const cfg = loadConfig();
    if (!cfg.signal) {
      signalRuntime = {
        ...signalRuntime,
        running: false,
        lastError: "not configured",
      };
      // keep quiet by default; this is a normal state
      if (shouldLogVerbose()) {
        logSignal.debug("signal provider not configured (no signal config)");
      }
      return;
    }
    if (cfg.signal?.enabled === false) {
      signalRuntime = {
        ...signalRuntime,
        running: false,
        lastError: "disabled",
      };
      if (shouldLogVerbose()) {
        logSignal.debug("signal provider disabled (signal.enabled=false)");
      }
      return;
    }
    const signalCfg = cfg.signal;
    const signalMeaningfullyConfigured = Boolean(
      signalCfg.account?.trim() ||
        signalCfg.httpUrl?.trim() ||
        signalCfg.cliPath?.trim() ||
        signalCfg.httpHost?.trim() ||
        typeof signalCfg.httpPort === "number" ||
        typeof signalCfg.autoStart === "boolean",
    );
    if (!signalMeaningfullyConfigured) {
      signalRuntime = {
        ...signalRuntime,
        running: false,
        lastError: "not configured",
      };
      // keep quiet by default; this is a normal state
      if (shouldLogVerbose()) {
        logSignal.debug(
          "signal provider not configured (signal config present but missing required fields)",
        );
      }
      return;
    }
    const host = cfg.signal?.httpHost?.trim() || "127.0.0.1";
    const port = cfg.signal?.httpPort ?? 8080;
    const baseUrl = cfg.signal?.httpUrl?.trim() || `http://${host}:${port}`;
    logSignal.info(`starting provider (${baseUrl})`);
    signalAbort = new AbortController();
    signalRuntime = {
      ...signalRuntime,
      running: true,
      lastStartAt: Date.now(),
      lastError: null,
      baseUrl,
    };
    const task = monitorSignalProvider({
      baseUrl,
      account: cfg.signal?.account,
      cliPath: cfg.signal?.cliPath,
      httpHost: cfg.signal?.httpHost,
      httpPort: cfg.signal?.httpPort,
      autoStart:
        typeof cfg.signal?.autoStart === "boolean"
          ? cfg.signal.autoStart
          : undefined,
      runtime: signalRuntimeEnv,
      abortSignal: signalAbort.signal,
    })
      .catch((err) => {
        signalRuntime = {
          ...signalRuntime,
          lastError: formatError(err),
        };
        logSignal.error(`provider exited: ${formatError(err)}`);
      })
      .finally(() => {
        signalAbort = null;
        signalTask = null;
        signalRuntime = {
          ...signalRuntime,
          running: false,
          lastStopAt: Date.now(),
        };
      });
    signalTask = task;
  };

  const stopSignalProvider = async () => {
    if (!signalAbort && !signalTask) return;
    signalAbort?.abort();
    try {
      await signalTask;
    } catch {
      // ignore
    }
    signalAbort = null;
    signalTask = null;
    signalRuntime = {
      ...signalRuntime,
      running: false,
      lastStopAt: Date.now(),
    };
  };

  const startIMessageProvider = async () => {
    if (imessageTask) return;
    const cfg = loadConfig();
    if (!cfg.imessage) {
      imessageRuntime = {
        ...imessageRuntime,
        running: false,
        lastError: "not configured",
      };
      // keep quiet by default; this is a normal state
      if (shouldLogVerbose()) {
        logIMessage.debug(
          "imessage provider not configured (no imessage config)",
        );
      }
      return;
    }
    if (cfg.imessage?.enabled === false) {
      imessageRuntime = {
        ...imessageRuntime,
        running: false,
        lastError: "disabled",
      };
      if (shouldLogVerbose()) {
        logIMessage.debug(
          "imessage provider disabled (imessage.enabled=false)",
        );
      }
      return;
    }
    const cliPath = cfg.imessage?.cliPath?.trim() || "imsg";
    const dbPath = cfg.imessage?.dbPath?.trim();
    logIMessage.info(
      `starting provider (${cliPath}${dbPath ? ` db=${dbPath}` : ""})`,
    );
    imessageAbort = new AbortController();
    imessageRuntime = {
      ...imessageRuntime,
      running: true,
      lastStartAt: Date.now(),
      lastError: null,
      cliPath,
      dbPath: dbPath ?? null,
    };
    const task = monitorIMessageProvider({
      cliPath,
      dbPath,
      allowFrom: cfg.imessage?.allowFrom,
      includeAttachments: cfg.imessage?.includeAttachments,
      mediaMaxMb: cfg.imessage?.mediaMaxMb,
      runtime: imessageRuntimeEnv,
      abortSignal: imessageAbort.signal,
    })
      .catch((err) => {
        imessageRuntime = {
          ...imessageRuntime,
          lastError: formatError(err),
        };
        logIMessage.error(`provider exited: ${formatError(err)}`);
      })
      .finally(() => {
        imessageAbort = null;
        imessageTask = null;
        imessageRuntime = {
          ...imessageRuntime,
          running: false,
          lastStopAt: Date.now(),
        };
      });
    imessageTask = task;
  };

  const stopIMessageProvider = async () => {
    if (!imessageAbort && !imessageTask) return;
    imessageAbort?.abort();
    try {
      await imessageTask;
    } catch {
      // ignore
    }
    imessageAbort = null;
    imessageTask = null;
    imessageRuntime = {
      ...imessageRuntime,
      running: false,
      lastStopAt: Date.now(),
    };
  };

  const startProviders = async () => {
    await startWhatsAppProvider();
    await startDiscordProvider();
    await startSlackProvider();
    await startTelegramProvider();
    await startSignalProvider();
    await startIMessageProvider();
  };

  const markWhatsAppLoggedOut = (cleared: boolean) => {
    whatsappRuntime = {
      ...whatsappRuntime,
      running: false,
      connected: false,
      lastError: cleared ? "logged out" : whatsappRuntime.lastError,
    };
  };

  const getRuntimeSnapshot = (): ProviderRuntimeSnapshot => ({
    whatsapp: { ...whatsappRuntime },
    telegram: { ...telegramRuntime },
    discord: { ...discordRuntime },
    slack: { ...slackRuntime },
    signal: { ...signalRuntime },
    imessage: { ...imessageRuntime },
  });

  return {
    getRuntimeSnapshot,
    startProviders,
    startWhatsAppProvider,
    stopWhatsAppProvider,
    startTelegramProvider,
    stopTelegramProvider,
    startDiscordProvider,
    stopDiscordProvider,
    startSlackProvider,
    stopSlackProvider,
    startSignalProvider,
    stopSignalProvider,
    startIMessageProvider,
    stopIMessageProvider,
    markWhatsAppLoggedOut,
  };
}
