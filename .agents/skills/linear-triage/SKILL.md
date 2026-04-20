---
name: linear-triage
description: Analyze blocking relationships between Linear issues to determine work priority, find what's ready, and identify parallel work opportunities. Use when needing to prioritize Linear tickets, find what to work on next, understand task dependencies, or check what's blocked or in progress for a project or team.
user-invocable: true
---

# Linear Task Dependency Resolver

Builds a dependency graph from Linear issue blocking relations and outputs a prioritized work order. Uses a bundled script that calls the Linear GraphQL API directly — one query fetches everything.

## Prerequisites

Authentication is automatic — the sandbox network proxy replaces the `Authorization` header with the real OAuth token on any request to `api.linear.app`. The user must have connected their Linear account in `/settings/accounts`.

Falls back to `LINEAR_API_KEY` env var if set (for local development outside the sandbox).

## Usage

The script is at `scripts/linear-triage.mjs` relative to this skill file. Resolve the absolute path from this SKILL.md's location when running:

```bash
node <skill-dir>/scripts/linear-triage.mjs --project "<project name>"
```

If the user doesn't specify a project or team, query Linear to help them choose:

```bash
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ projects(first: 50) { nodes { id name } } }"}' | jq .data.projects.nodes
```

```bash
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ teams(first: 50) { nodes { id key name } } }"}' | jq .data.teams.nodes
```

Then run the script with their choice.

### Options

| Flag | Description | Example |
|------|-------------|---------|
| `--project` | Filter by project name (fuzzy match) | `--project "Native Toolchain Migration"` |
| `--team` | Filter by team name | `--team "Rep Experience"` |
| `--state` | Filter by state type (comma-separated) | `--state "unstarted,started"` |
| `--format=json` | Machine-readable JSON output | For programmatic use |

At least `--project` or `--team` is required.

## Reading the Output

The script resolves the authenticated user (via the `viewer` query) and uses assignee data to separate available work from claimed work.

It outputs five sections:

1. **IN PROGRESS** — Issues actively being worked on, with assignee, parent epic reference, and what they unblock.
2. **READY TO WORK** — Unblocked issues split into three groups:
   - **Leaf issues** — Actionable work items. Pick from here. Shows parent epic reference if applicable.
   - **Epics** — Parent issues with sub-issue progress (e.g., `2/5 done, 2 in progress`). Do not work on these directly — work on their sub-issues instead.
   - **Assigned to others** — Claimed by someone else. Do not recommend these.
3. **RECOMMENDED WORK ORDER** — Full topological sort. `>> READY` = can start now. `>> EPIC (progress)` = parent issue, work on sub-issues. `>> CLAIMED (Name)` = ready but assigned to someone else.
4. **EPIC BREAKDOWN** — Full parent→child hierarchy tree showing each root epic's sub-issues at all nesting levels (sub-issues of sub-issues, recursively), with status, assignee, and completion markers (`~>` edges, `✓` for done). Progress counts include all descendants, not just direct children.
5. **DEPENDENCY GRAPH** — Visual tree showing blocking chains (`->` edges).

## MANDATORY: Run the Script First

Before proposing, planning, or starting ANY work on Linear tickets, you MUST run the script and read its output. Do not plan work based on ticket titles or descriptions alone — the live dependency and status data is the source of truth.

## Picking the Next Task

**Hard rules — never violate:**

1. **NEVER propose work on IN PROGRESS issues.** Someone is already on them.
2. **NEVER propose work on DONE/CANCELED issues.**
3. **NEVER propose work marked `>> CLAIMED`** — someone else has dibs.
4. **NEVER propose working on an EPIC directly.** Items marked `>> EPIC` are parent issues — propose their unfinished sub-issues from the EPIC BREAKDOWN section instead.
5. **ONLY propose items marked `>> READY`** that are NOT in the IN PROGRESS section and NOT in the "Assigned to others" group.
6. If every READY item is also in progress or claimed, tell the user — nothing new to pick up.

**Prioritization (among eligible READY items):**

1. Prefer issues that **unblock the most downstream work** — critical path.
2. Within equal unblock counts, pick higher priority (Urgent > High > Normal > Low).
3. Note which READY items can be worked **in parallel** (no mutual dependencies).

## Common Mistakes

- **Planning without running the script.** Always run it first — status and dependencies change constantly.
- **Proposing in-progress work.** Check the IN PROGRESS section and exclude those issues.
- **Proposing claimed work.** Issues assigned to others are not available — check the "Assigned to others" subsection and exclude those too.
- **Proposing epic-level work.** Items in the "Epics" subsection are parent containers — propose their sub-issues from the EPIC BREAKDOWN section instead.
- **Auth errors.** If the script gets a 401, the user hasn't connected Linear. Direct them to `/settings/accounts`.
