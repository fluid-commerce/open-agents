---
name: linear
description: Use this when the user references Linear issues, tickets, projects, or wants to read/list/create/comment-on/update Linear work items. Triggers on issue identifiers (e.g. FCM-123), the words "ticket", "linear", "issue", or workflow state changes.
---

You can interact with Linear by calling its GraphQL API directly via `curl`.
Authentication is automatic — the sandbox network proxy replaces the `Authorization` header with the real token on any request to `api.linear.app`.

## Request pattern

```bash
curl -s https://api.linear.app/graphql \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer sandbox-injected' \
  -d '{"query": "<GRAPHQL>", "variables": {}}' | jq .data
```

Always use `Authorization: Bearer sandbox-injected` exactly — the proxy swaps it for the real token.

## Queries

### Fetch an issue by identifier

`issue(id:)` accepts both UUIDs and human-readable identifiers (e.g. `CURRENT-370`).

```graphql
{
  issue(id: "CURRENT-370") {
    id identifier title description url priority
    state { name type }
    assignee { displayName }
    labels { nodes { name } }
    team { key name }
    parent { identifier title }
    children { nodes { identifier title state { name type } } }
    relations { nodes { type relatedIssue { identifier title } } }
  }
}
```

### List issues assigned to the authenticated user

```graphql
{
  viewer {
    assignedIssues(
      filter: { state: { type: { nin: ["completed", "canceled"] } } }
      first: 50
      orderBy: updatedAt
    ) {
      nodes {
        identifier title url priority
        state { name type }
        team { key name }
      }
    }
  }
}
```

### Search issues with filters

```graphql
query($filter: IssueFilter) {
  issues(filter: $filter, first: 50, orderBy: updatedAt) {
    nodes {
      identifier title url priority
      state { name type }
      assignee { displayName }
    }
    pageInfo { hasNextPage endCursor }
  }
}
```

Filter examples (pass as `variables.filter`):
- By team: `{"team": {"name": {"containsIgnoreCase": "Engineering"}}}`
- By project: `{"project": {"id": {"eq": "<project-uuid>"}}}`
- By state type: `{"state": {"type": {"in": ["unstarted", "started"]}}}`
- Combine with `"and"` / `"or"` arrays

### Resolve a project by name

```graphql
{
  projects(filter: { name: { containsIgnoreCase: "My Project" } }, first: 10) {
    nodes { id name }
  }
}
```

### List teams

```graphql
{
  teams(first: 50) { nodes { id key name } }
}
```

## Mutations

### Create an issue

```graphql
mutation($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { identifier title url }
  }
}
```

Variables: `{"input": {"teamId": "<team-uuid>", "title": "Title", "description": "Details"}}`

Resolve the team UUID from the teams query above using the team key.

### Comment on an issue

```graphql
mutation($input: CommentCreateInput!) {
  commentCreate(input: $input) {
    success
    comment { id body }
  }
}
```

Variables: `{"input": {"issueId": "<issue-uuid>", "body": "Comment text"}}`

The `issueId` field requires the UUID, not the identifier. Fetch the issue first to get its `id`.

### Update workflow state

First, resolve the target state within the issue's team:

```graphql
{
  workflowStates(filter: { team: { key: { eq: "CURRENT" } } }, first: 50) {
    nodes { id name type }
  }
}
```

Then update:

```graphql
mutation {
  issueUpdate(id: "<issue-uuid>", input: { stateId: "<state-uuid>" }) {
    success
    issue { identifier state { name } }
  }
}
```

## Important notes

- **Identifiers vs UUIDs**: `issue(id:)` accepts identifiers like `CURRENT-370`. Most mutations require UUIDs — fetch the issue first to get its `id` field.
- **Pagination**: List queries return `pageInfo { hasNextPage endCursor }`. Pass `after: "<endCursor>"` for the next page.
- **Auth errors**: If you get a 401, the user hasn't connected Linear. Direct them to `/settings/accounts`.
- **Confirm before mutating**: Don't create or modify Linear data without the user's confirmation.
