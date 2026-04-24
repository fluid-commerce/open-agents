/**
 * The @vercel/sandbox SDK wraps non-OK HTTP responses in an APIError whose
 * `message` is just "Status code N is not ok". The parsed server body lives on
 * `err.json`, typically shaped `{ error: { code, message } }`. This helper
 * extracts that inner message so callers can surface an actionable error
 * (e.g. "Snapshot not found") instead of the SDK wrapper.
 *
 * Returns undefined when the error does not match the expected shape — callers
 * should fall back to the original Error.message.
 */
export function extractVercelApiErrorMessage(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const json = (err as { json?: unknown }).json;
  if (typeof json !== "object" || json === null) return undefined;
  const errorField = (json as { error?: unknown }).error;
  if (typeof errorField !== "object" || errorField === null) return undefined;
  const message = (errorField as { message?: unknown }).message;
  return typeof message === "string" && message.length > 0
    ? message
    : undefined;
}
