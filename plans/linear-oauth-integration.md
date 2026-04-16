# Linear OAuth Integration

Add per-user Linear OAuth so agents can read, create, comment on, and update Linear issues from inside sandbox sessions.

## Status & context

This plan is for the `fluid-commerce/open-agents` fork of `vercel-labs/open-agents`. It is the next workstream after the initial deployment was stood up.

**Working environment:**
- Repo location: `/Users/brandon/open-agents`
- Default branch: `main`
- Git remotes: `origin = https://github.com/fluid-commerce/open-agents.git`, `upstream = https://github.com/vercel-labs/open-agents.git`
- Package manager: `bun` (do NOT use npm/yarn/pnpm)
- Quality gate: `bun run ci` (runs `bun run check`, `bun run typecheck`, `bun run test:isolated`, `bun run --cwd apps/web db:check`)

**Vercel deployment context:**
- Team: `fluid-commerce` (id: `team_utgvMwhdcyKDg0jyJVOeXKMf`)
- Project: `open-agents` (id: `prj_uhrlTVbDqtfVQA0rv2pLZVzvm56E`)
- Production URL: `https://open-agents-azure-two.vercel.app`
- Vercel CLI is installed and authenticated as `brandonsouthwick-9715`
- CLI auth token location: `~/Library/Application Support/com.vercel.cli/auth.json`
- DB: Neon, integrated via `vercel --scope fluid-commerce integration add neon` (already done; `POSTGRES_URL` env var is set)

**GitHub context:**
- GitHub App: `open-agents-fluid-commerce` (App ID `3401643`) under `fluid-commerce` org
- The user (`brs98`) is admin of the `fluid-commerce` GitHub org
- Authenticated via `gh` CLI as `brs98`

**Critical CLI gotcha learned the hard way:**
Use `printf '%s'` (no trailing newline) — never `echo` — when piping values into `vercel env add`. `echo` appends `\n`, which gets stored in the env var verbatim. For `NEXT_PUBLIC_*` vars this gets baked into the client JS bundle and corrupts URLs (visible as `%0A` in query strings).

## Goals

- Each user connects their own Linear account via OAuth (proper attribution; not a shared service-account key).
- Tokens stored encrypted at rest using the existing `ENCRYPTION_KEY` env var.
- Sandbox scripts call the Linear API without ever seeing the token — auth is brokered at the network policy layer (same pattern as GitHub).
- A bundled skill teaches the agent when and how to invoke Linear via a small Node-based CLI using the official `@linear/sdk` package.

## Non-goals

- Linear webhooks (we react to user prompts, not push events).
- Linear-side automation (creating views, mutating teams, time tracking).
- Rich Linear UI in the web app — just a connect/disconnect card in Settings, no scope display.
- Per-team scoping / project filtering.

## Decisions locked in

- **Scopes**: `read`, `write`, `issues:create`, `comments:create`. Sufficient for the read/list/create/comment/state-change operations in the skill. Don't request `admin`.
- **Settings UI**: minimal — a single Connect/Disconnect card. No badge of granted scopes (decided: noise).
- **Skill implementation**: Node scripts using `@linear/sdk` (decided over bash+curl+jq). Type-safe, easier to maintain, idiomatic for a TS codebase.
- **Token attribution**: per-user OAuth tokens, not a team-wide service account.

## Architectural pattern

Mirrors the existing GitHub user-OAuth flow. Each layer has a one-to-one analog:

