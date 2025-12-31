import { describe, expect, it } from "vitest";

import { normalizeZaiEnv } from "./env.js";

describe("normalizeZaiEnv", () => {
  it("copies Z_AI_API_KEY to ZAI_API_KEY when missing", () => {
    const prevZai = process.env.ZAI_API_KEY;
    const prevZAi = process.env.Z_AI_API_KEY;
    process.env.ZAI_API_KEY = "";
    process.env.Z_AI_API_KEY = "zai-legacy";

    normalizeZaiEnv();

    expect(process.env.ZAI_API_KEY).toBe("zai-legacy");

    if (prevZai === undefined) delete process.env.ZAI_API_KEY;
    else process.env.ZAI_API_KEY = prevZai;
    if (prevZAi === undefined) delete process.env.Z_AI_API_KEY;
    else process.env.Z_AI_API_KEY = prevZAi;
  });

  it("does not override existing ZAI_API_KEY", () => {
    const prevZai = process.env.ZAI_API_KEY;
    const prevZAi = process.env.Z_AI_API_KEY;
    process.env.ZAI_API_KEY = "zai-current";
    process.env.Z_AI_API_KEY = "zai-legacy";

    normalizeZaiEnv();

    expect(process.env.ZAI_API_KEY).toBe("zai-current");

    if (prevZai === undefined) delete process.env.ZAI_API_KEY;
    else process.env.ZAI_API_KEY = prevZai;
    if (prevZAi === undefined) delete process.env.Z_AI_API_KEY;
    else process.env.Z_AI_API_KEY = prevZAi;
  });
});
