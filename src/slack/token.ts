export function normalizeSlackToken(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveSlackBotToken(raw?: string): string | undefined {
  return normalizeSlackToken(raw);
}

export function resolveSlackAppToken(raw?: string): string | undefined {
  return normalizeSlackToken(raw);
}