| GitHub layer | File | Linear analog |
| --- | --- | --- |
| OAuth helpers | `apps/web/lib/vercel/oauth.ts` (use as the closest template — clean, complete) | `apps/web/lib/linear/oauth.ts` (NEW) |
| Token retrieval (decrypt + auto-refresh) | `apps/web/lib/github/user-token.ts` | `apps/web/lib/linear/user-token.ts` (NEW) |
| Sign-in initiator | `apps/web/app/api/auth/signin/vercel/route.ts` | `apps/web/app/api/auth/signin/linear/route.ts` (NEW) |
| Callback | `apps/web/app/api/github/app/callback/route.ts` (the OAuth-exchange portion) | `apps/web/app/api/linear/callback/route.ts` (NEW) |
| Unlink | `apps/web/app/api/auth/github/unlink/route.ts` | `apps/web/app/api/auth/linear/unlink/route.ts` (NEW) |
| Account row | `accounts.provider = "github"` | `accounts.provider = "linear"` (extend enum) |
| Token retrieval call site | `getUserGitHubToken()` in `apps/web/app/api/sandbox/route.ts` | Add `getUserLinearToken()` next to it |
| Network brokering | `buildGitHubCredentialBrokeringPolicy()` in `packages/sandbox/vercel/sandbox.ts` | Extend (or add sibling) for `api.linear.app` |
| Settings UI card | `apps/web/app/settings/accounts-section.tsx` | Add Linear card to same file |

The agent itself doesn't need to know about Linear — only the skill does. The agent's bash tool runs the skill scripts inside the sandbox, where the network layer transparently injects the Bearer token.

## Phase 0 — Linear-side setup (manual, ~5 min)

1. Create a dedicated Linear workspace named e.g. `Open Agents OAuth`. (Linear documentation strongly recommends a separate workspace to manage OAuth applications cleanly.)
2. In that workspace: **Settings → API → OAuth Applications → New**.
3. Configure:
   - **Name**: `Open Agents`
   - **Callback URLs** (both):
     - `https://open-agents-azure-two.vercel.app/api/linear/callback`
     - `http://localhost:3000/api/linear/callback`
   - **Scopes**: `read`, `write`, `issues:create`, `comments:create`
4. Save the **Client ID** and **Client Secret** — needed in Phase 7.

Linear docs reference: https://linear.app/developers/oauth-2-0-authentication

## Phase 1 — Database

### 1.1 Locate the provider enum

**File**: `apps/web/lib/db/schema.ts`

Find the `accounts` table definition. The `provider` column uses a Drizzle `pgEnum`. Currently includes `"github"` and `"vercel"`. Add `"linear"` to the enum array.

