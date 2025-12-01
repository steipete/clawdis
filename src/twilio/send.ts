import { readEnv } from "../env.js";
import { logInfo } from "../logger.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { sleep, withWhatsAppPrefix } from "../utils.js";
import { createClient } from "./client.js";
import { logTwilioSendError } from "./utils.js";

const successTerminalStatuses = new Set(["delivered", "read"]);
const failureTerminalStatuses = new Set(["failed", "undelivered", "canceled"]);

// Twilio WhatsApp has a 1600 character limit per message
const TWILIO_MAX_CHARS = 1600;

// Split long messages into chunks, preferring to break at paragraph/sentence boundaries
export function splitMessage(text: string, maxChars = TWILIO_MAX_CHARS): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point within the limit
    let breakPoint = maxChars;
    const searchArea = remaining.slice(0, maxChars);

    // Try to break at double newline (paragraph)
    const paragraphBreak = searchArea.lastIndexOf("\n\n");
    if (paragraphBreak > maxChars * 0.5) {
      breakPoint = paragraphBreak + 2;
    } else {
      // Try to break at single newline
      const lineBreak = searchArea.lastIndexOf("\n");
      if (lineBreak > maxChars * 0.5) {
        breakPoint = lineBreak + 1;
      } else {
        // Try to break at sentence end
        const sentenceEnd = Math.max(
          searchArea.lastIndexOf(". "),
          searchArea.lastIndexOf("! "),
          searchArea.lastIndexOf("? "),
        );
        if (sentenceEnd > maxChars * 0.5) {
          breakPoint = sentenceEnd + 2;
        } else {
          // Try to break at word boundary
          const wordBreak = searchArea.lastIndexOf(" ");
          if (wordBreak > maxChars * 0.5) {
            breakPoint = wordBreak + 1;
          }
          // Otherwise just hard break at maxChars
        }
      }
    }

    chunks.push(remaining.slice(0, breakPoint).trimEnd());
    remaining = remaining.slice(breakPoint).trimStart();
  }

  return chunks;
}

// Send outbound WhatsApp message; exit non-zero on API failure.
// Automatically splits long messages into multiple chunks.
export async function sendMessage(
  to: string,
  body: string,
  opts?: { mediaUrl?: string },
  runtime: RuntimeEnv = defaultRuntime,
) {
  const env = readEnv(runtime);
  const client = createClient(env);
  const from = withWhatsAppPrefix(env.whatsappFrom);
  const toNumber = withWhatsAppPrefix(to);

  // Split message if too long for Twilio
  const chunks = splitMessage(body);
  const totalChunks = chunks.length;

  if (totalChunks > 1) {
    logInfo(
      `📨 Message too long (${body.length} chars), splitting into ${totalChunks} parts`,
      runtime,
    );
  }

  let lastSid: string | undefined;

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      // Only attach media to the first message
      const mediaUrl = i === 0 && opts?.mediaUrl ? [opts.mediaUrl] : undefined;

      const message = await client.messages.create({
        from,
        to: toNumber,
        body: totalChunks > 1 ? `[${i + 1}/${totalChunks}] ${chunk}` : chunk,
        mediaUrl,
      });

      lastSid = message.sid;
      logInfo(
        `✅ Request accepted. Message SID: ${message.sid} -> ${toNumber}${totalChunks > 1 ? ` (part ${i + 1}/${totalChunks})` : ""}`,
        runtime,
      );

      // Small delay between chunks to maintain order
      if (i < chunks.length - 1) {
        await sleep(500);
      }
    }

    return { client, sid: lastSid! };
  } catch (err) {
    logTwilioSendError(err, toNumber, runtime);
  }
}

// Poll message status until delivered/failed or timeout.
export async function waitForFinalStatus(
  client: ReturnType<typeof createClient>,
  sid: string,
  timeoutSeconds: number,
  pollSeconds: number,
  runtime: RuntimeEnv = defaultRuntime,
) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const m = await client.messages(sid).fetch();
    const status = m.status ?? "unknown";
    if (successTerminalStatuses.has(status)) {
      logInfo(`✅ Delivered (status: ${status})`, runtime);
      return;
    }
    if (failureTerminalStatuses.has(status)) {
      runtime.error(
        `❌ Delivery failed (status: ${status}${m.errorCode ? `, code ${m.errorCode}` : ""})${m.errorMessage ? `: ${m.errorMessage}` : ""}`,
      );
      runtime.exit(1);
    }
    await sleep(pollSeconds * 1000);
  }
  logInfo(
    "ℹ️  Timed out waiting for final status; message may still be in flight.",
    runtime,
  );
}
