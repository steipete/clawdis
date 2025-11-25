import { describe, expect, it, vi } from "vitest";

import { waitForFinalStatus } from "./send.js";

describe("twilio send helpers", () => {
	it("waitForFinalStatus resolves on delivered", async () => {
		const fetch = vi
			.fn()
			.mockResolvedValueOnce({ status: "queued" })
			.mockResolvedValueOnce({ status: "delivered" });
		const client = { messages: vi.fn(() => ({ fetch })) } as never;
		await waitForFinalStatus(client, "SM1", 2, 0.01, console as never);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("waitForFinalStatus exits on failure", async () => {
		const fetch = vi.fn().mockResolvedValue({ status: "failed", errorMessage: "boom" });
		const client = { messages: vi.fn(() => ({ fetch })) } as never;
		const runtime = { log: console.log, error: () => {}, exit: vi.fn(() => { throw new Error("exit"); }) } as never;
		await expect(waitForFinalStatus(client, "SM1", 1, 0.01, runtime)).rejects.toBeInstanceOf(Error);
	});
});

