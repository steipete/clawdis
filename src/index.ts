#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import {
  autoReplyIfConfigured,
  getReplyFromConfig,
} from "./auto-reply/reply.js";
import { applyTemplate } from "./auto-reply/templating.js";
import { createDefaultDeps, monitorTwilio } from "./cli/deps.js";
import { promptYesNo } from "./cli/prompt.js";
import { waitForever } from "./cli/wait.js";
import { loadConfig } from "./config/config.js";
import {
  deriveSessionKey,
  loadSessionStore,
  resolveStorePath,
  saveSessionStore,
} from "./config/sessions.js";
import { readEnv } from "./env.js";
import { ensureBinary } from "./infra/binaries.js";
import {
  describePortOwner,
  ensurePortAvailable,
  handlePortError,
  PortInUseError,
} from "./infra/ports.js";
import {
  ensureFunnel,
  ensureGoInstalled,
  ensureTailscaledInstalled,
  getTailnetHostname,
} from "./infra/tailscale.js";
import { runCommandWithTimeout, runExec } from "./process/exec.js";
import { monitorWebProvider } from "./provider-web.js";
import { defaultRuntime } from "./runtime.js";
import { createClient } from "./twilio/client.js";
import {
  formatMessageLine,
  listRecentMessages,
  sortByDateDesc,
  uniqueBySid,
} from "./twilio/messages.js";
import { sendMessage, waitForFinalStatus } from "./twilio/send.js";
import { findWhatsappSenderSid } from "./twilio/senders.js";
import { sendTypingIndicator } from "./twilio/typing.js";
import {
  findIncomingNumberSid as findIncomingNumberSidImpl,
  findMessagingServiceSid as findMessagingServiceSidImpl,
  setMessagingServiceWebhook as setMessagingServiceWebhookImpl,
  updateWebhook as updateWebhookImpl,
} from "./twilio/update-webhook.js";
import { formatTwilioError, logTwilioSendError } from "./twilio/utils.js";
import { startWebhook as startWebhookImpl } from "./twilio/webhook.js";
import { assertProvider, normalizeE164, toWhatsappJid } from "./utils.js";

dotenv.config({ quiet: true });

import { buildProgram } from "./cli/program.js";

const program = buildProgram();

// Keep aliases for backwards compatibility with prior index exports.
const startWebhook = startWebhookImpl;
const setMessagingServiceWebhook = setMessagingServiceWebhookImpl;
const updateWebhook = updateWebhookImpl;

export {
  assertProvider,
  autoReplyIfConfigured,
  applyTemplate,
  createClient,
  defaultRuntime,
  deriveSessionKey,
  describePortOwner,
  ensureBinary,
  ensureFunnel,
  ensureGoInstalled,
  ensurePortAvailable,
  ensureTailscaledInstalled,
  findIncomingNumberSidImpl as findIncomingNumberSid,
  findMessagingServiceSidImpl as findMessagingServiceSid,
  findWhatsappSenderSid,
  formatMessageLine,
  formatTwilioError,
  getReplyFromConfig,
  getTailnetHostname,
  handlePortError,
  logTwilioSendError,
  listRecentMessages,
  loadConfig,
  loadSessionStore,
  monitorTwilio,
  monitorWebProvider,
  normalizeE164,
  PortInUseError,
  promptYesNo,
  createDefaultDeps,
  readEnv,
  resolveStorePath,
  runCommandWithTimeout,
  runExec,
  saveSessionStore,
  sendMessage,
  sendTypingIndicator,
  setMessagingServiceWebhook,
  sortByDateDesc,
  startWebhook,
  updateWebhook,
  uniqueBySid,
  waitForFinalStatus,
  waitForever,
  toWhatsappJid,
  program,
};

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  // Global error handlers to prevent silent crashes from unhandled rejections/exceptions.
  // These log the error and exit gracefully instead of crashing without trace.
  process.on("unhandledRejection", (reason, _promise) => {
    console.error(
      "[warelay] Unhandled promise rejection:",
      reason instanceof Error ? (reason.stack ?? reason.message) : reason,
    );
    process.exit(1);
  });

  process.on("uncaughtException", (error) => {
    console.error(
      "[warelay] Uncaught exception:",
      error.stack ?? error.message,
    );
    process.exit(1);
  });

  program.parseAsync(process.argv);
}
