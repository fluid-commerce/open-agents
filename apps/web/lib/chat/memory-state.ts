/**
 * In-memory state adapter for Chat SDK
 *
 * This keeps dedupe keys and locks in-process so we can avoid duplicate
 * Slack processing during retries or rapid mentions.
 */

import { randomUUID } from "crypto";
import type { Lock, StateAdapter } from "chat";

type ValueEntry = {
  value: unknown;
  expiresAt: number | null;
};

type LockEntry = {
  token: string;
  expiresAt: number;
};

const values = new Map<string, ValueEntry>();
const locks = new Map<string, LockEntry>();
const subscriptions = new Set<string>();

function isExpired(expiresAt: number | null): boolean {
  return expiresAt !== null && Date.now() >= expiresAt;
}

function cleanValue(key: string, entry: ValueEntry) {
  if (isExpired(entry.expiresAt)) {
    values.delete(key);
  }
}

function cleanLock(threadId: string, entry: LockEntry) {
  if (Date.now() >= entry.expiresAt) {
    locks.delete(threadId);
  }
}

export function createMemoryState(): StateAdapter {
  return {
    async connect() {
      // No-op for in-memory state
    },
    async disconnect() {
      // No-op for in-memory state
    },
    async subscribe(threadId: string) {
      subscriptions.add(threadId);
    },
    async unsubscribe(threadId: string) {
      subscriptions.delete(threadId);
    },
    async isSubscribed(threadId: string) {
      return subscriptions.has(threadId);
    },
    async *listSubscriptions(_adapterName?: string): AsyncIterable<string> {
      for (const threadId of subscriptions) {
        yield threadId;
      }
    },
    async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
      const now = Date.now();
      const existing = locks.get(threadId);
      if (existing) {
        cleanLock(threadId, existing);
        if (locks.has(threadId)) {
          return null;
        }
      }

      const token = randomUUID();
      const expiresAt = now + ttlMs;
      const lock = { threadId, token, expiresAt } satisfies Lock;
      locks.set(threadId, { token, expiresAt });
      return lock;
    },
    async releaseLock(lock: Lock) {
      const existing = locks.get(lock.threadId);
      if (!existing) return;
      if (existing.token === lock.token) {
        locks.delete(lock.threadId);
      }
    },
    async extendLock(lock: Lock, ttlMs: number) {
      const existing = locks.get(lock.threadId);
      if (!existing || existing.token !== lock.token) {
        return false;
      }
      locks.set(lock.threadId, {
        token: existing.token,
        expiresAt: Date.now() + ttlMs,
      });
      return true;
    },
    async get<T>(key: string): Promise<T | null> {
      const entry = values.get(key);
      if (!entry) return null;
      cleanValue(key, entry);
      return values.get(key)?.value as T | null;
    },
    async set<T>(key: string, value: T, ttlMs?: number) {
      const expiresAt = typeof ttlMs === "number" ? Date.now() + ttlMs : null;
      values.set(key, { value, expiresAt });
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
}
