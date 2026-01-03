import { describe, expect, it } from "vitest";

import { deepMergeConfig } from "./server.js";

describe("deepMergeConfig", () => {
  it("merges shallow objects, target values override base", () => {
    const base = { a: 1, b: 2 };
    const target = { b: 3, c: 4 };
    const result = deepMergeConfig(base, target);

    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("preserves base fields not in target", () => {
    const base = { a: 1, b: 2, c: 3 };
    const target = { b: 10 };
    const result = deepMergeConfig(base, target);

    expect(result).toEqual({ a: 1, b: 10, c: 3 });
  });

  it("deep merges nested objects", () => {
    const base = {
      identity: { name: "Clawd", theme: "lobster" },
      agent: { model: "gpt-4", workspace: "/workspace" },
    };
    const target = {
      identity: { name: "NewName" },
      agent: { model: "claude-opus" },
    };
    const result = deepMergeConfig(base, target);

    expect(result).toEqual({
      identity: { name: "NewName", theme: "lobster" },
      agent: { model: "claude-opus", workspace: "/workspace" },
    });
  });

  it("replaces arrays entirely", () => {
    const base = { arr: [1, 2, 3] };
    const target = { arr: [4, 5] };
    const result = deepMergeConfig(base, target);

    expect(result).toEqual({ arr: [4, 5] });
  });

  it("handles null values in target", () => {
    const base = { a: { nested: "value" }, b: 2 };
    const target = { a: null };
    const result = deepMergeConfig(base, target);

    expect(result).toEqual({ a: null, b: 2 });
  });

  it("handles undefined in base (adds target keys)", () => {
    const base = { a: 1, b: undefined as unknown };
    const target = { c: 3 };
    const result = deepMergeConfig(base, target);

    expect(result).toEqual({ a: 1, b: undefined, c: 3 });
  });

  it("handles empty objects", () => {
    const base = {};
    const target = { a: 1, b: { c: 2 } };
    const result = deepMergeConfig(base, target);

    expect(result).toEqual({ a: 1, b: { c: 2 } });
  });

  it("simulates config.set partial update preserving existing fields", () => {
    const existingConfig = {
      identity: { name: "Clawd", theme: "space lobster", emoji: "🦞" },
      agent: { model: "gpt-4", workspace: "/home/user/clawdis" },
      gateway: { port: 18789 },
      telegram: { enabled: true, botToken: "123:ABC" },
    };

    const partialUpdate = {
      identity: { name: "NewName" },
    };

    const merged = deepMergeConfig(existingConfig, partialUpdate);

    // The partial update changed identity.name but all other fields preserved
    expect(merged).toEqual({
      identity: { name: "NewName", theme: "space lobster", emoji: "🦞" },
      agent: { model: "gpt-4", workspace: "/home/user/clawdis" },
      gateway: { port: 18789 },
      telegram: { enabled: true, botToken: "123:ABC" },
    });

    // Verify that fields not in the update are still present
    expect((merged.agent as Record<string, unknown>).model).toBe("gpt-4");
    expect((merged.gateway as Record<string, unknown>).port).toBe(18789);
    expect((merged.telegram as Record<string, unknown>).enabled).toBe(true);
  });
});