The `accounts` table schema already supports everything Linear needs (no new columns):
- `userId` (FK to users)
- `provider` (the enum we're extending)
- `externalUserId` (the Linear user id)
- `accessToken` (encrypted with `lib/crypto.ts`)
- `refreshToken` (encrypted)
- `expiresAt`
- `scope` (space-separated string of granted scopes)
- `username` (Linear's `displayName`)
- timestamps

### 1.2 Generate migration

```bash
bun run --cwd apps/web db:generate
```

This writes a new SQL file under `apps/web/lib/db/migrations/` named `XXXX_<auto_name>.sql` containing an `ALTER TYPE ... ADD VALUE 'linear'` statement. Commit the generated `.sql` file alongside the schema change.

**Do NOT use `db:push`.** That's for local throwaway DBs only. Migrations run automatically during `bun run build` via `apps/web/lib/db/migrate.ts`, so every Vercel deploy applies pending migrations.

### 1.3 Add account helper

**File**: `apps/web/lib/db/accounts.ts`

Mirror the existing `getGitHubAccount(userId)` function. Add:

```ts
export async function getLinearAccount(userId: string) {
  // SELECT FROM accounts WHERE userId = userId AND provider = 'linear' LIMIT 1
}

export async function deleteLinearAccount(userId: string) {
  // DELETE FROM accounts WHERE userId = userId AND provider = 'linear'
}
```

Look at the existing GitHub helpers for the exact Drizzle syntax to copy.

## Phase 2 — OAuth library

### 2.1 OAuth helpers

**New file**: `apps/web/lib/linear/oauth.ts`

Use `apps/web/lib/vercel/oauth.ts` as the structural template — Linear's flow is similar in shape (authorize → exchange → refresh → revoke → userinfo). Differences:

- No PKCE required (Linear supports it but not required; skip PKCE for now to keep the flow simple — can add later)
- Authorization URL uses `scope` as a **comma-separated** list (not space-separated like Vercel)
- User info comes from a GraphQL query, not a REST endpoint

Required exports:

```ts
const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_REVOKE_URL = "https://api.linear.app/oauth/revoke";
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";

export const LINEAR_OAUTH_SCOPES = [
  "read",
  "write",
  "issues:create",
  "comments:create",
] as const;

export function getLinearAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string;

interface LinearTokenResponse {
  access_token: string;
  token_type: string;     // "Bearer"
  expires_in: number;     // 86400 (24 hours)
  refresh_token: string;
  scope: string;          // space-separated string of granted scopes
}

export async function exchangeLinearCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<LinearTokenResponse>;

export async function refreshLinearToken(params: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<LinearTokenResponse>;

export async function revokeLinearToken(params: {
  token: string;
  clientId: string;
  clientSecret: string;
}): Promise<void>;

export interface LinearUserInfo {
  id: string;          // Linear user UUID
  name: string;
  displayName: string;
  email: string;
}

export async function getLinearUserInfo(accessToken: string): Promise<LinearUserInfo>;
```

For `getLinearUserInfo`, send a POST to `LINEAR_GRAPHQL_URL` with body:
```json
{ "query": "query { viewer { id name displayName email } }" }
```
and `Authorization: Bearer <accessToken>`. Parse `data.viewer` from the response.

For `getLinearAuthorizationUrl`, build:
```
https://linear.app/oauth/authorize
  ?client_id=...
  &redirect_uri=...
  &response_type=code
  &scope=read,write,issues:create,comments:create
  &state=...
  &prompt=consent
```

Token POSTs use `Content-Type: application/x-www-form-urlencoded` with `URLSearchParams` body — same as Vercel's `exchangeVercelCode`.

### 2.2 Token retrieval helper

**New file**: `apps/web/lib/linear/user-token.ts`

Mirror `apps/web/lib/github/user-token.ts`. Exports:

```ts
export async function getUserLinearToken(userId: string): Promise<string | null>;
```

Logic:
1. Look up the user's `linear` account via `getLinearAccount(userId)`. Return `null` if not found.
2. Decrypt `accessToken` with `decrypt()` from `apps/web/lib/crypto.ts`.
3. Check `expiresAt`: if it's within 5 minutes of now (or already past), refresh.
4. To refresh: decrypt `refreshToken`, call `refreshLinearToken({...})`, then `upsertAccount()` with the new encrypted access/refresh pair and new `expiresAt = new Date(Date.now() + expires_in * 1000)`.
5. Return the (possibly refreshed) decrypted access token.
6. On refresh failure (e.g. revoked refresh token), log and return `null` so callers can proxy a "reconnect Linear" hint to the user.

**Concurrency**: don't worry about this for v1. If we see token-refresh races in practice, add a per-userId in-memory mutex (the GitHub helper currently doesn't have one either).

## Phase 3 — Routes

All routes live under `apps/web/app/api/...`.

### 3.1 Sign-in initiator

**New file**: `apps/web/app/api/auth/signin/linear/route.ts`

Use `apps/web/app/api/auth/signin/vercel/route.ts` as the template. Differences: no PKCE, no code verifier — just `state`.

```ts
export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.NEXT_PUBLIC_LINEAR_CLIENT_ID;
  if (!clientId) {
    return Response.redirect(new URL("/?error=linear_not_configured", req.url));
  }

  // Require the user to already be signed in (Linear is a secondary connection)
  const session = await getServerSession();
  if (!session?.user) {
    const redirectAfter = `/api/auth/signin/linear?next=${encodeURIComponent(
      req.nextUrl.searchParams.get("next") ?? "/settings/accounts",
    )}`;
    return Response.redirect(
      new URL(`/?next=${encodeURIComponent(redirectAfter)}`, req.url),
    );
  }

  const state = generateState(); // arctic or crypto.randomBytes(32).toString("base64url")
  const store = await cookies();
  const redirectTo =
    req.nextUrl.searchParams.get("next") ?? "/settings/accounts";

  store.set("linear_auth_state", state, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });
  store.set("linear_auth_redirect_to", redirectTo, {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax",
  });

  const redirectUri = `${req.nextUrl.origin}/api/linear/callback`;
  const url = getLinearAuthorizationUrl({ clientId, redirectUri, state });
  return Response.redirect(url);
}
```

### 3.2 Callback handler

**New file**: `apps/web/app/api/linear/callback/route.ts`

Use `apps/web/app/api/auth/vercel/callback/route.ts` as the template. Pattern:

```ts
export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("linear_auth_state")?.value;
  const rawRedirectTo =
    cookieStore.get("linear_auth_redirect_to")?.value ?? "/settings/accounts";
  const storedRedirectTo =
    rawRedirectTo.startsWith("/") && !rawRedirectTo.startsWith("//")
      ? rawRedirectTo
      : "/settings/accounts";

  function clearCookies() {
    cookieStore.delete("linear_auth_state");
    cookieStore.delete("linear_auth_redirect_to");
  }

  function redirectBack(params: Record<string, string>) {
    clearCookies();
    const url = new URL(storedRedirectTo, req.url);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return Response.redirect(url);
  }

  if (error) {
    return redirectBack({ linear: "error", reason: error });
  }
  if (!code || !state || storedState !== state) {
    return redirectBack({ linear: "error", reason: "invalid_state" });
  }

  const session = await getServerSession();
  if (!session?.user) {
    return redirectBack({ linear: "error", reason: "not_signed_in" });
  }

  const clientId = process.env.NEXT_PUBLIC_LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectBack({ linear: "error", reason: "not_configured" });
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/linear/callback`;
    const tokens = await exchangeLinearCode({ code, clientId, clientSecret, redirectUri });
    const userInfo = await getLinearUserInfo(tokens.access_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await upsertAccount({
      userId: session.user.id,
      provider: "linear",
      externalUserId: userInfo.id,
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      scope: tokens.scope,
      username: userInfo.displayName,
      email: userInfo.email,
      name: userInfo.name,
      tokenExpiresAt,
    });

    return redirectBack({ linear: "connected" });
  } catch (err) {
    console.error("Linear OAuth callback error:", err);
    return redirectBack({ linear: "error", reason: "exchange_failed" });
  }
}
```

`upsertAccount` may need a small generalization if it currently hardcodes `provider: "github" | "vercel"` — extend its type signature to include `"linear"`.

### 3.3 Unlink endpoint

**New file**: `apps/web/app/api/auth/linear/unlink/route.ts`

Use `apps/web/app/api/auth/github/unlink/route.ts` as the template:

```ts
export async function POST(): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const account = await getLinearAccount(session.user.id);
  if (!account) {
    return Response.json({ success: true, alreadyUnlinked: true });
  }

  const clientId = process.env.NEXT_PUBLIC_LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (clientId && clientSecret) {
    try {
      const accessToken = decrypt(account.accessToken);
      await revokeLinearToken({ token: accessToken, clientId, clientSecret });
    } catch (err) {
      console.error("Linear token revoke failed (continuing):", err);
    }
  }

  await deleteLinearAccount(session.user.id);
  return Response.json({ success: true });
}
```

## Phase 4 — Sandbox network brokering

The pattern: the Vercel Sandbox SDK accepts a `networkPolicy` with an `allow` map. Each domain entry can include `transform` rules that **inject HTTP headers** into outbound requests. Scripts inside the sandbox call the API with no auth headers; the proxy adds them transparently.

### 4.1 Extend the network policy builder

**File**: `packages/sandbox/vercel/sandbox.ts`

Currently `buildGitHubCredentialBrokeringPolicy(token?: string): SandboxNetworkPolicy` exists around line 44–80. It returns a policy with entries for `api.github.com`, `uploads.github.com`, `codeload.github.com`, `github.com`, each with a `transform: [{ headers: { Authorization: "Bearer ..." } }]`.

**Refactor approach** (recommended): keep `buildGitHubCredentialBrokeringPolicy` as-is, add a new `buildLinearCredentialBrokeringPolicy(token?: string)`, and a merger:

```ts
function buildCredentialBrokeringPolicy(tokens: {
  github?: string;
  linear?: string;
}): SandboxNetworkPolicy {
  const gh = buildGitHubCredentialBrokeringPolicy(tokens.github);
  const ln = buildLinearCredentialBrokeringPolicy(tokens.linear);
  return {
    allow: { ...gh.allow, ...ln.allow },
  };
}
```

`buildLinearCredentialBrokeringPolicy` returns:

```ts
function buildLinearCredentialBrokeringPolicy(
  token?: string,
): SandboxNetworkPolicy {
  if (!token) return DEFAULT_NETWORK_POLICY;
  return {
    allow: {
      "api.linear.app": [
        { transform: [{ headers: { Authorization: `Bearer ${token}` } }] },
      ],
    },
  };
}
```

Update the call site (search for `buildGitHubCredentialBrokeringPolicy(githubToken)` in `sandbox.ts`) to use `buildCredentialBrokeringPolicy({ github: githubToken, linear: linearToken })`.

### 4.2 Plumb the Linear token through sandbox connect options

**File**: `packages/sandbox/vercel/connect.ts`

The `ConnectOptions` interface currently has `githubToken?: string`. Add `linearToken?: string`. Pass it through `buildCreateConfig` and into `VercelSandbox.connect/create` calls so it flows into the policy builder.

Search for every reference to `githubToken` in this file and add a parallel `linearToken` next to it.

### 4.3 Pass the token from the API route

**File**: `apps/web/app/api/sandbox/route.ts`

In the `POST` handler, currently:
```ts
const githubToken = await getUserGitHubToken(session.user.id);
```

Add right after:
```ts
const linearToken = await getUserLinearToken(session.user.id);
```

Then in the `connectSandbox({ ... options: { githubToken, ... } })` call, add `linearToken: linearToken ?? undefined`. Don't fail if Linear isn't connected — it's optional.

Also update `apps/web/lib/sandbox/lifecycle*.ts` and any other sandbox-related files (look for places that call `connectSandbox` or build sandbox options) to thread the Linear token through. **Audit**: grep `getUserGitHubToken` across the codebase and add a parallel `getUserLinearToken` call wherever a sandbox is being (re)created or resumed — there's likely a workflow file that does this too.

## Phase 5 — Settings UI

### 5.1 Add a Linear card

**File**: `apps/web/app/settings/accounts-section.tsx`

This file currently renders the GitHub connection card. Add a Linear card below it.

Two states:

- **Not connected**: text "Connect your Linear account to let agents read and update issues." + a button **Connect Linear** that links (anchor with `href`, full page navigation) to `/api/auth/signin/linear?next=/settings/accounts`.
- **Connected**: shows the user's Linear `displayName` + email, and a **Disconnect** button that POSTs to `/api/auth/linear/unlink` then refreshes the page (or revalidates SWR).

**No scope display** (decided: noise).

The component should fetch connection status. Two patterns available:
- Server-render from a DB query in the parent `page.tsx`
- Client-side fetch from a new `GET /api/linear/connection-status` endpoint

Pick whichever the existing GitHub card uses for consistency.

### 5.2 (Optional) status endpoint

**New file (only if needed)**: `apps/web/app/api/linear/connection-status/route.ts`

```ts
export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ connected: false }, { status: 401 });
  }
  const account = await getLinearAccount(session.user.id);
  if (!account) {
    return Response.json({ connected: false });
  }
  return Response.json({
    connected: true,
    displayName: account.username,
    email: account.email,
  });
}
```

### 5.3 Handle callback flash messages

When the callback redirects back with `?linear=connected` or `?linear=error&reason=...`, the settings page should show a toast (use `sonner` — already installed) describing the outcome. Look for where the GitHub card handles its redirect status messages and mirror.

## Phase 6 — The skill (Linear SDK + Node)

Skills live under `.agents/skills/<name>/` and consist of a `SKILL.md` describing when/how, plus optional executable scripts the agent can invoke.

### 6.1 Skill directory layout

```
.agents/skills/linear/
├── SKILL.md
├── package.json
├── bun.lock                  # generated after first install
├── setup.sh                  # idempotent dependency install
└── bin/
    ├── linear-get-issue.mjs
    ├── linear-list-my-issues.mjs
    ├── linear-create-issue.mjs
    ├── linear-comment.mjs
    └── linear-update-state.mjs
