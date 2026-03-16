const STREAM_TOKEN_SEPARATOR = ":";

export function createStreamToken(
  startedAtMs: number,
  streamId: string = crypto.randomUUID(),
): string {
  return `${startedAtMs}${STREAM_TOKEN_SEPARATOR}${streamId}`;
}

export function parseStreamTokenStartedAt(
  streamToken: string | null,
): number | null {
  if (!streamToken) {
    return null;
  }

  const separatorIndex = streamToken.indexOf(STREAM_TOKEN_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }

  const startedAt = Number(streamToken.slice(0, separatorIndex));
  if (!Number.isFinite(startedAt)) {
    return null;
  }

  return startedAt;
}

export function parseStreamTokenValue(
  streamToken: string | null,
): string | null {
  if (!streamToken) {
    return null;
  }

  const separatorIndex = streamToken.indexOf(STREAM_TOKEN_SEPARATOR);
  if (separatorIndex <= 0 || separatorIndex >= streamToken.length - 1) {
    return null;
  }

  return streamToken.slice(separatorIndex + 1);
}
