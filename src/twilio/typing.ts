import { isVerbose, logVerbose, warn } from "../globals.js";
import type { RuntimeEnv } from "../runtime.js";

type TwilioRequestOptions = {
  method: "get" | "post";
  uri: string;
  params?: Record<string, string | number>;
  data?: Record<string, string>;
  body?: unknown;
  contentType?: string;
};

type TwilioRequester = {
  request: (options: TwilioRequestOptions) => Promise<unknown>;
};

export type TypingIndicatorResult = {
  sent: boolean;
  response?: unknown;
  error?: unknown;
};

export async function sendTypingIndicator(
  client: TwilioRequester,
  runtime: RuntimeEnv,
  messageSid?: string,
): Promise<TypingIndicatorResult> {
  // Best-effort WhatsApp typing indicator (public beta as of Nov 2025).
  // Note: This API also marks the referenced message as read automatically.
  // The typing indicator disappears after 25 seconds or when a response is sent.
  if (!messageSid) {
    logVerbose("Skipping typing indicator: missing MessageSid");
    return { sent: false };
  }

  // Always log that we're attempting to send (helps debug when indicators aren't working)
  runtime.log(`📝 Sending typing indicator for message ${messageSid}...`);

  try {
    const response = await client.request({
      method: "post",
      uri: "https://messaging.twilio.com/v2/Indicators/Typing.json",
      data: {
        messageId: messageSid,
        channel: "whatsapp",
      },
    });
    runtime.log(`✅ Typing indicator sent for ${messageSid}`);
    logVerbose(`Typing indicator response: ${JSON.stringify(response)}`);
    return { sent: true, response };
  } catch (err) {
    // Always log typing indicator failures (not just in verbose mode) since
    // this helps diagnose why read receipts/typing aren't working.
    const errorMsg =
      err instanceof Error ? err.message : JSON.stringify(err, null, 2);
    runtime.error(
      warn(`Typing indicator failed for ${messageSid}: ${errorMsg}`),
    );
    if (isVerbose() && err instanceof Error && err.stack) {
      runtime.error(err.stack);
    }
    return { sent: false, error: err };
  }
}
