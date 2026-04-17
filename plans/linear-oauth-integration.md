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
- Multi-workspace support per user. Users can connect exactly one Linear workspace at a time; to switch workspaces, disconnect and reconnect.

## Decisions locked in

- **Scopes**: `read`, `write`, `issues:create`, `comments:create`. Sufficient for the read/list/create/comment/state-change operations in the skill. Don't request `admin`.
- **Scope format in authorize URL**: comma-separated (confirmed against Linear docs), e.g. `scope=read,write,issues:create,comments:create`.
- **Settings UI**: minimal — a single Connect/Disconnect card showing `displayName · workspaceName`. No scope badge.
- **Skill implementation**: Node scripts using `@linear/sdk` (decided over bash+curl+jq). Type-safe, easier to maintain, idiomatic for a TS codebase.
- **Token attribution**: per-user OAuth tokens, not a team-wide service account.
- **Account helpers**: per-provider functions (`upsertLinearAccount`, `getLinearAccount`, `deleteLinearAccount`) matching the GitHub pattern. Do NOT generalize to a single `upsertAccount` — wait for a third provider (rule of three).
- **PKCE**: enabled. Mirror `apps/web/lib/vercel/oauth.ts`'s verifier/challenge pattern. Vercel, not GitHub, is the closer template for Linear's flow.
- **Client-ID env var**: plain `LINEAR_CLIENT_ID` (not `NEXT_PUBLIC_LINEAR_CLIENT_ID`). Nothing consumes it client-side; every read is in a server route.
- **Email on settings card**: no. Matches existing GitHub card (shows `login` only). Can add later if needed.
- **Workspace capture**: during the OAuth callback, fetch `viewer.organization { urlKey, name }` and store `organization.name` in a new nullable `workspaceName` column on the `accounts` table. Surfaces to the settings card so users can verify the right workspace was connected.

## Architectural pattern

Mirrors the existing GitHub user-OAuth flow. Each layer has a one-to-one analog, but Linear's OAuth is closer to Vercel's shape (PKCE, standard RFC 6749 flow) than GitHub's.

| Concern | Existing GitHub layer | Existing Vercel layer | New Linear file |
| --- | --- | --- | --- |
| OAuth helpers | `apps/web/lib/github/` (scattered) | `apps/web/lib/vercel/oauth.ts` (use as **structural template** — PKCE + clean exports) | `apps/web/lib/linear/oauth.ts` |
| Token retrieval (decrypt + auto-refresh) | `apps/web/lib/github/user-token.ts` | — | `apps/web/lib/linear/user-token.ts` |
| Sign-in initiator | `apps/web/app/api/auth/signin/github/*` | `apps/web/app/api/auth/signin/vercel/route.ts` (use as template for PKCE cookies) | `apps/web/app/api/auth/signin/linear/route.ts` |
| Callback | `apps/web/app/api/github/app/callback/route.ts` | `apps/web/app/api/auth/vercel/callback/route.ts` (use as template) | `apps/web/app/api/linear/callback/route.ts` |
| Unlink | `apps/web/app/api/auth/github/unlink/route.ts` (use as template) | — | `apps/web/app/api/auth/linear/unlink/route.ts` |
| Account row | `accounts.provider = "github"` | (lives in `users` table, not `accounts`) | `accounts.provider = "linear"` (extend enum; add `workspaceName` column) |
| Token retrieval call sites | `getUserGitHubToken()` in 3 files that matter for sandbox flow | — | Add `getUserLinearToken()` in the same 3 files |
| Network brokering | `buildGitHubCredentialBrokeringPolicy()` in `packages/sandbox/vercel/sandbox.ts` | — | Replace with unified `buildCredentialBrokeringPolicy({ github, linear })`; update both create and reconnect call sites |
| Settings UI card | `apps/web/app/settings/accounts-section.tsx` | — | Add Linear card to same file; show `displayName · workspaceName` |

The agent itself doesn't need to know about Linear as a feature — only the skill does. The agent's bash tool runs the skill scripts inside the sandbox, where the network layer transparently injects the Bearer token. However, the sandbox's `environmentDetails` runtime prompt MUST be updated (Phase 4) so the agent knows Linear API calls are auto-authenticated and it doesn't try to pass tokens into scripts.

### Token retrieval call sites (audit)

Grep for `getUserGitHubToken` shows ~15 hits, but only 3 matter for sandbox network-policy brokering:

