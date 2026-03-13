# API Route Refactor Plan

## Goal
Apply the same refactor style used in `apps/web/app/api/chat/` to other API routes with repeated auth/ownership logic and large inline control flow.

## Refactor Pattern We Are Following
- Extract repeated request guards into focused helper modules.
- Keep route handlers small and orchestration-focused.
- Preserve behavior/status codes exactly.
- Validate with existing project scripts after each refactor pass.

## Phase 1 — Sessions Chat Subtree (completed)
Target routes:
- `apps/web/app/api/sessions/[sessionId]/chats/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/read/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/share/route.ts`

Checklist:
- [x] Add shared sessions chat context helper (auth + owned session/chat guards)
- [x] Refactor target routes to use helper
- [x] Run typecheck/lint/tests for affected app
- [x] Record completion notes

Completion notes:
- Added `apps/web/app/api/sessions/_lib/session-context.ts` with shared guards:
  - `requireAuthenticatedUser`
  - `requireOwnedSession`
  - `requireOwnedSessionChat`
- Refactored all Phase 1 target routes to use shared guards and keep handler logic focused on endpoint-specific behavior.
- Verification run:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing max-lines warnings in unrelated files)
  - `bun test <target-file>` ✅ (targeted API route tests used for deterministic verification)
  - `bun run build --filter=web` ✅

## Phase 1.1 — Sessions Chat Regression Tests (completed)
Target tests:
- `apps/web/app/api/sessions/_lib/session-context.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/route.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/read/route.test.ts`
- `apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.test.ts`

Checklist:
- [x] Add helper guard tests (401/403/404/success paths)
- [x] Add route behavior tests for PATCH/DELETE/read/message delete flows
- [x] Keep `share/route.test.ts` passing with shared helper
- [x] Verify tests run cleanly

Completion notes:
- Added regression coverage for the shared sessions chat helper and refactored chat routes.
- Added explicit status-path tests for auth/ownership guard forwarding and route-specific behavior.
- Verification run:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing unrelated max-lines warnings)
  - `bun test 'apps/web/app/api/sessions/_lib/session-context.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/read/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/messages/[messageId]/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/share/route.test.ts'` ✅
  - `bun run build --filter=web` ✅

## Phase 2 — Session/Sandbox utility routes (completed)
Candidate routes:
- `apps/web/app/api/sessions/[sessionId]/files/route.ts`
- `apps/web/app/api/sessions/[sessionId]/skills/route.ts`
- `apps/web/app/api/sessions/[sessionId]/diff/route.ts`
- `apps/web/app/api/sessions/[sessionId]/diff/cached/route.ts`
- `apps/web/app/api/sessions/[sessionId]/merge/route.ts`
- `apps/web/app/api/sessions/[sessionId]/merge-readiness/route.ts`
- `apps/web/app/api/sessions/[sessionId]/pr-deployment/route.ts`
- `apps/web/app/api/sandbox/*.ts`
- `apps/web/app/api/check-pr/route.ts`
- `apps/web/app/api/git-status/route.ts`

Checklist:
- [x] Extract shared "owned session" + optional sandbox guard helper(s)
- [x] Migrate routes incrementally
- [x] Verify with scripts

Progress notes (Pass 1):
- Extended `apps/web/app/api/sessions/_lib/session-context.ts` with `requireOwnedSessionWithSandboxGuard` for reusable ownership + sandbox-state validation.
- Refactored the following Phase 2 session utility routes to use shared guards:
  - `apps/web/app/api/sessions/[sessionId]/files/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/skills/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/diff/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/diff/cached/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/merge/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/merge-readiness/route.ts`
  - `apps/web/app/api/sessions/[sessionId]/pr-deployment/route.ts`
- Added helper regression coverage in `apps/web/app/api/sessions/_lib/session-context.test.ts` for sandbox-guard forwarding/error paths.
- Verification run for this pass:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing unrelated max-lines warnings)
  - `bun test 'apps/web/app/api/sessions/_lib/session-context.test.ts' --reporter=junit --reporter-outfile session-context-test.xml` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/merge/route.test.ts' --reporter=junit --reporter-outfile merge-test.xml` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/skills/route.test.ts' --reporter=junit --reporter-outfile skills-test.xml` ✅
  - `bun test 'apps/web/app/api/sessions/[sessionId]/chats/[chatId]/share/route.test.ts' --reporter=junit --reporter-outfile share-route-test.xml` ✅
  - `bun run build --filter=web` ✅

Progress notes (Pass 2):
- Refactored the remaining Phase 2 utility routes to use the shared auth/ownership guards:
  - `apps/web/app/api/check-pr/route.ts`
  - `apps/web/app/api/git-status/route.ts`
  - `apps/web/app/api/sandbox/route.ts`
  - `apps/web/app/api/sandbox/extend/route.ts`
  - `apps/web/app/api/sandbox/reconnect/route.ts`
  - `apps/web/app/api/sandbox/snapshot/route.ts`
  - `apps/web/app/api/sandbox/status/route.ts`
- Verification run for this pass:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing unrelated max-lines warnings)
  - `bun test 'apps/web/app/api/sessions/_lib/session-context.test.ts'` ✅
  - `bun test 'apps/web/app/api/sandbox/route.test.ts'` ✅
  - `bun test 'apps/web/app/api/sandbox/status/route.test.ts'` ✅
  - `bun run build --filter=web` ✅

## Phase 3 — Large route decomposition (completed)
Candidates:
- `apps/web/app/api/generate-pr/route.ts`
- `apps/web/app/api/sessions/[sessionId]/diff/route.ts`
- `apps/web/app/api/github/create-repo/route.ts`

Checklist:
- [x] Identify cohesive helper boundaries per route
- [x] Split into `_lib` modules without behavior changes
- [x] Verify with scripts

Progress notes (Pass 1):
- Extracted diff parsing/base-ref helper logic from `apps/web/app/api/sessions/[sessionId]/diff/route.ts` into `apps/web/app/api/sessions/[sessionId]/diff/_lib/diff-utils.ts`.
- Kept `apps/web/app/api/sessions/[sessionId]/diff/route.ts` orchestration-focused while preserving existing status codes and behavior.
- Verification run:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing unrelated max-lines warnings)
  - `bun run test:isolated` ✅
  - `bun run build --filter=web` ✅

Progress notes (Pass 2):
- Extracted reusable generate-PR helper logic from `apps/web/app/api/generate-pr/route.ts` into `apps/web/app/api/generate-pr/_lib/generate-pr-helpers.ts` (branch naming, fork fallback helpers, token redaction, and conversation context assembly).
- Kept `apps/web/app/api/generate-pr/route.ts` focused on orchestration while preserving existing API behavior/status codes.
- Verification run:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing unrelated max-lines warnings)
  - `bun run test:isolated` ✅
  - `bun run build --filter=web` ✅

Progress notes (Pass 3):
- Extracted the create-repository sandbox workflow from `apps/web/app/api/github/create-repo/route.ts` into `apps/web/app/api/github/create-repo/_lib/create-repo-workflow.ts`.
- Kept `apps/web/app/api/github/create-repo/route.ts` focused on auth/ownership/token resolution and response orchestration while preserving existing behavior/status codes.
- Verification run:
  - `bun run typecheck --filter=web` ✅
  - `bun run lint --filter=web` ✅ (existing unrelated max-lines warnings)
  - `bun run test:isolated` ✅
  - `bun run build --filter=web` ✅