```

### 6.2 `package.json`

```json
{
  "name": "@open-agents/skill-linear",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "@linear/sdk": "*"
  }
}
```

The `*` version pin is intentional — let bun resolve the latest at first install. We can pin later if churn is a problem.

### 6.3 `setup.sh`

```bash
#!/usr/bin/env bash
# Idempotent: installs Linear SDK if not present.
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d node_modules/@linear/sdk ]; then
  bun install --silent
fi
```

Make executable: `chmod +x setup.sh`. The skill scripts source/run this at the top so first invocation auto-installs.

### 6.4 Script template

Each script in `bin/` follows this shape. The Linear SDK is initialized **without an explicit accessToken** — wait, that won't work; the SDK needs a token. **However**, the sandbox network proxy injects `Authorization: Bearer <token>` only for outbound requests. The `@linear/sdk` constructor reads the token client-side and adds the header itself, so we have to hand it _something_.

**Solution**: pass a placeholder token to the SDK. The SDK adds `Authorization: Bearer <placeholder>` to the request. Then the sandbox proxy's `transform` rule **overwrites** the Authorization header with the real token before the request leaves the VM.

⚠️ **Verify this header-overwrite behavior** during implementation. If the proxy's `transform` only _adds_ headers (not replaces), we need a different approach: either
- (a) the SDK's `LinearClient` accepts a custom `fetch` function — pass one that strips the Authorization header so the proxy can add it, or
- (b) skip the SDK and use raw `fetch` against `https://api.linear.app/graphql` directly (bash-script approach we previously rejected).

