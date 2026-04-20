---
name: linear-create
description: Create Linear epics and sub-issues on the Current team with blocking relations wired for /linear-triage dependency tracking. Use when creating new work items, breaking down features into tasks, or adding sub-issues to existing epics.
user-invocable: true
---

# Linear Issue Creator

Creates Linear issues following the epic + sub-issue pattern. Epics are product-level parent issues describing what to build and why. Sub-issues are technical tasks describing how. Blocking relations between issues drive dependency tracking via `/linear-triage`.

Two flows:
1. **Full flow** — Create a new epic with sub-issues
2. **Add sub-issues** — Add sub-issues to an existing epic

## Field Reference

All issues target the **Current** team. These values are exact — do not improvise alternatives.

### Epic (parent issue)

| Field | Value | Required |
|-------|-------|----------|
| `team` | `"Current"` | Yes |
| `state` | `"Cycle Epics"` | Yes |
| `labels` | `["EPIC"]` | Yes |
| `title` | `"Epic: <name>"` | Yes |
| `description` | Product-level (see Description Guide) | Yes |
| `project` | Ask the user which project | Yes |
| `assignee` | Ask the user who owns the epic | No |
| `priority` | Ask or infer (default: 3 = Normal) | No |
| `cycle` | Current active cycle (see Discovering the Current Cycle) | No |
| `estimate` | Ask if the user tracks estimates | No |
| `blocks` | Epic identifiers this blocks | Wire in Step 3 |
| `blockedBy` | Epic identifiers blocking this | Wire in Step 3 |

### Sub-issue (child task)

| Field | Value | Required |
|-------|-------|----------|
| `team` | `"Current"` | Yes |
| `state` | `"Todo"` | Yes |
| `labels` | None (do NOT add "EPIC") | - |
| `title` | Short technical task name | Yes |
| `description` | Technical implementation (see Description Guide) | Yes |
| `parentId` | The epic's identifier (e.g., `"CURRENT-82"`) | Yes |
| `project` | Same project as the parent epic | Yes |
| `assignee` | Ask the user, or leave unset | No |
| `priority` | Ask or infer (default: 3 = Normal) | No |
| `cycle` | Same cycle as the parent epic | No |
| `estimate` | Ask if the user tracks estimates | No |
| `blocks` | Sibling sub-issue identifiers this blocks | Wire in Step 5 |
| `blockedBy` | Sibling sub-issue identifiers blocking this | Wire in Step 5 |

### Discovering the current cycle

Resolve the team UUID first, then query for the active cycle:

```bash
# 1. Find the "Current" team UUID
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ teams(filter: { name: { eq: \"Current\" } }, first: 1) { nodes { id name } } }"}' | jq .data.teams.nodes

# 2. Get the active cycle for that team
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "query($teamId: String!) { cycles(filter: { team: { id: { eq: $teamId } }, isActive: { eq: true } }, first: 1) { nodes { id number name startsAt endsAt } } }", "variables": {"teamId": "<team-uuid>"}}' | jq .data.cycles.nodes
```

Use the cycle's `id` when setting the `cycle` field on issues.

## Description Guide

### Epic descriptions (product-level)

Explain **what** the feature is and **why** it matters. Do not describe implementation.

Structure:
1. **Problem** — What user pain or business need does this address?
2. **Solution** — What does the feature do, from the user's perspective?
3. **Success criteria** — How do we know it's done? (observable outcomes, not code)
4. **Scope boundaries** — What is explicitly out of scope?

Example:

> ## Problem
>
> Reps cannot see which products are eligible for promotional pricing without switching between three different screens, leading to missed upsell opportunities.
>
> ## Solution
>
> Surface promotional pricing eligibility directly on the product card in the rep's active order view, with a visual indicator and one-click apply action.
>
> ## Success criteria
>
> - Reps can see promo eligibility on every product card without navigating away
> - Applying a promo takes one click from the product card
> - Promo pricing is reflected in the order total immediately
>
> ## Out of scope
>
> Promo creation/management UI, bulk promo application, historical promo reporting.

### Sub-issue descriptions (technical)

Explain **how** to implement and **how to verify**. Be specific about code locations and behavior.

Structure:
1. **Summary** — What changes and why in 1-2 sentences
2. **What to change** — Files, modules, APIs, or components affected
3. **Implementation notes** — Key technical decisions or constraints
4. **Acceptance criteria** — Testable assertions (checkbox style)

Example:

> ## Summary
>
> Add a promo eligibility badge to the product card using the existing BFF endpoint and design system badge component.
>
> ## What to change
>
> `OrderProductCard` component, `usePromoEligibility` hook (new), `promo-api.ts` client
>
> ## Implementation notes
>
> - Promo eligibility endpoint already exists (`GET /api/promos/eligible?productId=X&orderId=Y`) — add a React Query hook to call it
> - Badge component from the design system (`PromoBadge`) can be reused
> - Must not add a network request per card — batch eligible product IDs in a single call at the order level
>
> ## Acceptance criteria
>
> - [ ] Product cards in active order view show a promo badge when eligible
> - [ ] Clicking "Apply Promo" on a card applies the promo and updates the order total
> - [ ] Cards with no eligible promos show no badge (no empty state)
> - [ ] Promo eligibility loads in a single batched request, not per-card

