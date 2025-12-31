import { completeSimple, getModel } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";

const ZAI_KEY = process.env.ZAI_API_KEY ?? process.env.Z_AI_API_KEY ?? "";
const LIVE = process.env.ZAI_LIVE_TEST === "1" || process.env.LIVE === "1";

const describeLive = LIVE && ZAI_KEY ? describe : describe.skip;

describeLive("zai live", () => {
  it(
    "returns assistant text",
    async () => {
    const model = getModel("zai", "glm-4.7");
    const res = await completeSimple(
      model,
      {
        messages: [
          {
            role: "user",
            content: "Reply with the word ok.",
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: ZAI_KEY, maxTokens: 64 },
    );
    const text = res.content
      .filter((block) => block.type === "text")
      .map((block) => block.text.trim())
      .join(" ");
    expect(text.length).toBeGreaterThan(0);
    },
    20000,
  );
});
