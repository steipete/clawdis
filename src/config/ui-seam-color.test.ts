import { describe, expect, it } from "vitest";

import { validateConfigObject } from "./config.js";

describe("ui.seamColor", () => {
  it("accepts hex colors", () => {
    const res = validateConfigObject({ ui: { seamColor: "#FF4500" } });
    expect(res.ok).toBe(true);
  });

  it("rejects non-hex colors", () => {
    const res = validateConfigObject({ ui: { seamColor: "lobster" } });
    expect(res.ok).toBe(false);
  });

  it("rejects invalid hex length", () => {
    const res = validateConfigObject({ ui: { seamColor: "#FF4500FF" } });
    expect(res.ok).toBe(false);
  });
});