Test this with a tiny script during Phase 4 implementation **before** building out all five scripts.

Assuming overwrite works, script template:

```js
// bin/linear-get-issue.mjs
import { LinearClient } from "@linear/sdk";

const ISSUE_ID = process.argv[2];
if (!ISSUE_ID) {
  console.error("Usage: linear-get-issue.mjs <issue-id>");
  process.exit(2);
}

// Placeholder token — the sandbox network proxy injects the real Bearer token.
const linear = new LinearClient({ accessToken: "sandbox-injected" });

try {
  const issue = await linear.issue(ISSUE_ID);
  const [state, assignee] = await Promise.all([issue.state, issue.assignee]);
  console.log(JSON.stringify({
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description,
    state: state?.name,
    assignee: assignee?.displayName,
    url: issue.url,
  }, null, 2));
} catch (err) {
  console.error("Linear API error:", err.message ?? err);
  process.exit(1);
}
```

Other scripts follow the same shape:
- `linear-list-my-issues.mjs`: `const me = await linear.viewer; const { nodes } = await me.assignedIssues();` then JSON-print summaries.
- `linear-create-issue.mjs <team-key> <title> <description>`: resolve team via `linear.teams({ filter: { key: { eq: TEAM_KEY } } })`, then `linear.createIssue({ teamId, title, description })`.
- `linear-comment.mjs <issue-id> <body>`: `linear.createComment({ issueId, body })`.
- `linear-update-state.mjs <issue-id> <state-name>`: resolve workflow state by name within the issue's team, then `issue.update({ stateId })`.

