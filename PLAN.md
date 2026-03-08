Summary: Add repo-to-Vercel-project linking during repo session creation, remember the chosen project per user/repo, and copy that linked project onto each session. When a linked session sandbox is created, fetch the linked Vercel project's Development env vars and write them into `/vercel/sandbox/.env.local` once.

Context: Key findings from exploration -- existing patterns, relevant files, constraints
- Session creation starts in `apps/web/components/session-starter.tsx`, posts through `apps/web/hooks/use-sessions.ts`, and persists in `apps/web/app/api/sessions/route.ts`.
- The `sessions` table in `apps/web/lib/db/schema.ts` already stores repo metadata and sandbox lifecycle state, but nothing yet for a Vercel project link.
- Sandbox creation happens in `apps/web/app/api/sandbox/route.ts` via `connectSandbox(...)` from `packages/sandbox`.
- `packages/sandbox/interface.ts` exposes `writeFile()`, `packages/sandbox/vercel/sandbox.ts` writes files natively to cloud sandboxes, and `packages/sandbox/hybrid/sandbox.ts` tracks `writeFile()` calls as pending operations during the JustBash phase so they replay on cloud handoff.
- That means the safest way to make `.env.local` survive hybrid handoff is to call `sandbox.writeFile(...)` on the connected sandbox after startup, not to only add `.env.local` to the initial tarball file set.
- Vercel auth/token flow already exists in `apps/web/lib/vercel/oauth.ts` and `apps/web/lib/vercel/token.ts`. The env proxy route at `apps/web/app/api/vercel/projects/[idOrName]/env/route.ts` proves the token can fetch decrypted envs.
- Vercel’s project list API supports repo matching (`GET /v10/projects?repoUrl=...`) and project objects include Git link metadata. Team discovery is available through `GET /v2/teams`, so repo matching can search personal scope plus each accessible team.
- Current product auth is already Vercel-first (`apps/web/components/auth/sign-in-button.tsx`), so phase 1 does not need a second “connect Vercel” flow.
- Product decisions confirmed for v1:
  - Sync **Development** env vars only
  - Auto-match a repo to a Vercel project when possible and remember that default
  - Write `.env.local` only on initial sandbox creation

Approach: High-level design decision and why
- Add a durable per-user repo mapping table for “GitHub repo -> Vercel project default”, and copy the selected project onto the session record at creation time. This keeps future session creation fast and predictable, while making each session stable even if the repo default changes later.
- Add a lightweight Vercel project lookup API that, given a selected GitHub repo, returns:
  - the saved default mapping (if any)
  - live Vercel candidate projects found by repo URL across the user scope and accessible teams
  - a recommended selected project when there is exactly one live match
- Extend the session starter UI to show a Vercel project selector only for repo-backed sessions. If there is exactly one match, preselect it and explain that it will be remembered. If there are multiple matches, let the user choose. If there is no match, allow creating an unlinked session.
- At sandbox creation time, if the session has a linked Vercel project, fetch decrypted Development env vars server-side, generate a dotenv-formatted `.env.local`, and call `sandbox.writeFile("/vercel/sandbox/.env.local", ...)`. Using the sandbox abstraction keeps one code path for `just-bash`, `hybrid`, and `vercel`, and for hybrid it guarantees replay to the cloud sandbox.
- Env sync failures should be non-blocking: the session/sandbox still starts, but the sync is skipped and logged so a stale or inaccessible Vercel link does not break the core session flow.

Changes:
- `apps/web/lib/db/schema.ts` - add session-level Vercel project snapshot columns (`vercelProjectId`, `vercelProjectName`, `vercelTeamId`, `vercelTeamSlug`) plus a new `vercel_project_links` table keyed by `userId + repoOwner + repoName`.
- `apps/web/lib/db/migrations/*.sql` - generated migration for the new session columns and repo-link table.
- `apps/web/lib/db/vercel-project-links.ts` - new helpers to read/upsert/delete remembered repo defaults.
- `apps/web/lib/vercel/projects.ts` - new shared server helper to list repo-matched Vercel project candidates (personal + teams), normalize project/team data, fetch project env vars, filter Development entries, and generate `.env.local` content.
- `apps/web/app/api/vercel/projects/[idOrName]/env/route.ts` - refactor to reuse the shared Vercel project/env helper instead of duplicating fetch logic.
- `apps/web/app/api/vercel/repo-projects/route.ts` - new route for the session-starter UI to fetch saved default + live project candidates for a selected repo.
- `apps/web/components/session-starter.tsx` - add Vercel project lookup/loading/error states and a selector row beneath repo/branch selection for repo-backed sessions.
- `apps/web/hooks/use-sessions.ts` - extend `CreateSessionInput` so session creation can include an optional selected Vercel project snapshot.
- `apps/web/app/api/sessions/route.ts` - persist selected Vercel project fields onto the session and upsert the repo default when a project is chosen; optionally fall back to the saved repo default when no explicit selection is provided.
- `apps/web/app/api/sandbox/route.ts` - after `connectSandbox(...)`, if the session has a linked Vercel project, fetch Development env vars and write `/vercel/sandbox/.env.local` through the sandbox interface before returning.
- `apps/web/app/api/vercel/repo-projects/route.test.ts` - cover candidate lookup, single-match auto-selection, and multi-project responses.
- `apps/web/app/api/sessions/route.test.ts` (new or extended) - cover persisting selected Vercel project fields and remembering repo defaults.
- `apps/web/app/api/sandbox/route.test.ts` (new or extended) - cover linked-session env sync, generated `.env.local`, and non-blocking failure behavior.
- `apps/web/lib/vercel/projects.test.ts` - cover candidate normalization, Development filtering, and dotenv serialization/escaping.

Verification:
- End-to-end manual flow:
  1. Sign in with Vercel and ensure GitHub repo access is installed.
  2. Choose a repo in the new-session flow.
  3. Confirm a single matched Vercel project is auto-selected, or choose one from the selector when multiple exist.
  4. Create the session and verify the sandbox contains `/vercel/sandbox/.env.local` with Development env vars.
  5. Repeat session creation for the same repo and confirm the previous project choice is remembered.
  6. Create a repo session with no Vercel project selected and confirm the session still works without `.env.local`.
  7. Verify hybrid sessions still have `.env.local` after cloud handoff.
- Relevant test commands:
  - `bun run format:check`
  - `bun run lint --filter=web`
  - `bun run typecheck --filter=web`
  - `bun test apps/web/app/api/vercel`
  - `bun test apps/web/app/api/sessions`
  - `bun test apps/web/app/api/sandbox`
  - `bun run --cwd apps/web build`
- Edge cases to check:
  - multiple Vercel projects for one repo
  - stale remembered project mapping
  - team-scoped project matches
  - env values containing quotes/newlines
  - linked project exists but env fetch returns 403/404
