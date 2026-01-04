import { WebClient } from "@slack/web-api";

export type SlackProbe = {
  ok: boolean;
  status?: number | null;
  error?: string | null;
  elapsedMs?: number | null;
  bot?: { id?: string; name?: string };
  team?: { id?: string; name?: string };
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function probeSlack(
  token: string,
  timeoutMs = 2500,
): Promise<SlackProbe> {
  const client = new WebClient(token);
  const start = Date.now();
  try {
    const result = await withTimeout(client.auth.test(), timeoutMs);
    if (!result.ok) {
      return {
        ok: false,
        status: 200,
        error: result.error ?? "unknown",
        elapsedMs: Date.now() - start,
      };
    }
    return {
      ok: true,
      status: 200,
      elapsedMs: Date.now() - start,
      bot: { id: result.user_id ?? undefined, name: result.user ?? undefined },
      team: { id: result.team_id ?? undefined, name: result.team ?? undefined },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      typeof (err as { status?: number }).status === "number"
        ? (err as { status?: number }).status
        : null;
    return {
      ok: false,
      status,
      error: message,
      elapsedMs: Date.now() - start,
    };
  }
}
