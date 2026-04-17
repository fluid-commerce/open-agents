#!/usr/bin/env node
import { LinearClient } from "@linear/sdk";

const ISSUE_ID = process.argv[2];
const STATE_NAME = process.argv[3];

if (!ISSUE_ID || !STATE_NAME) {
  console.error("Usage: linear-update-state.mjs <issue-id> <state-name>");
  process.exit(2);
}

// Placeholder token — the sandbox network proxy replaces Authorization
// with the real Bearer token before the request leaves the VM.
const linear = new LinearClient({ accessToken: "sandbox-injected" });

try {
  const issue = await linear.issue(ISSUE_ID);
  const team = await issue.team;
  if (!team) {
    console.error(`Could not resolve team for issue "${ISSUE_ID}"`);
    process.exit(1);
  }

  const states = await team.states();
  const targetState = states.nodes.find(
    (s) => s.name.toLowerCase() === STATE_NAME.toLowerCase(),
  );
  if (!targetState) {
    const available = states.nodes.map((s) => s.name).join(", ");
    console.error(
      `No workflow state "${STATE_NAME}" found for team "${team.key}". Available states: ${available}`,
    );
    process.exit(1);
  }

  await issue.update({ stateId: targetState.id });

  console.log(
    JSON.stringify(
      {
        identifier: issue.identifier,
        title: issue.title,
        previousState: (await issue.state)?.name,
        newState: targetState.name,
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