| File | Line | Needs Linear token threading? |
| --- | --- | --- |
| `apps/web/app/api/sandbox/route.ts` | 132 | Yes — create path |
| `apps/web/app/api/chat/_lib/runtime.ts` | 53 | Yes — reconnect on every chat turn |
| `apps/web/lib/sandbox/archive-session.ts` | 74 | No — archive flow, no active agent use |

Everything else (`auto-commit-direct`, `auto-pr-direct`, `/api/pr/*`, `/api/github/*`, PR/merge/close routes, etc.) is GitHub-API-direct for web UI or PR automation — unrelated to sandbox network policy.

Because `runtime.ts:53` re-fetches the token on every chat turn and `VercelSandbox.connect` re-applies the network policy, the proxy's injected token is refreshed at every turn boundary. Linear tokens live 24h; chat turns max out ~13 min (`maxDuration = 800s`), so intra-turn expiry is rare and self-heals on the next turn.

## Phase 0 — Linear-side setup (manual, ~5 min)

1. Create a dedicated Linear workspace named e.g. `Open Agents OAuth`. Linear documentation strongly recommends a separate workspace to manage OAuth applications cleanly.
2. In that workspace: **Settings → API → OAuth Applications → New**.
3. Configure:
   - **Name**: `Open Agents`
   - **Callback URLs** (both):
     - `https://open-agents-azure-two.vercel.app/api/linear/callback`
     - `http://localhost:3000/api/linear/callback`
   - **Scopes**: `read`, `write`, `issues:create`, `comments:create`
4. Save the **Client ID** and **Client Secret** — needed in Phase 7.

Linear docs reference: https://linear.app/developers/oauth-2-0-authentication

## Phase 0.5 — Verify sandbox header-overwrite behavior (CRITICAL gate)

**Do this BEFORE writing any other code.** The `@linear/sdk` approach in Phase 6 depends on this behavior. If it doesn't hold, pivot to raw `fetch` before building five skill scripts you'd have to rewrite.

The question: when a sandbox network policy has `transform.headers.Authorization = "Bearer REAL_TOKEN"` and the script inside the sandbox sends `Authorization: Bearer PLACEHOLDER`, does the proxy **replace** or **append**? The SDK approach requires **replace** semantics.

**Test methodology (~10 minutes):**

1. Get a temporary throwaway URL from https://webhook.site (records full headers of incoming requests).
2. In a throwaway branch, temporarily patch `packages/sandbox/vercel/sandbox.ts` to add a hardcoded transform for `webhook.site`:
   ```ts
   "webhook.site": [
     { transform: [{ headers: { Authorization: "Bearer REAL_INJECTED" } }] },
   ],
   ```
3. Deploy that branch to a preview, create a session, and from the agent bash tool run:
   ```bash
   curl -H "Authorization: Bearer PLACEHOLDER" https://webhook.site/<your-id>
   ```
4. Look at the webhook.site dashboard for the recorded request headers.

