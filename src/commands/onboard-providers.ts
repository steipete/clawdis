import fs from "node:fs/promises";
import path from "node:path";
import type { ClawdisConfig } from "../config/config.js";
import { loginWeb } from "../provider-web.js";
import type { RuntimeEnv } from "../runtime.js";
import { normalizeE164 } from "../utils.js";
import { resolveWebAuthDir } from "../web/session.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { detectBinary } from "./onboard-helpers.js";
import type { ProviderChoice } from "./onboard-types.js";
import { installSignalCli } from "./signal-install.js";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectWhatsAppLinked(): Promise<boolean> {
  const credsPath = path.join(resolveWebAuthDir(), "creds.json");
  return await pathExists(credsPath);
}

async function noteProviderPrimer(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "WhatsApp: links via WhatsApp Web (scan QR), stores creds for future sends.",
      "WhatsApp: dedicated second number recommended; primary number OK (self-chat).",
      "Telegram: Bot API (token from @BotFather), replies via your bot.",
      "Discord: Bot token from Discord Developer Portal; invite bot to your server.",
      "Slack: Bot token + App token (socket mode).",
      "Signal: signal-cli as a linked device; separate number recommended.",
      "iMessage: local imsg CLI; separate Apple ID recommended only on a separate Mac.",
    ].join("\n"),
    "How providers work",
  );
}

async function noteTelegramTokenHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Open Telegram and chat with @BotFather",
      "2) Run /newbot (or /mybots)",
      "3) Copy the token (looks like 123456:ABC...)",
      "Tip: you can also set TELEGRAM_BOT_TOKEN in your env.",
    ].join("\n"),
    "Telegram bot token",
  );
}

async function noteDiscordTokenHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Discord Developer Portal → Applications → New Application",
      "2) Bot → Add Bot → Reset Token → copy token",
      "3) OAuth2 → URL Generator → scope 'bot' → invite to your server",
      "Tip: enable Message Content Intent if you need message text.",
    ].join("\n"),
    "Discord bot token",
  );
}

async function noteSlackTokenHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Slack API → Create App → From scratch",
      "2) Add Socket Mode + enable it to get the app-level token (xapp-...)",
      "3) OAuth & Permissions → install app to workspace (xoxb- bot token)",
      "4) Enable Event Subscriptions (socket) for message events",
      "Tip: set SLACK_BOT_TOKEN + SLACK_APP_TOKEN in your env.",
    ].join("\n"),
    "Slack socket mode tokens",
  );
}

function setWhatsAppAllowFrom(cfg: ClawdisConfig, allowFrom?: string[]) {
  return {
    ...cfg,
    whatsapp: {
      ...cfg.whatsapp,
      allowFrom,
    },
  };
}

async function promptWhatsAppAllowFrom(
  cfg: ClawdisConfig,
  _runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<ClawdisConfig> {
  const existingAllowFrom = cfg.whatsapp?.allowFrom ?? [];
  const existingLabel =
    existingAllowFrom.length > 0 ? existingAllowFrom.join(", ") : "unset";

  await prompter.note(
    [
      "WhatsApp direct chats are gated by `whatsapp.allowFrom`.",
      'Default (unset) = self-chat only; use "*" to allow anyone.',
      `Current: ${existingLabel}`,
    ].join("\n"),
    "WhatsApp allowlist",
  );

  const options =
    existingAllowFrom.length > 0
      ? ([
          { value: "keep", label: "Keep current" },
          { value: "self", label: "Self-chat only (unset)" },
          { value: "list", label: "Specific numbers (recommended)" },
          { value: "any", label: "Anyone (*)" },
        ] as const)
      : ([
          { value: "self", label: "Self-chat only (default)" },
          { value: "list", label: "Specific numbers (recommended)" },
          { value: "any", label: "Anyone (*)" },
        ] as const);

  const mode = (await prompter.select({
    message: "Who can trigger the bot via WhatsApp?",
    options: options.map((opt) => ({ value: opt.value, label: opt.label })),
  })) as (typeof options)[number]["value"];

  if (mode === "keep") return cfg;
  if (mode === "self") return setWhatsAppAllowFrom(cfg, undefined);
  if (mode === "any") return setWhatsAppAllowFrom(cfg, ["*"]);

  const allowRaw = await prompter.text({
    message: "Allowed sender numbers (comma-separated, E.164)",
    placeholder: "+15555550123, +447700900123",
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) return "Required";
      const parts = raw
        .split(/[\n,;]+/g)
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length === 0) return "Required";
      for (const part of parts) {
        if (part === "*") continue;
        const normalized = normalizeE164(part);
        if (!normalized) return `Invalid number: ${part}`;
      }
      return undefined;
    },
  });

  const parts = String(allowRaw)
    .split(/[\n,;]+/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const normalized = parts.map((part) =>
    part === "*" ? "*" : normalizeE164(part),
  );
  const unique = [...new Set(normalized.filter(Boolean))];
  return setWhatsAppAllowFrom(cfg, unique);
}

