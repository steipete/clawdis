import { describe, expect, it } from "vitest";

import { parseClaudeJsonText } from "./claude.js";

describe("claude JSON parsing", () => {
	it("extracts text from single JSON object", () => {
		const out = parseClaudeJsonText('{"text":"hello"}');
		expect(out).toBe("hello");
	});

	it("extracts from newline-delimited JSON", () => {
		const out = parseClaudeJsonText('{"irrelevant":1}\n{"text":"there"}');
		expect(out).toBe("there");
	});

	it("returns undefined on invalid JSON", () => {
		expect(parseClaudeJsonText("not json")).toBeUndefined();
	});
});

