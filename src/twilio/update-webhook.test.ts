import { describe, expect, it, beforeEach, afterEach } from "vitest";

import {
	findIncomingNumberSid,
	findMessagingServiceSid,
	setMessagingServiceWebhook,
} from "./update-webhook.js";

const envBackup = { ...process.env } as Record<string, string | undefined>;

describe("update-webhook helpers", () => {
	beforeEach(() => {
		process.env.TWILIO_ACCOUNT_SID = "AC";
		process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+1555";
	});

	afterEach(() => {
		Object.entries(envBackup).forEach(([k, v]) => {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		});
	});

	it("findIncomingNumberSid returns first match", async () => {
		const client = {
			incomingPhoneNumbers: {
				list: async () => [{ sid: "PN1", phoneNumber: "+1555" }],
			},
		} as never;
		const sid = await findIncomingNumberSid(client);
		expect(sid).toBe("PN1");
	});

	it("findMessagingServiceSid reads messagingServiceSid", async () => {
		const client = {
			incomingPhoneNumbers: {
				list: async () => [{ messagingServiceSid: "MG1" }],
			},
		} as never;
		const sid = await findMessagingServiceSid(client);
		expect(sid).toBe("MG1");
	});

	it("setMessagingServiceWebhook updates via service helper", async () => {
		const update = async (_: unknown) => {};
		const fetch = async () => ({ inboundRequestUrl: "https://cb" });
		const client = {
			messaging: {
				v1: {
					services: () => ({ update, fetch }),
				},
			},
			incomingPhoneNumbers: {
				list: async () => [{ messagingServiceSid: "MG1" }],
			},
		} as never;
		const ok = await setMessagingServiceWebhook(client, "https://cb", "POST");
		expect(ok).toBe(true);
	});
});