**Interpretation:**
- Only `Bearer REAL_INJECTED` present → **replace**. SDK approach works as designed in Phase 6. Proceed.
- Only `Bearer PLACEHOLDER` present → proxy is pass-through; brokering broken. Halt — something is wrong with the sandbox config itself.
- Both present (two `Authorization` headers) → **append**. Which one wins depends on the destination. SDK approach is fragile; pivot:
  - **Fallback A:** pass a custom `fetch` into `LinearClient` that strips the Authorization header before the request leaves the VM. Keeps the SDK.
  - **Fallback B:** drop `@linear/sdk` entirely; use raw `fetch` against `https://api.linear.app/graphql`. Simpler but loses SDK ergonomics. Covered in [Out-of-scope](#out-of-scope-follow-ups) as a rewrite path if needed.

Discard the throwaway branch once you have the answer. Document the answer in this plan (overwrite this section with a one-line "confirmed replace as of YYYY-MM-DD") so future-you doesn't re-run the test.

## Phase 1 — Database

### 1.1 Extend the provider enum + add `workspaceName` column

**File**: `apps/web/lib/db/schema.ts`

Current state (check before editing, may have drifted):
- `accounts.provider` enum is currently `["github"]` only. `vercel` lives on the `users` table, not `accounts`.
- The `accounts` table has no `email`, `name`, or workspace columns — just `username`, `externalUserId`, `accessToken`, `refreshToken`, `expiresAt`, `scope`.

Changes:
1. Extend `provider` enum to `["github", "linear"]`.
2. Add a new nullable column `workspaceName text` (for Linear: stores the human-readable workspace name like "Fluid Commerce"; null for GitHub rows).

```ts
export const accounts = pgTable(
  "accounts",
  {
    // ... existing columns
    provider: text("provider", {
      enum: ["github", "linear"],  // was: ["github"]
    })
      .notNull()
      .default("github"),
    // ... other existing columns
    workspaceName: text("workspace_name"),  // NEW — nullable, per-provider use
    // ... timestamps
  },
  // ... indexes unchanged
);
```

### 1.2 Generate migration

```bash
bun run --cwd apps/web db:generate
```

This writes a new SQL file under `apps/web/lib/db/migrations/` with:
- An `ALTER TYPE ... ADD VALUE 'linear'` for the enum
- An `ALTER TABLE accounts ADD COLUMN workspace_name text` statement

Commit the generated `.sql` file alongside the schema change.

**Do NOT use `db:push`.** That's for local throwaway DBs only. Migrations run automatically during `bun run build` via `apps/web/lib/db/migrate.ts`, so every Vercel deploy applies pending migrations.

### 1.3 Add per-provider account helpers

**File**: `apps/web/lib/db/accounts.ts`

Mirror the existing `upsertGitHubAccount` / `getGitHubAccount` / `deleteGitHubAccount` trio. Do NOT generalize to `upsertAccount` — wait for a third provider. The existing pattern is explicit per-provider and we're keeping it for now.

```ts
export async function upsertLinearAccount(data: {
  userId: string;
  externalUserId: string;      // Linear viewer.id
  accessToken: string;          // already encrypted
  refreshToken?: string;        // already encrypted
  expiresAt?: Date;
  scope?: string;
  username: string;             // Linear viewer.displayName
  workspaceName?: string;       // Linear viewer.organization.name
}): Promise<string> { /* ... */ }

export async function getLinearAccount(userId: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  username: string;
  externalUserId: string;
  workspaceName: string | null;
} | null> { /* ... */ }

export async function updateLinearAccountTokens(
  userId: string,
  data: { accessToken: string; refreshToken?: string; expiresAt?: Date },
): Promise<void> { /* ... */ }

export async function deleteLinearAccount(userId: string): Promise<void> { /* ... */ }
```

Copy the Drizzle syntax from the existing GitHub helpers. Wire `workspaceName` through `upsert` and `get`; `updateLinearAccountTokens` doesn't touch it.

## Phase 2 — OAuth library

### 2.1 OAuth helpers

**New file**: `apps/web/lib/linear/oauth.ts`

Use `apps/web/lib/vercel/oauth.ts` as the structural template (PKCE is already implemented there). Linear-specific differences:

- Scope is **comma-separated** (not space-separated).
- User info comes from a GraphQL query, not a REST endpoint. Include workspace.

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

// PKCE — reuse the pattern from lib/vercel/oauth.ts
export function generateCodeVerifier(): string;         // crypto.randomBytes(32).toString("base64url")
export async function generateCodeChallenge(verifier: string): Promise<string>;  // sha256 -> base64url

export function getLinearAuthorizationUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string;

interface LinearTokenResponse {
  access_token: string;
  token_type: string;     // "Bearer"
  expires_in: number;     // 86400 (24 hours)
  refresh_token: string;
  scope: string;          // space-separated string of granted scopes (in response)
}

export async function exchangeLinearCode(params: {
  code: string;
  codeVerifier: string;        // PKCE
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
  token: string;              // pass either access_token or refresh_token
  clientId: string;
  clientSecret: string;
}): Promise<void>;

export interface LinearUserInfo {
  id: string;              // Linear user UUID
  name: string;
  displayName: string;
  email: string;
  organizationName: string;   // viewer.organization.name
  organizationUrlKey: string; // viewer.organization.urlKey
}

export async function getLinearUserInfo(accessToken: string): Promise<LinearUserInfo>;
```

For `getLinearUserInfo`, POST to `LINEAR_GRAPHQL_URL` with:
```json
{ "query": "query { viewer { id name displayName email organization { id urlKey name } } }" }
```
and `Authorization: Bearer <accessToken>`. Flatten the response to the shape above.

For `getLinearAuthorizationUrl`, build:
```
https://linear.app/oauth/authorize
  ?client_id=...
  &redirect_uri=...
  &response_type=code
  &scope=read,write,issues:create,comments:create    (COMMA-separated)
  &state=...
  &code_challenge=...                                  (PKCE)
  &code_challenge_method=S256
  &prompt=consent
```

Token POSTs use `Content-Type: application/x-www-form-urlencoded` with `URLSearchParams` body — same as Vercel's `exchangeVercelCode`. The exchange call includes `code_verifier` (PKCE).

### 2.2 Token retrieval helper

**New file**: `apps/web/lib/linear/user-token.ts`

Mirror `apps/web/lib/github/user-token.ts` structure. Export:

```ts
export async function getUserLinearToken(userId: string): Promise<string | null>;
```

Logic:
1. Look up the user's `linear` account via `getLinearAccount(userId)`. Return `null` if not found.
2. Decrypt `accessToken` with `decrypt()` from `apps/web/lib/crypto.ts`.
3. Check `expiresAt`: if within 5 minutes of now (or past), refresh.
4. To refresh: decrypt `refreshToken`, call `refreshLinearToken(...)`, then `updateLinearAccountTokens(...)` with the new encrypted access/refresh pair and `expiresAt = new Date(Date.now() + expires_in * 1000)`.
5. Return the (possibly refreshed) decrypted access token.
6. On refresh failure (e.g. revoked refresh token), log and return `null` so callers can proxy a "reconnect Linear" hint to the user.

Read client credentials from `process.env.LINEAR_CLIENT_ID` and `process.env.LINEAR_CLIENT_SECRET` (not `NEXT_PUBLIC_*`).

**Concurrency**: don't worry about it for v1. Linear rotates refresh tokens on use (confirmed against docs), so concurrent refreshes for the same user CAN race and one will fail. Acceptable for v1; matches GitHub's current behavior. Add a per-user mutex later if it becomes a real issue.

## Phase 3 — Routes

All routes live under `apps/web/app/api/...`.

### 3.1 Sign-in initiator

**New file**: `apps/web/app/api/auth/signin/linear/route.ts`

Use `apps/web/app/api/auth/signin/vercel/route.ts` as the template — it already does PKCE.

```ts
export async function GET(req: NextRequest): Promise<Response> {
  const clientId = process.env.LINEAR_CLIENT_ID;
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

  const state = crypto.randomBytes(32).toString("base64url");
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const store = await cookies();
  const redirectTo =
    req.nextUrl.searchParams.get("next") ?? "/settings/accounts";

  const cookieOpts = {
    path: "/",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 60 * 10,
    sameSite: "lax" as const,
  };
  store.set("linear_auth_state", state, cookieOpts);
  store.set("linear_auth_verifier", codeVerifier, cookieOpts);
  store.set("linear_auth_redirect_to", redirectTo, cookieOpts);

  const redirectUri = `${req.nextUrl.origin}/api/linear/callback`;
  const url = getLinearAuthorizationUrl({ clientId, redirectUri, state, codeChallenge });
  return Response.redirect(url);
}
```

### 3.2 Callback handler

**New file**: `apps/web/app/api/linear/callback/route.ts`

Use `apps/web/app/api/auth/vercel/callback/route.ts` as the template.

```ts
export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const storedState = cookieStore.get("linear_auth_state")?.value;
  const codeVerifier = cookieStore.get("linear_auth_verifier")?.value;
  const rawRedirectTo =
    cookieStore.get("linear_auth_redirect_to")?.value ?? "/settings/accounts";
  const storedRedirectTo =
    rawRedirectTo.startsWith("/") && !rawRedirectTo.startsWith("//")
      ? rawRedirectTo
      : "/settings/accounts";

  function clearCookies() {
    cookieStore.delete("linear_auth_state");
    cookieStore.delete("linear_auth_verifier");
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
  if (!code || !state || storedState !== state || !codeVerifier) {
    return redirectBack({ linear: "error", reason: "invalid_state" });
  }

  const session = await getServerSession();
  if (!session?.user) {
    return redirectBack({ linear: "error", reason: "not_signed_in" });
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return redirectBack({ linear: "error", reason: "not_configured" });
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/linear/callback`;
    const tokens = await exchangeLinearCode({
      code, codeVerifier, clientId, clientSecret, redirectUri,
    });
    const userInfo = await getLinearUserInfo(tokens.access_token);
    const tokenExpiresAt = new Date(Date.now() + tokens.expires_in * 1000);

    await upsertLinearAccount({
      userId: session.user.id,
      externalUserId: userInfo.id,
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      scope: tokens.scope,
      username: userInfo.displayName,
      workspaceName: userInfo.organizationName,
      expiresAt: tokenExpiresAt,
    });

    return redirectBack({ linear: "connected" });
  } catch (err) {
    console.error("Linear OAuth callback error:", err);
    return redirectBack({ linear: "error", reason: "exchange_failed" });
  }
}
```

### 3.3 Unlink endpoint

**New file**: `apps/web/app/api/auth/linear/unlink/route.ts`

Use `apps/web/app/api/auth/github/unlink/route.ts` as the template. Revoke BOTH tokens defensively — Linear's docs don't specify whether revoking the access token cascades to the refresh token.

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

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (clientId && clientSecret) {
    try {
      const accessToken = decrypt(account.accessToken);
      await revokeLinearToken({ token: accessToken, clientId, clientSecret });
    } catch (err) {
      console.error("Linear access-token revoke failed (continuing):", err);
    }
    if (account.refreshToken) {
      try {
        const refreshToken = decrypt(account.refreshToken);
        await revokeLinearToken({ token: refreshToken, clientId, clientSecret });
      } catch (err) {
        console.error("Linear refresh-token revoke failed (continuing):", err);
      }
    }
  }

  await deleteLinearAccount(session.user.id);
  return Response.json({ success: true });
}
```

**Note on active sessions:** the sandbox proxy holds the decrypted token until the next chat turn's reconnect refreshes the network policy. This means there's a brief window (up to the duration of the current chat turn) where a revoked token remains usable from inside active sandboxes. This matches GitHub's existing behavior and is acceptable — the only user who benefits from that token is the user who just disconnected.

## Phase 4 — Sandbox network brokering

### 4.1 Unify the network policy builder

**File**: `packages/sandbox/vercel/sandbox.ts`

Replace the current `buildGitHubCredentialBrokeringPolicy(token?: string)` with a unified builder that accepts both tokens. Key invariant: **always include `"*": []`** in the `allow` map so egress to non-brokered hosts stays open. Forgetting this rule turns the sandbox into a deny-by-default firewall and breaks npm installs, agent-browser, etc.

```ts
function buildCredentialBrokeringPolicy(tokens: {
  github?: string;
  linear?: string;
}): SandboxNetworkPolicy {
  const allow: SandboxNetworkPolicy["allow"] = { "*": [] };

  if (tokens.github) {
    const basicAuthToken = Buffer.from(
      `x-access-token:${tokens.github}`,
      "utf-8",
    ).toString("base64");
    allow["api.github.com"] = [
      { transform: [{ headers: { Authorization: `Bearer ${tokens.github}` } }] },
    ];
    allow["uploads.github.com"] = [
      { transform: [{ headers: { Authorization: `Bearer ${tokens.github}` } }] },
    ];
    allow["codeload.github.com"] = [
      { transform: [{ headers: { Authorization: `Bearer ${tokens.github}` } }] },
    ];
    allow["github.com"] = [
      { transform: [{ headers: { Authorization: `Basic ${basicAuthToken}` } }] },
    ];
  }

  if (tokens.linear) {
    allow["api.linear.app"] = [
      { transform: [{ headers: { Authorization: `Bearer ${tokens.linear}` } }] },
    ];
  }

  return { allow };
}
```

Delete `buildGitHubCredentialBrokeringPolicy` — the unified function replaces it.

### 4.2 Update both call sites

Two places currently apply the network policy — both need the unified builder:

- `VercelSandbox.create` (~line 531): `networkPolicy: buildGitHubCredentialBrokeringPolicy(githubToken)` → `networkPolicy: buildCredentialBrokeringPolicy({ github: githubToken, linear: linearToken })`
- `syncGitHubCredentialBrokering` function (~line 85–108) and its call at `VercelSandbox.connect` (~line 726): rename to `syncCredentialBrokering`, accept `tokens: { github?: string; linear?: string }`, pass through to the unified builder.

**This is load-bearing:** chat turns hit the reconnect path (the sandbox already exists when chat runs), so if only `create` is updated, every chat turn after the first drops Linear brokering silently.

### 4.3 Plumb `linearToken` through connect options

**File**: `packages/sandbox/vercel/connect.ts`

The `ConnectOptions` interface currently has `githubToken?: string`. Add `linearToken?: string`. Pass it through `buildCreateConfig` and into `VercelSandbox.connect/create` calls so it flows into the policy builder.

Also update the `VercelSandboxConfig` type to accept `linearToken?: string` on the create path.

### 4.4 Update the sandbox runtime prompt (`environmentDetails`)

**File**: `packages/sandbox/vercel/sandbox.ts` — the `get environmentDetails()` string (~line 419–432).

The runtime prompt currently documents GitHub brokering but not Linear. Without this, the agent will try to pass `LINEAR_API_KEY` env vars, ask the user for a token, or get confused on a 401.

Add a conditional line next to the GitHub one. "Conditional" = emit the line only when a Linear token was actually passed at sandbox create/connect time. This requires storing the presence (not the value) of the token on the sandbox instance; the simplest approach is adding a private boolean `private _linearBrokerEnabled?: boolean` set alongside the existing constructor args.

Proposed addition (between the existing GitHub line and the Node.js line):

```
- Linear API requests (api.linear.app) are authenticated automatically via credential brokering when the user has connected Linear; do not pass tokens into scripts or env vars. If a Linear call returns 401, tell the user to connect Linear at /settings/accounts.
```

Why conditional (not always-on like GitHub):
- GitHub is required for the app to function (every session has a repo). Always-on is accurate.
- Linear is optional. Claiming "Linear is authenticated automatically" when it isn't misleads the agent into retrying on 401s instead of surfacing "you haven't connected Linear."

### 4.5 Thread `linearToken` through the 3 call sites

Audit from earlier grep identified 3 files:

**`apps/web/app/api/sandbox/route.ts`** (~line 132):
```ts
const githubToken = await getUserGitHubToken(session.user.id);
const linearToken = await getUserLinearToken(session.user.id);  // NEW
// ...
await connectSandbox({
  // ...
  options: {
    githubToken: githubToken ?? undefined,
    linearToken: linearToken ?? undefined,  // NEW
    // ...
  },
});
```

**`apps/web/app/api/chat/_lib/runtime.ts`** (~line 53): this file already has `getUserGitHubToken(userId)` inside a `Promise.all`. Add `getUserLinearToken(userId)` as a sibling and thread the result into `connectSandbox` options.

**`apps/web/lib/sandbox/archive-session.ts`**: skip. Archive flow shuts the sandbox down; no agent work happens in that sandbox context.

## Phase 5 — Settings UI

### 5.1 Add a Linear card

**File**: `apps/web/app/settings/accounts-section.tsx`

Add a Linear card below the GitHub card (or above — placement is cosmetic).

Two states:

- **Not connected**: text "Connect your Linear account to let agents read and update issues." + a button **Connect Linear** that does a full-page navigation (anchor with `href`) to `/api/auth/signin/linear?next=/settings/accounts`.
- **Connected**: shows `displayName · workspaceName` (e.g. `Brandon Southwick · Fluid Commerce`) and a **Disconnect** button that POSTs to `/api/auth/linear/unlink` then refreshes via SWR.

No email (matches GitHub card which shows `login` only).
No scope display (decided).

Fetch connection status via a new endpoint (Section 5.2) using SWR, same pattern as the GitHub card uses for `/api/github/orgs/install-status`.

### 5.2 Status endpoint

**New file**: `apps/web/app/api/linear/connection-status/route.ts`

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
    workspaceName: account.workspaceName ?? null,
  });
}
```

### 5.3 Handle callback flash messages

When the callback redirects back with `?linear=connected` or `?linear=error&reason=...`, the settings page shows a toast (use `sonner` — already installed).

Mirror the `useGitHubReturnToast` hook in `accounts-section.tsx` (lines 110–172 in the existing file) for Linear. Likely a new `useLinearReturnToast` hook that strips `?linear=` from the URL and fires the appropriate toast.

## Phase 6 — The skill (Linear SDK + Node)

Skills live under `.agents/skills/<name>/` and consist of a `SKILL.md` describing when/how, plus optional executable scripts the agent can invoke.

**Prerequisite:** Phase 0.5 has confirmed "replace" semantics. If it confirmed "append" instead, follow the relevant fallback from Phase 0.5 before building this phase.

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

The `*` version pin is intentional — let bun resolve the latest at first install.

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

Make executable: `chmod +x setup.sh`. Scripts rely on this being run once per session (the SKILL.md instructs the agent to run it before first invocation).

### 6.4 Script template

Each script in `bin/` follows this shape. Because Phase 0.5 confirmed the sandbox proxy **replaces** the Authorization header, we initialize `LinearClient` with a placeholder token — the proxy overwrites it with the real user token before the request leaves the VM.

```js
// bin/linear-get-issue.mjs
#!/usr/bin/env node
import { LinearClient } from "@linear/sdk";

const ISSUE_ID = process.argv[2];
if (!ISSUE_ID) {
  console.error("Usage: linear-get-issue.mjs <issue-id>");
  process.exit(2);
}

// Placeholder token — the sandbox network proxy replaces Authorization
// with the real Bearer token before the request leaves the VM. See Phase 0.5.
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
Authentication is brokered by the sandbox network layer (see environmentDetails).
Scripts pass a placeholder token to @linear/sdk — the real token is injected by the proxy.

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
- If a script fails with 401-style errors, the user either hasn't connected Linear or is connected to the wrong workspace. Tell them to visit /settings/accounts to reconnect.
```

Keep SKILL.md focused on *when to invoke* and *which script*. Don't duplicate auth-mechanism explanation from `environmentDetails`.

## Phase 7 — Environment variables

After Phase 0 yields the Linear OAuth client credentials, set them on Vercel:

```bash
cd /Users/brandon/open-agents

# Use printf, NOT echo (avoids trailing newline corruption — see Status & context)
for env in production development; do
  printf '%s' '<linear_client_id>' | vercel env add LINEAR_CLIENT_ID "$env"
  printf '%s' '<linear_client_secret>' | vercel env add LINEAR_CLIENT_SECRET "$env"
done
```

Note: `vercel env add` for `preview` requires either an explicit branch or `--yes` flag, and piping has had inconsistent behavior. Skip preview unless needed.

Also document them in `apps/web/.env.example`:

```
# Linear OAuth (optional — required to enable Linear integration)
# Callback URL: {YOUR_ORIGIN}/api/linear/callback
# Get these from a Linear OAuth app: https://linear.app/<workspace>/settings/api/applications
LINEAR_CLIENT_ID=
LINEAR_CLIENT_SECRET=
```

For local dev, add the same values to `apps/web/.env`.

**Note:** Unlike `NEXT_PUBLIC_GITHUB_CLIENT_ID`, `LINEAR_CLIENT_ID` is server-only. It does NOT need to be added to `turbo.json`'s env allowlist (which is for client-exposed vars).

## Phase 8 — Testing

### Manual E2E

Local:
1. `bun run web` (dev server on http://localhost:3000)
2. Navigate to `/settings/accounts` → click "Connect Linear" → authorize → pick workspace → confirm card flips to connected state showing `displayName · workspaceName`.
3. Start a new session pointed at a repo.
4. Prompt: "Look up FCM-1 in Linear" — agent should invoke `linear-get-issue.mjs FCM-1`, return issue details.
5. Prompt: "Comment on FCM-1: 'agent investigating'" — agent should run `linear-comment.mjs`. Verify in Linear UI that the comment is attributed to your user.
6. Disconnect from settings → confirm subsequent Linear-related prompts get a clear "not connected" hint, not a 500.

Production:
- Same checklist against `https://open-agents-azure-two.vercel.app`.
- Verify migrations applied (look for `Migrations applied successfully` in deploy build log).

### Unit tests

Add to `apps/web/lib/linear/`:
- `oauth.test.ts`: authorize URL builder includes correct params (PKCE challenge, comma-separated scope); `exchangeLinearCode` parses success and error responses (mock `fetch`).
- `user-token.test.ts`: returns `null` when no account, returns decrypted token when not expired, refreshes when expired (mock `refreshLinearToken`, mock DB).

### Sandbox policy tests

Extend `packages/sandbox/vercel/sandbox.test.ts` — it already has a "refreshes brokered GitHub auth when reconnecting to a sandbox" test (~line 399) that captures `updateNetworkPolicyCalls`. Mirror with three new cases:

1. **Linear token only** — `connect` with `{ linearToken }` → asserts one `api.linear.app` transform + `"*": []` preserved, no GitHub entries.
2. **Both tokens** — `connect` with `{ githubToken, linearToken }` → asserts both sets of transforms present + `"*": []`.
3. **Neither token** — `connect` with `{}` → asserts policy is `{ "*": [] }` only (default allow-all preserved).

Run: `bun test packages/sandbox/vercel/sandbox.test.ts` or include in `bun run ci`.

## Phase 9 — Deploy

Commit order (re-sequenced around Phase 0.5 and the unified policy builder):

```
1. test(sandbox): verify header-overwrite behavior via webhook.site  [Phase 0.5 — manual verification log; no committed code unless you keep the probe in a throwaway branch]
2. feat(db): add 'linear' to provider enum + workspaceName column (+ migration)
3. feat(linear): add OAuth library (with PKCE) and user-token helper
4. feat(linear): add OAuth routes (signin, callback, unlink)
5. feat(sandbox): unified credential brokering policy (github + linear)
6. test(sandbox): linear brokering reconnect tests
7. feat(sandbox): document linear brokering in environmentDetails
8. feat(settings): add Linear connection card with workspace display
9. feat(skills): add Linear skill with SDK-based scripts
10. docs(env): document Linear OAuth env vars
```

Commits 5 + 7 are split so sandbox-layer code changes ship separately from agent-prompt changes — easier to revert one without the other if regressions appear.

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
- **Multi-workspace support** — remove the `unique(userId, provider)` index on `accounts`, allow N Linear rows per user keyed by `workspaceUrlKey`; skill scripts gain an optional `--workspace` flag. Significant data-model and UX scope.
- **Smarter scope handling** — if we ever request scopes that not all users grant, `getUserLinearToken` should expose granted scopes so the skill can degrade gracefully.
- **Raw-fetch skill scripts as a fallback** — if Phase 0.5 revealed "append" semantics and we patched around it with a custom `fetch`, eventually migrate off `@linear/sdk` for simplicity.
- **Migrate AI Gateway billing to fluid-commerce** by removing the `AI_GATEWAY_API_KEY` env var (currently uses personal account credits).
- **Reconnect flow** mirroring GitHub's `github_reconnect` cookie pattern, for refresh-token failures.
- **Force-sync on unlink** — iterate active sessions owned by the disconnecting user and push a fresh network policy that drops Linear. Currently we rely on natural refresh at the next chat turn.

## Risks / gotchas

- **Header overwrite** (largest risk — now gated by Phase 0.5): if the sandbox proxy **appends** instead of **replaces** the Authorization header, the `@linear/sdk` approach is broken. Phase 0.5 verifies this before any other code is written. Fallback plans are documented there.
- **Linear API rate limits**: ~1500 requests/hour per OAuth app. Should be fine for interactive use; document in skill if hot-loops emerge.
- **Refresh-token rotation races**: Linear rotates refresh tokens on every use (confirmed against docs). Under concurrent requests for the same user, two refreshes can race and one will fail. Acceptable for v1; add a per-user mutex if it becomes a real issue.
- **Revocation cascade ambiguity**: Linear's docs don't say whether revoking an access token cascades to the paired refresh token. Mitigation: unlink endpoint revokes BOTH tokens defensively (Phase 3.3). Residual risk is a breached-DB attacker with a pre-unlink refresh token snapshot — already covered by `ENCRYPTION_KEY` at-rest encryption.
- **Mid-session disconnect window**: when a user disconnects Linear mid-session, their sandbox proxy still holds the old token until the next chat turn reconnect. Matches GitHub's behavior and is acceptable — the only beneficiary of the stale token is the same user who just disconnected.
- **Wildcard preservation in policy**: every path that builds a `SandboxNetworkPolicy` MUST include `"*": []` in `allow`. Forgetting this rule turns the sandbox into a deny-by-default firewall. The unified `buildCredentialBrokeringPolicy` centralizes this; any future brokered-credential builder must be added inside that function, not alongside it.
- **Reconnect path is load-bearing**: chat turns call `syncCredentialBrokering`, not `create`. If only `create` is updated with Linear threading, the feature breaks on the second chat turn of every session — silent regression. Phase 4.2 calls this out explicitly.
- **Network policy growth**: each new third-party we broker adds a transform entry. The unified builder centralizes this so additions are a single `if (tokens.X)` block.
- **Token leakage via SDK errors**: `@linear/sdk` may include the token in error messages it throws. Audit error logging in scripts and the user-token helper to avoid leaking decrypted tokens to Vercel logs.
- **Trailing-newline regression**: `printf '%s'` over `echo` for any future env var setting. Documented in Phase 7 and Status & context.
- **Migration order**: the `ALTER TYPE ... ADD VALUE` must run before any code path inserts a row with `provider = 'linear'`. Migrations run during `bun run build`, so this is automatic — but if a developer manually runs the new code against an un-migrated DB locally, they'll get an error. Keep the migration in the same commit as the schema change.
- **Workspace attribution**: Linear tokens are scoped to one workspace. If a user authorizes the wrong workspace, issue lookups silently return "not found" for issues in their intended workspace. Mitigation: settings card displays `displayName · workspaceName` so users can verify at a glance. Multi-workspace is an out-of-scope follow-up.
