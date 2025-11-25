import { describe, expect, it } from "vitest";

import { deriveSessionKey } from "./sessions.js";

describe("sessions", () => {
	it("returns normalized per-sender key", () => {
		expect(
			deriveSessionKey("per-sender", { From: "whatsapp:+1555" }),
		).toBe("+1555");
	});

	it("falls back to unknown when sender missing", () => {
		expect(deriveSessionKey("per-sender", {})).toBe("unknown");
	});

	it("global scope returns global", () => {
		expect(deriveSessionKey("global", { From: "+1" })).toBe("global");
	});
});

