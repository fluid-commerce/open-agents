#!/usr/bin/env node
import { LinearClient } from "@linear/sdk";

const TEAM_KEY = process.argv[2];
const TITLE = process.argv[3];
const DESCRIPTION = process.argv[4];

if (!TEAM_KEY || !TITLE) {
  console.error(
    "Usage: linear-create-issue.mjs <team-key> <title> [description]",
  );
  process.exit(2);
}

// Placeholder token — the sandbox network proxy replaces Authorization
// with the real Bearer token before the request leaves the VM.
const linear = new LinearClient({ accessToken: "sandbox-injected" });

try {
  const teams = await linear.teams({
    filter: { key: { eq: TEAM_KEY } },
  });
  const team = teams.nodes[0];
  if (!team) {
    console.error(`No team found with key "${TEAM_KEY}"`);
    process.exit(1);
  }

  const result = await linear.createIssue({
    teamId: team.id,
    title: TITLE,
    description: DESCRIPTION,
  });
  const issue = await result.issue;
  if (!issue) {
    console.error("Issue creation returned no issue object");
    process.exit(1);
  }

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