## Flow 1: Create Epic with Sub-issues

### Step 1: Gather information

Ask the user for:
- **What** they want to build (the product requirement)
- **Which project** it belongs to — query projects to help them pick if unsure:
  ```bash
  curl -s https://api.linear.app/graphql \
    -H 'Content-Type: application/json' \
    -H 'Authorization: Bearer sandbox-injected' \
    -d '{"query": "{ projects(first: 50, orderBy: updatedAt) { nodes { id name } } }"}' | jq .data.projects.nodes
  ```
- **Who owns it** — the assignee responsible for the epic
- **Priority** — if not stated, default to Normal (3)

### Step 2: Discover existing epics

Before creating anything, fetch existing active epics to understand the dependency landscape:

```bash
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ issues(filter: { team: { name: { eq: \"Current\" } }, labels: { name: { eq: \"EPIC\" } }, state: { name: { eq: \"Cycle Epics\" } } }, first: 50) { nodes { id identifier title state { name } relations { nodes { type relatedIssue { identifier title } } } } } }"}' | jq .data.issues.nodes
```

Present the list to the user and ask:
- "Does this new epic **depend on** (is blocked by) any of these?"
- "Does this new epic **block** any of these?"

If the user is unsure, help them reason about it: if Epic A must be finished before Epic B can start, then B is `blockedBy` A (equivalently, A `blocks` B).

### Step 3: Create the epic

Create the epic via GraphQL mutation with all required fields from the Field Reference. You'll need the team UUID, project UUID, label UUID, and workflow state UUID resolved beforehand.

**Resolve required UUIDs:**

```bash
# Get team UUID for "Current"
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ teams(filter: { name: { eq: \"Current\" } }, first: 1) { nodes { id key name } } }"}' | jq .data.teams.nodes

# Get workflow state UUID for "Cycle Epics" on the Current team
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ workflowStates(filter: { team: { name: { eq: \"Current\" } }, name: { eq: \"Cycle Epics\" } }, first: 1) { nodes { id name } } }"}' | jq .data.workflowStates.nodes

# Get label UUID for "EPIC"
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ issueLabels(filter: { name: { eq: \"EPIC\" } }, first: 1) { nodes { id name } } }"}' | jq .data.issueLabels.nodes
```

**Create the epic:**

```bash
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }", "variables": {"input": {"teamId": "<team-uuid>", "stateId": "<state-uuid>", "labelIds": ["<label-uuid>"], "projectId": "<project-uuid>", "title": "Epic: <name>", "description": "<description>", "priority": 3}}}' | jq .data.issueCreate
```

Include `blocks` and/or `blockedBy` relation wiring after creation (see Step 5 for the relation mutation pattern).

Record the returned identifier (e.g., `CURRENT-95`) and UUID — sub-issues need the UUID as `parentId`.

### Step 4: Break down into sub-issues

Analyze the epic's scope and propose technical sub-issues. For each:
- Write a short, specific title (not "Implement feature" — name the specific component, endpoint, or module)
- Write a technical description following the Description Guide
- Identify dependencies between sub-issues

Present the proposed breakdown to the user for approval before creating. Include:
- Titles and brief descriptions
- Dependency ordering (which blocks which)
- Any sub-issues that can be worked in parallel

### Step 5: Wire sub-issue dependencies

Before creating sub-issues, map out their internal dependency order:
- Which sub-issues must be done before others can start?
- Which can be worked in parallel?

Express this as `blocks`/`blockedBy` relations between sibling sub-issues.

### Step 6: Create sub-issues

Create each sub-issue via GraphQL mutation. Set `parentId` to the epic's UUID (not the identifier). Use the "Todo" workflow state.

```bash
# Get workflow state UUID for "Todo" on the Current team
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ workflowStates(filter: { team: { name: { eq: \"Current\" } }, name: { eq: \"Todo\" } }, first: 1) { nodes { id name } } }"}' | jq .data.workflowStates.nodes

# Create a sub-issue
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }", "variables": {"input": {"teamId": "<team-uuid>", "stateId": "<todo-state-uuid>", "parentId": "<epic-uuid>", "projectId": "<project-uuid>", "title": "<title>", "description": "<description>", "priority": 3}}}' | jq .data.issueCreate
```

**Wire blocking relations** between sub-issues after creation:

```bash
# Create a "blocks" relation: issueA blocks issueB
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "mutation($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }", "variables": {"input": {"issueId": "<issueA-uuid>", "relatedIssueId": "<issueB-uuid>", "type": "blocks"}}}' | jq .data.issueRelationCreate
```

**Create in dependency order** — blockers first, so their UUIDs are available for relation wiring on later issues.

### Step 7: Verify with /linear-triage

