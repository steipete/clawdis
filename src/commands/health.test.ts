import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthSummary } from "./health.js";
import { healthCommand } from "./health.js";

const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

const callGatewayMock = vi.fn();
vi.mock("../gateway/call.js", () => ({
  callGateway: (...args: unknown[]) => callGatewayMock(...args),
}));

describe("healthCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("outputs JSON from gateway", async () => {
    const snapshot: HealthSummary = {
      ts: Date.now(),
      durationMs: 5,
      web: {
        linked: true,
        authAgeMs: 5000,
        connect: { ok: true, elapsedMs: 10 },
      },
      telegram: { configured: true, probe: { ok: true, elapsedMs: 1 } },
      discord: { configured: false },
      slack: { configured: false },
      heartbeatSeconds: 60,
      sessions: {
        path: "/tmp/sessions.json",
        count: 1,
        recent: [{ key: "+1555", updatedAt: Date.now(), age: 0 }],
      },
    };
    callGatewayMock.mockResolvedValueOnce(snapshot);

    await healthCommand({ json: true, timeoutMs: 5000 }, runtime as never);

    expect(runtime.exit).not.toHaveBeenCalled();
    const logged = runtime.log.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(logged) as HealthSummary;
    expect(parsed.web.linked).toBe(true);
    expect(parsed.telegram.configured).toBe(true);
    expect(parsed.sessions.count).toBe(1);
  });

  it("prints text summary when not json", async () => {
    callGatewayMock.mockResolvedValueOnce({
      ts: Date.now(),
      durationMs: 5,
      web: { linked: false, authAgeMs: null },
      telegram: { configured: false },
      discord: { configured: false },
      slack: { configured: false },
      heartbeatSeconds: 60,
      sessions: { path: "/tmp/sessions.json", count: 0, recent: [] },
    } satisfies HealthSummary);

    await healthCommand({ json: false }, runtime as never);

    expect(runtime.exit).not.toHaveBeenCalled();
    expect(runtime.log).toHaveBeenCalled();
  });
});