export async function setupProviders(
  cfg: ClawdisConfig,
  runtime: RuntimeEnv,
  prompter: WizardPrompter,
  options?: { allowDisable?: boolean; allowSignalInstall?: boolean },
): Promise<ClawdisConfig> {
  const whatsappLinked = await detectWhatsAppLinked();
  const telegramEnv = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim());
  const discordEnv = Boolean(process.env.DISCORD_BOT_TOKEN?.trim());
  const slackBotEnv = Boolean(process.env.SLACK_BOT_TOKEN?.trim());
  const slackAppEnv = Boolean(process.env.SLACK_APP_TOKEN?.trim());
  const telegramConfigured = Boolean(
    telegramEnv || cfg.telegram?.botToken || cfg.telegram?.tokenFile,
  );
  const discordConfigured = Boolean(discordEnv || cfg.discord?.token);
  const slackConfigured = Boolean(
    (slackBotEnv && slackAppEnv) ||
      (cfg.slack?.botToken && cfg.slack?.appToken),
  );
  const signalConfigured = Boolean(
    cfg.signal?.account || cfg.signal?.httpUrl || cfg.signal?.httpPort,
  );
  const signalCliPath = cfg.signal?.cliPath ?? "signal-cli";
  const signalCliDetected = await detectBinary(signalCliPath);
  const imessageConfigured = Boolean(
    cfg.imessage?.cliPath || cfg.imessage?.dbPath || cfg.imessage?.allowFrom,
  );
  const imessageCliPath = cfg.imessage?.cliPath ?? "imsg";
  const imessageCliDetected = await detectBinary(imessageCliPath);

  await prompter.note(
    [
      `WhatsApp: ${whatsappLinked ? "linked" : "not linked"}`,
      `Telegram: ${telegramConfigured ? "configured" : "needs token"}`,
      `Discord: ${discordConfigured ? "configured" : "needs token"}`,
      `Slack: ${slackConfigured ? "configured" : "needs tokens"}`,
      `Signal: ${signalConfigured ? "configured" : "needs setup"}`,
      `iMessage: ${imessageConfigured ? "configured" : "needs setup"}`,
      `signal-cli: ${signalCliDetected ? "found" : "missing"} (${signalCliPath})`,
      `imsg: ${imessageCliDetected ? "found" : "missing"} (${imessageCliPath})`,
    ].join("\n"),
    "Provider status",
  );

  const shouldConfigure = await prompter.confirm({
    message: "Configure chat providers now?",
    initialValue: true,
  });
  if (!shouldConfigure) return cfg;

  await noteProviderPrimer(prompter);

  const selection = (await prompter.multiselect({
    message: "Select providers",
    options: [
      {
        value: "whatsapp",
        label: "WhatsApp (QR link)",
        hint: whatsappLinked ? "linked" : "not linked",
      },
      {
        value: "telegram",
        label: "Telegram (Bot API)",
        hint: telegramConfigured ? "configured" : "needs token",
      },
      {
        value: "discord",
        label: "Discord (Bot API)",
        hint: discordConfigured ? "configured" : "needs token",
      },
      {
        value: "slack",
        label: "Slack (Socket Mode)",
        hint: slackConfigured ? "configured" : "needs tokens",
      },
      {
        value: "signal",
        label: "Signal (signal-cli)",
        hint: signalCliDetected ? "signal-cli found" : "signal-cli missing",
      },
      {
        value: "imessage",
        label: "iMessage (imsg)",
        hint: imessageCliDetected ? "imsg found" : "imsg missing",
      },
    ],
  })) as ProviderChoice[];

  let next = cfg;

  if (selection.includes("whatsapp")) {
    if (!whatsappLinked) {
      await prompter.note(
        [
          "Scan the QR with WhatsApp on your phone.",
          "Credentials are stored under ~/.clawdis/credentials/ for future runs.",
        ].join("\n"),
        "WhatsApp linking",
      );
    }
    const wantsLink = await prompter.confirm({
      message: whatsappLinked
        ? "WhatsApp already linked. Re-link now?"
        : "Link WhatsApp now (QR)?",
      initialValue: !whatsappLinked,
    });
    if (wantsLink) {
      try {
        await loginWeb(false, "web");
      } catch (err) {
        runtime.error(`WhatsApp login failed: ${String(err)}`);
      }
    } else if (!whatsappLinked) {
      await prompter.note(
        "Run `clawdis login` later to link WhatsApp.",
        "WhatsApp",
      );
    }

    next = await promptWhatsAppAllowFrom(next, runtime, prompter);
  }

  if (selection.includes("telegram")) {
    let token: string | null = null;
    if (!telegramConfigured) {
      await noteTelegramTokenHelp(prompter);
    }
    if (telegramEnv && !cfg.telegram?.botToken) {
      const keepEnv = await prompter.confirm({
        message: "TELEGRAM_BOT_TOKEN detected. Use env var?",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          telegram: {
            ...next.telegram,
            enabled: true,
          },
        };
      } else {
        token = String(
          await prompter.text({
            message: "Enter Telegram bot token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else if (cfg.telegram?.botToken) {
      const keep = await prompter.confirm({
        message: "Telegram token already configured. Keep it?",
        initialValue: true,
      });
      if (!keep) {
        token = String(
          await prompter.text({
            message: "Enter Telegram bot token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else {
      token = String(
        await prompter.text({
          message: "Enter Telegram bot token",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

    if (token) {
      next = {
        ...next,
        telegram: {
          ...next.telegram,
          enabled: true,
          botToken: token,
        },
      };
    }
  }

  if (selection.includes("discord")) {
    let token: string | null = null;
    if (!discordConfigured) {
      await noteDiscordTokenHelp(prompter);
    }
    if (discordEnv && !cfg.discord?.token) {
      const keepEnv = await prompter.confirm({
        message: "DISCORD_BOT_TOKEN detected. Use env var?",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          discord: {
            ...next.discord,
            enabled: true,
          },
        };
      } else {
        token = String(
          await prompter.text({
            message: "Enter Discord bot token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else if (cfg.discord?.token) {
      const keep = await prompter.confirm({
        message: "Discord token already configured. Keep it?",
        initialValue: true,
      });
      if (!keep) {
        token = String(
          await prompter.text({
            message: "Enter Discord bot token",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else {
      token = String(
        await prompter.text({
          message: "Enter Discord bot token",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

    if (token) {
      next = {
        ...next,
        discord: {
          ...next.discord,
          enabled: true,
          token,
        },
      };
    }
  }

  if (selection.includes("slack")) {
    let botToken: string | null = null;
    let appToken: string | null = null;
    if (!slackConfigured) {
      await noteSlackTokenHelp(prompter);
    }
    if (
      slackBotEnv &&
      slackAppEnv &&
      (!cfg.slack?.botToken || !cfg.slack?.appToken)
    ) {
      const keepEnv = await prompter.confirm({
        message: "SLACK_BOT_TOKEN + SLACK_APP_TOKEN detected. Use env vars?",
        initialValue: true,
      });
      if (keepEnv) {
        next = {
          ...next,
          slack: {
            ...next.slack,
            enabled: true,
          },
        };
      } else {
        botToken = String(
          await prompter.text({
            message: "Enter Slack bot token (xoxb-...)",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        appToken = String(
          await prompter.text({
            message: "Enter Slack app token (xapp-...)",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else if (cfg.slack?.botToken && cfg.slack?.appToken) {
      const keep = await prompter.confirm({
        message: "Slack tokens already configured. Keep them?",
        initialValue: true,
      });
      if (!keep) {
        botToken = String(
          await prompter.text({
            message: "Enter Slack bot token (xoxb-...)",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
        appToken = String(
          await prompter.text({
            message: "Enter Slack app token (xapp-...)",
            validate: (value) => (value?.trim() ? undefined : "Required"),
          }),
        ).trim();
      }
    } else {
      botToken = String(
        await prompter.text({
          message: "Enter Slack bot token (xoxb-...)",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
      appToken = String(
        await prompter.text({
          message: "Enter Slack app token (xapp-...)",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

    if (botToken && appToken) {
      next = {
        ...next,
        slack: {
          ...next.slack,
          enabled: true,
          botToken,
          appToken,
        },
      };
    }
  }

  if (selection.includes("signal")) {
    let resolvedCliPath = signalCliPath;
    let cliDetected = signalCliDetected;
    if (options?.allowSignalInstall) {
      const wantsInstall = await prompter.confirm({
        message: cliDetected
          ? "signal-cli detected. Reinstall/update now?"
          : "signal-cli not found. Install now?",
        initialValue: !cliDetected,
      });
      if (wantsInstall) {
        try {
          const result = await installSignalCli(runtime);
          if (result.ok && result.cliPath) {
            cliDetected = true;
            resolvedCliPath = result.cliPath;
            await prompter.note(
              `Installed signal-cli at ${result.cliPath}`,
              "Signal",
            );
          } else if (!result.ok) {
            await prompter.note(
              result.error ?? "signal-cli install failed.",
              "Signal",
            );
          }
        } catch (err) {
          await prompter.note(
            `signal-cli install failed: ${String(err)}`,
            "Signal",
          );
        }
      }
    }

    if (!cliDetected) {
      await prompter.note(
        "signal-cli not found. Install it, then rerun this step or set signal.cliPath.",
        "Signal",
      );
    }

    let account = cfg.signal?.account ?? "";
    if (account) {
      const keep = await prompter.confirm({
        message: `Signal account set (${account}). Keep it?`,
        initialValue: true,
      });
      if (!keep) account = "";
    }

    if (!account) {
      account = String(
        await prompter.text({
          message: "Signal bot number (E.164)",
          validate: (value) => (value?.trim() ? undefined : "Required"),
        }),
      ).trim();
    }

    if (account) {
      next = {
        ...next,
        signal: {
          ...next.signal,
          enabled: true,
          account,
          cliPath: resolvedCliPath ?? "signal-cli",
        },
      };
    }

    await prompter.note(
      [
        'Link device with: signal-cli link -n "Clawdis"',
        "Scan QR in Signal → Linked Devices",
        "Then run: clawdis gateway call providers.status --params '{\"probe\":true}'",
      ].join("\n"),
      "Signal next steps",
    );
  }

  if (selection.includes("imessage")) {
    let resolvedCliPath = imessageCliPath;
    if (!imessageCliDetected) {
      const entered = await prompter.text({
        message: "imsg CLI path",
        initialValue: resolvedCliPath,
        validate: (value) => (value?.trim() ? undefined : "Required"),
      });
      resolvedCliPath = String(entered).trim();
      if (!resolvedCliPath) {
        await prompter.note(
          "imsg CLI path required to enable iMessage.",
          "iMessage",
        );
      }
    }

    if (resolvedCliPath) {
      next = {
        ...next,
        imessage: {
          ...next.imessage,
          enabled: true,
          cliPath: resolvedCliPath,
        },
      };
    }

    await prompter.note(
      [
        "Ensure Clawdis has Full Disk Access to Messages DB.",
        "Grant Automation permission for Messages when prompted.",
        "List chats with: imsg chats --limit 20",
      ].join("\n"),
      "iMessage next steps",
    );
  }

  if (options?.allowDisable) {
    if (!selection.includes("telegram") && telegramConfigured) {
      const disable = await prompter.confirm({
        message: "Disable Telegram provider?",
        initialValue: false,
      });
      if (disable) {
        next = {
          ...next,
          telegram: { ...next.telegram, enabled: false },
        };
      }
    }

    if (!selection.includes("discord") && discordConfigured) {
      const disable = await prompter.confirm({
        message: "Disable Discord provider?",
        initialValue: false,
      });
      if (disable) {
        next = {
          ...next,
          discord: { ...next.discord, enabled: false },
        };
      }
    }

    if (!selection.includes("slack") && slackConfigured) {
      const disable = await prompter.confirm({
        message: "Disable Slack provider?",
        initialValue: false,
      });
      if (disable) {
        next = {
          ...next,
          slack: { ...next.slack, enabled: false },
        };
      }
    }

    if (!selection.includes("signal") && signalConfigured) {
      const disable = await prompter.confirm({
        message: "Disable Signal provider?",
        initialValue: false,
      });
      if (disable) {
        next = {
          ...next,
          signal: { ...next.signal, enabled: false },
        };
      }
    }

    if (!selection.includes("imessage") && imessageConfigured) {
      const disable = await prompter.confirm({
        message: "Disable iMessage provider?",
        initialValue: false,
      });
      if (disable) {
        next = {
          ...next,
          imessage: { ...next.imessage, enabled: false },
        };
      }
    }
  }

  return next;
}
