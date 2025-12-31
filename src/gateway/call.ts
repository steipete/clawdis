import { randomUUID } from "node:crypto";
import { GatewayClient } from "./client.js";
import { PROTOCOL_VERSION } from "./protocol/index.js";

export type CallGatewayOptions = {
  url?: string;
  token?: string;
  password?: string;
  method: string;
  params?: unknown;
  expectFinal?: boolean;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  platform?: string;
  mode?: string;
  instanceId?: string;
  minProtocol?: number;
  maxProtocol?: number;
};

export async function callGateway<T = unknown>(
  opts: CallGatewayOptions,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    let ignoreClose = false;
    const stop = (err?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(value as T);
    };

    const client = new GatewayClient({
      url: opts.url,
      token: opts.token,
      password: opts.password,
      instanceId: opts.instanceId ?? randomUUID(),
      clientName: opts.clientName ?? "cli",
      clientVersion: opts.clientVersion ?? "dev",
      platform: opts.platform,
      mode: opts.mode ?? "cli",
      minProtocol: opts.minProtocol ?? PROTOCOL_VERSION,
      maxProtocol: opts.maxProtocol ?? PROTOCOL_VERSION,
      onHelloOk: async () => {
        try {
          const result = await client.request<T>(opts.method, opts.params, {
            expectFinal: opts.expectFinal,
          });
          ignoreClose = true;
          stop(undefined, result);
          client.stop();
        } catch (err) {
          ignoreClose = true;
          client.stop();
          stop(err as Error);
        }
      },
      onClose: (code, reason) => {
        if (settled || ignoreClose) return;
        stop(new Error(`gateway closed (${code}): ${reason}`));
      },
    });

    const timer = setTimeout(() => {
      ignoreClose = true;
      client.stop();
      stop(new Error("gateway timeout"));
    }, timeoutMs);

    client.start();
  });
}

export function randomIdempotencyKey() {
  return randomUUID();
}
