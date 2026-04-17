#!/usr/bin/env node
import { LinearClient } from "@linear/sdk";

// Placeholder token — the sandbox network proxy replaces Authorization
// with the real Bearer token before the request leaves the VM.
const linear = new LinearClient({ accessToken: "sandbox-injected" });

try {
  const me = await linear.viewer;
  const { nodes } = await me.assignedIssues();
  const summaries = await Promise.all(
    nodes.map(async (issue) => {
      const [state, assignee] = await Promise.all([
        issue.state,
        issue.assignee,
      ]);
      return {
        identifier: issue.identifier,
        title: issue.title,
        state: state?.name,
        assignee: assignee?.displayName,
        url: issue.url,
      };
    }),
  );
  console.log(JSON.stringify(summaries, null, 2));
} catch (err) {
  console.error("Linear API error:", err.message ?? err);
  process.exit(1);
}