Run `/linear-triage` against the project to confirm:
- The epic appears in EPIC BREAKDOWN with all sub-issues listed
- Blocking relations appear correctly in the DEPENDENCY GRAPH
- The RECOMMENDED WORK ORDER reflects the intended sequencing

If anything looks wrong, fix relations using the `issueRelationCreate` mutation or update issues with `issueUpdate`.

## Flow 2: Add Sub-issues to Existing Epic

### Step 1: Identify the target epic

The user provides an epic identifier (e.g., `CURRENT-82`). Fetch it with its relations:

```bash
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "{ issue(id: \"CURRENT-82\") { id identifier title description url state { name } team { id key } project { id name } relations { nodes { type relatedIssue { identifier title } } } children { nodes { id identifier title state { name type } assignee { displayName } relations { nodes { type relatedIssue { identifier title } } } } } } }"}' | jq .data.issue
```

Review their titles, statuses, and blocking relations to understand what work already exists and where new sub-issues fit.

Present the existing breakdown to the user: "This epic currently has these sub-issues: [list with status]. What additional work needs to be added?"

### Step 3: Propose new sub-issues

Based on the user's request and the existing sub-issues, propose new sub-issues. For each, identify:
- Does it depend on any **existing** sub-issue? (`blockedBy`)
- Does any **existing** sub-issue depend on it? (`blocks`)
- Dependencies among the **new** sub-issues themselves

Present the plan to the user for approval.

### Step 4: Create and wire

Create each new sub-issue via GraphQL mutation (same pattern as Flow 1 Step 6). Set `parentId` to the epic's UUID. Wire blocking relations to both existing and new sibling issues using `issueRelationCreate`.

**Note:** Relations are append-only. Creating a `blocks` relation on a new issue adds it without disturbing existing relations on the target issue.

### Step 5: Verify with /linear-triage

Same as Flow 1 Step 7. Run `/linear-triage` on the project and confirm the updated epic breakdown and dependency graph look correct.

## Hard Rules

1. **ALWAYS use team `"Current"`** for every issue. Never create issues on other teams.
2. **ALWAYS set epic status to `"Cycle Epics"`** and label to `["EPIC"]`. No exceptions.
3. **ALWAYS set sub-issue status to `"Todo"`**. Never set sub-issues to "Cycle Epics" or any other status.
4. **ALWAYS prefix epic titles with `"Epic: "`**. Sub-issues never get this prefix.
5. **NEVER add the `"EPIC"` label to sub-issues.** Only epics get it.
6. **NEVER create an epic without checking blocking relations.** Fetch existing epics and ask the user. An epic with no relations is almost always a mistake — at minimum confirm with the user that it truly has no dependencies.
7. **NEVER create sub-issues without `parentId`.** Every sub-issue must be parented to its epic.
8. **NEVER skip verification.** Always run `/linear-triage` after creating issues to confirm the dependency graph is correct.
9. **ALWAYS create in dependency order.** When creating a set of sub-issues where A blocks B, create A first so its identifier is available for B's `blockedBy` field.
10. **ALWAYS present the plan before creating.** Show proposed titles, descriptions, and blocking relations to the user and get explicit approval before creating issues.

## Common Mistakes

- **Forgetting blocking relations between epics.** Every new epic should be checked against existing epics for dependencies. Query for issues with the `EPIC` label and `Cycle Epics` state first.
- **Setting wrong status.** Epics get `"Cycle Epics"`, sub-issues get `"Todo"`. Mixing these up breaks the board layout and `/linear-triage` categorization.
- **Vague sub-issue titles.** "Backend work" or "Frontend changes" are not actionable. Each sub-issue should name a specific component, endpoint, or module.
- **Product language in sub-issue descriptions.** Sub-issues are for engineers. Describe files, APIs, and testable behavior — not user stories.
- **Technical language in epic descriptions.** Epics are for product alignment. Describe the user problem and outcome — not the implementation approach.
- **Creating sub-issues without checking existing ones.** When adding to an existing epic, always fetch current children first to avoid duplicates and properly wire dependencies.
- **Skipping `/linear-triage` verification.** The whole point of wiring relations is to feed the dependency resolver. If you don't verify, you can't catch wiring mistakes.

## Relationship with /linear-triage

This skill creates issues. `/linear-triage` reads them. They form a create-then-verify loop:

1. `/linear-create` creates epics and sub-issues with blocking relations
2. `/linear-triage` analyzes those relations to produce work order and dependency graphs
3. If `/linear-triage` output doesn't match intent, come back and fix relations with `issueRelationCreate`/`issueUpdate` mutations

The blocking relations (`blocks`/`blockedBy`) are the critical data that connects the two skills. Without them, `/linear-triage` cannot determine work order, and issues appear as unrelated items with no prioritization signal.

**What `/linear-triage` expects:**
- Epics have children (sub-issues with `parentId` set) — shown in EPIC BREAKDOWN
- Issues have `blocks`/`blockedBy` relations — shown in DEPENDENCY GRAPH and used for topological sort
- Statuses are from the Current team's workflow — used for in-progress/done/canceled filtering
