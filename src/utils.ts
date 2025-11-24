import fs from "node:fs";
import os from "node:os";

export async function ensureDir(dir: string) {
	await fs.promises.mkdir(dir, { recursive: true });
}

export type Provider = "twilio" | "web";

export function assertProvider(input: string): asserts input is Provider {
	if (input !== "twilio" && input !== "web") {
		throw new Error("Provider must be 'twilio' or 'web'");
	}
}

export function normalizePath(p: string): string {
	if (!p.startsWith("/")) return `/${p}`;
	return p;
}

export function withWhatsAppPrefix(number: string): string {
	return number.startsWith("whatsapp:") ? number : `whatsapp:${number}`;
}

export function normalizeE164(number: string): string {
	const withoutPrefix = number.replace(/^whatsapp:/, "").trim();
	const digits = withoutPrefix.replace(/[^\d+]/g, "");
	if (digits.startsWith("+")) return `+${digits.slice(1)}`;
	return `+${digits}`;
}

export function toWhatsappJid(number: string): string {
	const e164 = normalizeE164(number);
	const digits = e164.replace(/\D/g, "");
	return `${digits}@s.whatsapp.net`;
}

export function jidToE164(jid: string): string | null {
	// Convert a WhatsApp JID (with optional device suffix, e.g. 1234:1@s.whatsapp.net) back to +1234.
	const match = jid.match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/);
	if (!match) return null;
	const digits = match[1];
	return `+${digits}`;
}

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const CONFIG_DIR = `${os.homedir()}/.warelay`;