All scripts: `chmod +x` and shebang `#!/usr/bin/env node`.

### 6.5 `SKILL.md`

```markdown
---
name: linear
description: Use this when the user references Linear issues, tickets, projects, or wants to read/list/create/comment-on/update Linear work items. Triggers on issue identifiers (e.g. FCM-123), the words "ticket", "linear", "issue", or workflow state changes.
---

You have access to Linear through scripts in this skill's directory.
Authentication is handled automatically by the sandbox network layer — DO NOT
read any LINEAR_* env vars (none are set; the token is brokered transparently).

Before invoking any script for the first time in a session, run:
```
.agents/skills/linear/setup.sh
```
This installs `@linear/sdk` if not already installed (idempotent).

## Available scripts

All scripts emit JSON to stdout and human-readable errors to stderr.

- `.agents/skills/linear/bin/linear-get-issue.mjs <issue-id>` — fetch one issue by identifier (e.g. FCM-123)
- `.agents/skills/linear/bin/linear-list-my-issues.mjs` — list issues assigned to the authenticated Linear user
- `.agents/skills/linear/bin/linear-create-issue.mjs <team-key> <title> <description>` — create an issue in a team
- `.agents/skills/linear/bin/linear-comment.mjs <issue-id> <body>` — comment on an issue
- `.agents/skills/linear/bin/linear-update-state.mjs <issue-id> <state-name>` — move an issue to a different workflow state

## When to use

- User asks "what's the status of FCM-123?" → `linear-get-issue.mjs FCM-123`
- User asks "what am I working on in Linear?" → `linear-list-my-issues.mjs`
- User asks "file a ticket for this bug" → confirm with the user, then `linear-create-issue.mjs`
- User says "comment on FCM-123 that we're investigating" → `linear-comment.mjs`
- User says "mark FCM-123 as in review" → `linear-update-state.mjs`

## When NOT to use

- Don't fall back to Linear when the user asks about GitHub issues — those are different systems.
- Don't create or modify Linear data without confirming with the user first when the action is destructive (state changes, deletions).
- If a script fails with "Linear not connected" or 401-style errors, tell the user to visit /settings/accounts on the deployment to connect their Linear account.
```

