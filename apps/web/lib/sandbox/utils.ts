import type { SandboxState } from "@open-harness/sandbox";
import { SANDBOX_EXPIRES_BUFFER_MS } from "./config";

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function getPersistentSandboxId(state: unknown): string | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  const sandboxId = (state as { sandboxId?: unknown }).sandboxId;
  return hasNonEmptyString(sandboxId) ? sandboxId : null;
}

function getTrackedRuntimeExpiresAt(state: unknown): number | undefined {
  if (!state || typeof state !== "object") {
    return undefined;
  }

  const expiresAt = (state as { expiresAt?: unknown }).expiresAt;
  return typeof expiresAt === "number" ? expiresAt : undefined;
}

function getTrackedRuntimeSessionId(state: unknown): string | null {
  if (!state || typeof state !== "object") {
    return null;
  }

  const sessionId = (state as { sessionId?: unknown }).sessionId;
  return hasNonEmptyString(sessionId) ? sessionId : null;
}

/**
 * Type guard to check if a sandbox is active and ready to accept operations.
 */
export function isSandboxActive(
  state: SandboxState | null | undefined,
): state is SandboxState {
  if (!state || !hasRuntimeSandboxState(state)) return false;

  const expiresAt = getTrackedRuntimeExpiresAt(state);
  if (
    expiresAt !== undefined &&
    Date.now() >= expiresAt - SANDBOX_EXPIRES_BUFFER_MS
  ) {
    return false;
  }

  return true;
}

/**
 * Check if we still have a persistent sandbox artifact that can be resumed or stopped.
 */
export function canOperateOnSandbox(
  state: SandboxState | null | undefined,
): state is SandboxState {
  return hasPersistentSandboxState(state);
}

/**
 * Check if sandbox identity exists, even when the current runtime session is stopped.
 */
export function hasPersistentSandboxState(
  state: SandboxState | null | undefined,
): state is SandboxState {
  return getPersistentSandboxId(state) !== null;
}

/**
 * Check if an unknown value represents sandbox state with active runtime data.
 */
export function hasRuntimeSandboxState(
  state: SandboxState | null | undefined,
): state is SandboxState;
export function hasRuntimeSandboxState(state: unknown): boolean;
export function hasRuntimeSandboxState(state: unknown): boolean {
  if (getPersistentSandboxId(state) === null) {
    return false;
  }

  return (
    getTrackedRuntimeSessionId(state) !== null ||
    getTrackedRuntimeExpiresAt(state) !== undefined
  );
}

/**
 * Check if an error message indicates the sandbox VM is permanently unavailable.
 */
export function isSandboxUnavailableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("expected a stream of command data") ||
    normalized.includes("status code 404") ||
    normalized.includes("status code 410") ||
    normalized.includes("sandbox is stopped") ||
    normalized.includes("sandbox not found") ||
    normalized.includes("session is stopped") ||
    normalized.includes("session not found") ||
    normalized.includes("sandbox probe failed")
  );
}

/**
 * Clear only runtime sandbox state while preserving the persistent sandbox identity.
 */
export function clearSandboxState(
  state: SandboxState | null | undefined,
): SandboxState | null {
  if (!state) return null;

  const sandboxId = getPersistentSandboxId(state);
  if (!sandboxId) {
    return { type: state.type } as SandboxState;
  }

  return {
    type: state.type,
    sandboxId,
  } as SandboxState;
}

/**
 * Clear both runtime state and persistent sandbox identity.
 */
export function clearSandboxIdentity(
  state: SandboxState | null | undefined,
): SandboxState | null {
  if (!state) return null;
  return { type: state.type } as SandboxState;
}
