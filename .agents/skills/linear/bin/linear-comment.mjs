#!/usr/bin/env node
import { LinearClient } from "@linear/sdk";

const ISSUE_ID = process.argv[2];
const BODY = process.argv[3];

if (!ISSUE_ID || !BODY) {
  console.error("Usage: linear-comment.mjs <issue-id> <body>");
  process.exit(2);
}

// Placeholder token — the sandbox network proxy replaces Authorization
// with the real Bearer token before the request leaves the VM.
const linear = new LinearClient({ accessToken: "sandbox-injected" });

try {
  const issue = await linear.issue(ISSUE_ID);
  const result = await linear.createComment({
    issueId: issue.id,
    body: BODY,
  });
  const comment = await result.comment;
  if (!comment) {
    console.error("Comment creation returned no comment object");
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        id: comment.id,
        body: comment.body,
        issueIdentifier: issue.identifier,
        url: comment.url,
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.error("Linear API error:", err.message ?? err);
  process.exit(1);
}