## Phase 7 — Environment variables

After Phase 0 yields the Linear OAuth client credentials, set them on Vercel:

```bash
cd /Users/brandon/open-agents

# Use printf, NOT echo (avoids trailing newline corruption)
for env in production development; do
  printf '%s' '<linear_client_id>' | vercel env add NEXT_PUBLIC_LINEAR_CLIENT_ID "$env"
  printf '%s' '<linear_client_secret>' | vercel env add LINEAR_CLIENT_SECRET "$env"
done
```

Note: `vercel env add` for `preview` requires either an explicit branch or `--yes` flag, and piping has had inconsistent behavior. Skip preview unless needed.

Also document them in `apps/web/.env.example`:

```
# Linear OAuth (optional — required to enable Linear integration)
# Callback URL: {YOUR_ORIGIN}/api/linear/callback
# Get these from a Linear OAuth app: https://linear.app/<workspace>/settings/api/applications
NEXT_PUBLIC_LINEAR_CLIENT_ID=
LINEAR_CLIENT_SECRET=
```

For local dev, also add to `apps/web/.env`:
```
NEXT_PUBLIC_LINEAR_CLIENT_ID=<same value>
LINEAR_CLIENT_SECRET=<same value>
```

## Phase 8 — Testing

### Manual E2E

Local:
1. `bun run web` (dev server on http://localhost:3000)
2. Navigate to `/settings/accounts` → click "Connect Linear" → authorize → confirm card flips to connected state.
3. Start a new session pointed at a repo.
4. Prompt: "Look up FCM-1 in Linear" — agent should invoke `linear-get-issue.mjs FCM-1`, return issue details.
5. Prompt: "Comment on FCM-1: 'agent investigating'" — agent should run `linear-comment.mjs`. Verify in Linear UI that the comment is attributed to your user.
6. Disconnect from settings → confirm subsequent Linear-related prompts get a clear "not connected" hint, not a 500.

Production:
- Same checklist against `https://open-agents-azure-two.vercel.app`.
- Verify migrations applied (look for `Migrations applied successfully` in deploy build log).

### Header-overwrite verification (CRITICAL — do this in Phase 4)

Before building the full skill, write a tiny test:
1. SSH/exec into a sandbox: `vercel sandbox connect <id>` or via the agent's bash tool.
2. Run: `curl -v -H "Authorization: Bearer FAKE_TOKEN" https://api.linear.app/viewer.json` (or some Linear endpoint).
3. Inspect what arrives at Linear (use a request-bin or Linear's GraphQL playground introspection error to see headers).

If the proxy correctly **replaces** the Authorization header with the real token, the SDK approach in Phase 6 works. If it only **appends** (resulting in two Authorization headers, or the wrong one winning), pivot to:
- Use `LinearClient`'s custom `fetch` option to send requests _without_ an Authorization header at all, OR
- Drop the SDK and use raw `fetch` calls in the scripts.

### Unit tests (where they fit)

Add to `apps/web/lib/linear/`:
- `oauth.test.ts`: authorize URL builder includes correct params; `exchangeLinearCode` parses success and error responses (mock `fetch`).
- `user-token.test.ts`: returns `null` when no account, returns decrypted token when not expired, refreshes when expired (mock `refreshLinearToken`, mock DB).

Run: `bun test apps/web/lib/linear/`. Or include in the full suite via `bun run ci`.

## Phase 9 — Deploy

Commit each phase as its own logical commit so review is reasonable:

```
feat(db): add 'linear' to provider enum (+ migration)
feat(linear): add OAuth library and user-token helper
feat(linear): add OAuth routes (signin, callback, unlink)
feat(sandbox): broker Linear API auth via network policy
feat(settings): add Linear connection card
feat(skills): add Linear skill with SDK-based scripts
docs(env): document Linear OAuth env vars
```

Then:
```bash
git push origin main
vercel deploy --prod --yes
```

Verify in build log:
- `Migrations applied successfully`
- No TypeScript errors
- `Build Completed in /vercel/output`

Then run the manual E2E checklist (Phase 8) against production.

## Out-of-scope follow-ups

- **Webhook receiver** so the agent can react to Linear events (requires `app/api/linear/webhook/route.ts` + signature verification + workflow trigger).
- **Pre-baked sandbox snapshot** with `@linear/sdk` already installed, eliminating first-invocation install latency. Use `bun run sandbox:snapshot-base` as the entry point.
- **Smarter scope handling** — if we ever request scopes that not all users grant, `getUserLinearToken` should expose granted scopes so the skill can degrade gracefully.
- **Migrate AI Gateway billing to fluid-commerce** by removing the `AI_GATEWAY_API_KEY` env var (currently uses personal account credits).
- **Reconnect flow** mirroring GitHub's `github_reconnect` cookie pattern, for refresh-token failures.

## Risks / gotchas

- **Header overwrite** (largest risk): Phase 6 assumes the sandbox proxy replaces existing Authorization headers. Verify this in Phase 4 testing before building all five scripts. Fallback options listed in Phase 8.
- **Linear API rate limits**: ~1500 requests/hour per OAuth app. Should be fine for interactive use; document in skill if hot-loops emerge.
- **Refresh-token race conditions**: under concurrent requests for the same user, two refreshes can race and one will fail. Acceptable for v1; add a per-user mutex if it becomes a real issue.
- **Network policy growth**: each new third-party we broker adds an `allow` entry. Phase 4 should establish a clean pattern (the merger function) so future integrations don't sprawl across `sandbox.ts`.
- **Token leakage via SDK errors**: `@linear/sdk` may include the token in error messages it throws. Audit error logging in scripts and the user-token helper to avoid leaking decrypted tokens to Vercel logs.
- **Trailing-newline regression**: re-emphasize `printf '%s'` over `echo` for any future env var setting. Worth adding a comment to `apps/web/.env.example` and to Phase 7 of this doc.
- **Migration order**: the `ALTER TYPE ... ADD VALUE` must run before any code path inserts a row with `provider = 'linear'`. Migrations run during `bun run build`, so this is automatic — but if a developer manually runs the new code against an un-migrated DB locally, they'll get an error. Keep the migration in the same commit as the schema change.
