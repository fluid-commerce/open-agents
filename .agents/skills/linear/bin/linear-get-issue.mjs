#!/usr/bin/env node
import { LinearClient } from "@linear/sdk";

const ISSUE_ID = process.argv[2];
if (!ISSUE_ID) {
  console.error("Usage: linear-get-issue.mjs <issue-id>");
  process.exit(2);
}

// Placeholder token — the sandbox network proxy replaces Authorization
// with the real Bearer token before the request leaves the VM.
const linear = new LinearClient({ accessToken: "sandbox-injected" });

try {
  const issue = await linear.issue(ISSUE_ID);
  const [state, assignee] = await Promise.all([issue.state, issue.assignee]);
  console.log(
    JSON.stringify(
      {
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        state: state?.name,
        assignee: assignee?.displayName,
        url: issue.url,
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error("Linear API error:", err.message ?? err);
  process.exit(1);
}
