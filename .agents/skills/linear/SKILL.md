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
