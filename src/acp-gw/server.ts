#!/usr/bin/env node
/**
 * ACP-GW Server Entry Point
 *
 * Gateway-backed ACP server. Speaks stdio JSON-RPC to IDE clients,
 * delegates all agent work to a running Clawdis Gateway via WebSocket.
 *
 * Usage:
 *   clawd-acp-gw [--gateway-url <url>] [--gateway-token <token>] [--verbose]
 */

import { Readable, Writable } from "node:stream";

import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

import { GatewayClient } from "../gateway/client.js";
import { AcpGwAgent } from "./translator.js";
import type { AcpGwOptions } from "./types.js";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

/**
 * Start the ACP-GW server.
 */
export function serveAcpGw(opts: AcpGwOptions = {}): void {
  const log = opts.verbose
    ? (msg: string) => process.stderr.write(`[acp-gw] ${msg}\n`)
    : () => {};

  const gatewayUrl = opts.gatewayUrl ?? DEFAULT_GATEWAY_URL;
  log(`connecting to gateway: ${gatewayUrl}`);

  // Create Gateway client
  const gateway = new GatewayClient({
    url: gatewayUrl,
    token: opts.gatewayToken,
    password: opts.gatewayPassword,
    clientName: "acp-gw",
    clientVersion: "1.0.0",
    mode: "acp",
    onHelloOk: (hello) => {
      log(`gateway connected: protocol=${hello.protocol}`);
    },
    onClose: (code, reason) => {
      log(`gateway disconnected: ${code} ${reason}`);
      agent?.handleGatewayDisconnect(`${code}: ${reason}`);
    },
    onEvent: (evt) => {
      // Forward events to the agent for processing
      void agent?.handleGatewayEvent(evt);
    },
  });

  // Create Web Streams from Node streams for the ACP SDK
  const input = Writable.toWeb(process.stdout);
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(input, output);

  // Create the agent (will be set after connection is established)
  let agent: AcpGwAgent | null = null;

  // Create the ACP connection
  new AgentSideConnection((conn) => {
    agent = new AcpGwAgent(conn, gateway, opts);
    agent.start();
    return agent;
  }, stream);

  // Start the Gateway client
  gateway.start();

  log("acp-gw server ready");
}

/**
 * Parse CLI arguments.
 */
function parseArgs(args: string[]): AcpGwOptions {
  const opts: AcpGwOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === "--gateway-url" || arg === "--url") && args[i + 1]) {
      opts.gatewayUrl = args[++i];
    } else if ((arg === "--gateway-token" || arg === "--token") && args[i + 1]) {
      opts.gatewayToken = args[++i];
    } else if (
      (arg === "--gateway-password" || arg === "--password") &&
      args[i + 1]
    ) {
      opts.gatewayPassword = args[++i];
    } else if (arg === "--verbose" || arg === "-v") {
      opts.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: clawd-acp-gw [options]

Gateway-backed ACP server for IDE integration.

Options:
  --gateway-url <url>      Gateway WebSocket URL (default: ws://127.0.0.1:18789)
  --gateway-token <token>  Gateway auth token
  --gateway-password <pw>  Gateway auth password
  --verbose, -v            Enable verbose logging to stderr
  --help, -h               Show this help message

Examples:
  clawd-acp-gw
  clawd-acp-gw --gateway-url wss://remote:18789 --gateway-token secret
  clawd-acp-gw --verbose
`);
      process.exit(0);
    }
  }

  return opts;
}

/**
 * CLI entry point.
 */
function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  serveAcpGw(opts);
}

// Run if executed directly
main();
