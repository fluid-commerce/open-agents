#!/usr/bin/env node
/**
 * linear-triage.mjs — Fetch Linear project issues + relations via GraphQL,
 * build a dependency graph, and output a prioritized work order.
 *
 * Usage:
 *   node linear-triage.mjs --project "My Project"
 *   node linear-triage.mjs --project "My Project" --format=json
 *   node linear-triage.mjs --team "Engineering" --state "unstarted,started"
 *
 * Auth: Uses sandbox-injected OAuth token via network proxy.
 * Falls back to LINEAR_API_KEY env var for local development.
 *
 * One GraphQL query fetches everything. No extra round-trips. No token waste.
 */

// --- Args + config ---------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

const projectFilter = getArg("project");
const teamFilter = getArg("team");
const stateFilter = getArg("state"); // comma-separated state names
const formatJson = args.includes("--format=json");
const apiKey = process.env.LINEAR_API_KEY || "Bearer sandbox-injected";

if (!projectFilter && !teamFilter) {
  console.error("Usage: node linear-triage.mjs --project <name|id> [--team <name>] [--state <states>] [--format=json]");
  console.error("  At least --project or --team is required.");
  process.exit(1);
}

// --- GraphQL ---------------------------------------------------------------

const LINEAR_API = "https://api.linear.app/graphql";

async function gql(query, variables = {}) {
  const authHeader = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Linear API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// --- Fetch authenticated user (viewer) -------------------------------------

async function fetchViewer() {
  const data = await gql(`query { viewer { id name } }`);
  return data.viewer;
}

// --- Fetch project ID if filtering by name ---------------------------------

async function resolveProjectId(nameOrId) {
  const data = await gql(`
    query($filter: ProjectFilter) {
      projects(filter: $filter, first: 50) {
        nodes {
          id
          name
          slugId
        }
      }
    }
  `, {
    filter: {
      or: [
        { name: { containsIgnoreCase: nameOrId } },
        { slugId: { eq: nameOrId } },
      ],
    },
  });

  const projects = data.projects.nodes;
  if (projects.length === 0) {
    return nameOrId;
  }
  const exact = projects.find(
    (p) => p.name.toLowerCase() === nameOrId.toLowerCase()
  );
  return exact ? exact.id : projects[0].id;
}

// --- Fetch all issues with relations in one query --------------------------

async function fetchIssues(projectId) {
  let allIssues = [];
  let hasMore = true;
  let cursor = null;

  const filter = { project: { id: { eq: projectId } } };
  if (teamFilter) {
    filter.team = { name: { containsIgnoreCase: teamFilter } };
  }

  while (hasMore) {
    const data = await gql(`
      query($filter: IssueFilter, $cursor: String) {
        issues(
          filter: $filter
          first: 100
          after: $cursor
          orderBy: updatedAt
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            identifier
            title
            priority
            estimate
            assignee { name }
            state { name type }
            parent { id identifier }
            children { nodes { id identifier state { name type } } }
            relations {
              nodes {
                type
                relatedIssue {
                  id
                  identifier
                }
              }
            }
          }
        }
      }
    `, { filter, cursor });

    const page = data.issues;
    allIssues.push(...page.nodes);
    hasMore = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return allIssues;
}

async function fetchIssuesByTeam(teamName) {
  let allIssues = [];
  let hasMore = true;
  let cursor = null;

  const teamData = await gql(`
    query($filter: TeamFilter) {
      teams(filter: $filter, first: 1) {
        nodes { id name }
      }
    }
  `, { filter: { name: { containsIgnoreCase: teamName } } });

  const team = teamData.teams.nodes[0];
  if (!team) {
    throw new Error(`Team not found: ${teamName}`);
  }

  const filter = { team: { id: { eq: team.id } } };
  if (stateFilter) {
    const stateNames = stateFilter.split(",").map((s) => s.trim());
    filter.state = { type: { in: stateNames } };
  }

  while (hasMore) {
    const data = await gql(`
      query($filter: IssueFilter, $cursor: String) {
        issues(
          filter: $filter
          first: 100
          after: $cursor
          orderBy: updatedAt
        ) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            identifier
            title
            priority
            estimate
            assignee { name }
            state { name type }
            parent { id identifier }
            children { nodes { id identifier state { name type } } }
            relations {
              nodes {
                type
                relatedIssue {
                  id
                  identifier
                }
              }
            }
          }
        }
      }
    `, { filter, cursor });

    const page = data.issues;
    allIssues.push(...page.nodes);
    hasMore = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }

  return allIssues;
}

// --- Fetch specific issues by ID (for cross-project children) --------------

async function fetchIssuesByIds(ids) {
  if (ids.length === 0) return [];
  const allIssues = [];

  // Batch in groups of 50 to avoid query size limits
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const data = await gql(`
      query($filter: IssueFilter) {
        issues(filter: $filter, first: 50) {
          nodes {
            id
            identifier
            title
            priority
            estimate
            assignee { name }
            state { name type }
            parent { id identifier }
            children { nodes { id identifier state { name type } } }
            relations {
              nodes {
                type
                relatedIssue {
                  id
                  identifier
                }
              }
            }
          }
        }
      }
    `, { filter: { id: { in: batch } } });
    allIssues.push(...data.issues.nodes);
  }

  return allIssues;
}

// --- Build graph -----------------------------------------------------------

function buildGraph(rawIssues) {
  const issueMap = new Map();
  const blockedByGraph = new Map();
  const blocksGraph = new Map();

  // First pass: build issue objects with GraphQL child IDs saved separately
  const graphqlChildIds = new Map(); // issueId -> Set of child IDs from GraphQL

  for (const raw of rawIssues) {
    const issue = {
      id: raw.id,
      identifier: raw.identifier,
      title: raw.title,
      state: raw.state?.name,
      stateType: raw.state?.type,
      priority: raw.priority,
      assignee: raw.assignee?.name,
      estimate: raw.estimate,
      parentId: raw.parent?.id || null,
      parentIdentifier: raw.parent?.identifier || null,
      children: [], // will be rebuilt from parentId relationships
    };

    // Save original GraphQL child IDs for missing-child detection
    const rawChildren = raw.children?.nodes || [];
    graphqlChildIds.set(raw.id, new Set(rawChildren.map((c) => c.id)));

    issueMap.set(raw.id, issue);
    blockedByGraph.set(raw.id, new Set());
    blocksGraph.set(raw.id, new Set());
  }

  // Second pass: rebuild children arrays from parentId relationships
  for (const [, issue] of issueMap) {
    if (issue.parentId && issueMap.has(issue.parentId)) {
      const parent = issueMap.get(issue.parentId);
      parent.children.push({
        id: issue.id,
        identifier: issue.identifier,
        state: issue.state,
        stateType: issue.stateType,
      });
    }
  }

  // Detect children referenced by GraphQL but not in our fetched set
  const missingChildIds = new Set();
  for (const [, childIds] of graphqlChildIds) {
    for (const childId of childIds) {
      if (!issueMap.has(childId)) {
        missingChildIds.add(childId);
      }
    }
  }

  for (const raw of rawIssues) {
    const relations = raw.relations?.nodes || [];
    for (const rel of relations) {
      const relatedId = rel.relatedIssue?.id;
      if (!relatedId) continue;

      const type = rel.type;

      if (type === "blocks") {
        blocksGraph.get(raw.id)?.add(relatedId);
        if (blockedByGraph.has(relatedId)) {
          blockedByGraph.get(relatedId).add(raw.id);
        }
      } else if (type === "blockedBy") {
        blockedByGraph.get(raw.id)?.add(relatedId);
        if (blocksGraph.has(relatedId)) {
          blocksGraph.get(relatedId).add(raw.id);
        }
      }
    }
  }

  return { issueMap, blockedByGraph, blocksGraph, missingChildIds: [...missingChildIds] };
}

// --- Topological sort (Kahn's algorithm) -----------------------------------

function topologicalSort(issueMap, blockedByGraph, blocksGraph) {
  const inDegree = new Map();
  for (const id of issueMap.keys()) {
    const blockers = blockedByGraph.get(id) || new Set();
    const relevant = [...blockers].filter((b) => issueMap.has(b));
    inDegree.set(id, relevant.length);
  }

  const sortByPriority = (a, b) => {
    const issueA = issueMap.get(a);
    const issueB = issueMap.get(b);
    const priA = issueA?.priority ?? 4;
    const priB = issueB?.priority ?? 4;
    if (priA !== priB) return priA - priB;
    const estA = issueA?.estimate ?? 999;
    const estB = issueB?.estimate ?? 999;
    return estA - estB;
  };

  const queue = [...inDegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort(sortByPriority);

  const sorted = [];
  const visited = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);
    sorted.push(current);

    const blocking = blocksGraph.get(current) || new Set();
    const newlyReady = [];
    for (const dep of blocking) {
      if (!issueMap.has(dep) || visited.has(dep)) continue;
      const newDeg = (inDegree.get(dep) || 1) - 1;
      inDegree.set(dep, newDeg);
      if (newDeg === 0) newlyReady.push(dep);
    }
    newlyReady.sort(sortByPriority);
    queue.push(...newlyReady);
    queue.sort(sortByPriority);
  }

  const cycled = [...issueMap.keys()].filter((id) => !visited.has(id));
  return { sorted, cycled };
}

// --- Output helpers --------------------------------------------------------

const COMPLETED_TYPES = new Set(["completed", "canceled"]);

function isCompleted(issue) {
  return COMPLETED_TYPES.has(issue?.stateType);
}

function isInProgress(issue) {
  return issue?.stateType === "started";
}

function priorityLabel(p) {
  return { 0: "None", 1: "Urgent", 2: "High", 3: "Normal", 4: "Low" }[p] || "?";
}

function label(issue) {
  return `${issue.identifier}: ${issue.title || "Untitled"}`;
}

function isAssignedToOther(issue, viewer) {
  return issue.assignee && issue.assignee !== viewer.name;
}

function isParent(issue) {
  return issue.children && issue.children.length > 0;
}

function isRootParent(issue, issueMap) {
  return isParent(issue) && (!issue.parentId || !issueMap.has(issue.parentId));
}

function getAllDescendants(issueId, issueMap, seen = new Set()) {
  if (seen.has(issueId)) return [];
  seen.add(issueId);
  const issue = issueMap.get(issueId);
  if (!issue) return [];

  const descendants = [];
  for (const child of issue.children) {
    const childIssue = issueMap.get(child.id);
    if (childIssue) {
      descendants.push(childIssue);
      descendants.push(...getAllDescendants(child.id, issueMap, seen));
    }
  }
  return descendants;
}

function childProgress(issue, issueMap) {
  if (!isParent(issue)) return "";
  const descendants = getAllDescendants(issue.id, issueMap);
  const total = descendants.length;
  if (total === 0) return "";
  const done = descendants.filter((d) => COMPLETED_TYPES.has(d.stateType)).length;
  const inProg = descendants.filter((d) => d.stateType === "started").length;
  const parts = [`${done}/${total} done`];
  if (inProg > 0) parts.push(`${inProg} in progress`);
  return ` (${parts.join(", ")})`;
}

// --- Main ------------------------------------------------------------------

async function main() {
  const viewer = await fetchViewer();

  let rawIssues;
  if (projectFilter) {
    const projectId = await resolveProjectId(projectFilter);
    rawIssues = await fetchIssues(projectId);
  } else {
    rawIssues = await fetchIssuesByTeam(teamFilter);
  }

  if (stateFilter && projectFilter) {
    const allowed = new Set(stateFilter.split(",").map((s) => s.trim().toLowerCase()));
    rawIssues = rawIssues.filter(
      (i) => allowed.has(i.state?.type?.toLowerCase()) || allowed.has(i.state?.name?.toLowerCase())
    );
  }

  if (rawIssues.length === 0) {
    console.error("No issues found matching your filters.");
    process.exit(0);
  }

  let graphResult = buildGraph(rawIssues);

  // Fetch any children that live outside the initial project/team filter
  if (graphResult.missingChildIds.length > 0) {
    const extraIssues = await fetchIssuesByIds(graphResult.missingChildIds);
    if (extraIssues.length > 0) {
      rawIssues.push(...extraIssues);
      graphResult = buildGraph(rawIssues);
    }
  }

  const { issueMap, blockedByGraph, blocksGraph } = graphResult;
  const { sorted, cycled } = topologicalSort(issueMap, blockedByGraph, blocksGraph);

  const unblockedIds = [];
  for (const [id, issue] of issueMap) {
    if (isCompleted(issue)) continue;
    const blockers = [...(blockedByGraph.get(id) || [])].filter((b) => {
      const blocker = issueMap.get(b);
      return blocker && !isCompleted(blocker);
    });
    if (blockers.length === 0) unblockedIds.push(id);
  }

  if (formatJson) {
    function buildChildrenJson(issue, seen = new Set()) {
      if (seen.has(issue.id)) return [];
      seen.add(issue.id);
      return issue.children.map((c) => {
        const childIssue = issueMap.get(c.id);
        return {
          identifier: childIssue?.identifier || c.identifier,
          state: childIssue?.state || c.state,
          stateType: childIssue?.stateType || c.stateType,
          children: childIssue ? buildChildrenJson(childIssue, new Set(seen)) : [],
        };
      });
    }

    const result = {
      workOrder: sorted.filter((id) => !isCompleted(issueMap.get(id))).map((id, idx) => {
        const issue = issueMap.get(id);
        const blockers = [...(blockedByGraph.get(id) || [])].filter((b) => issueMap.has(b) && !isCompleted(issueMap.get(b)));
        const blocking = [...(blocksGraph.get(id) || [])].filter((b) => issueMap.has(b) && !isCompleted(issueMap.get(b)));
        return {
          order: idx + 1,
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          state: issue.state,
          stateType: issue.stateType,
          priority: issue.priority,
          priorityLabel: priorityLabel(issue.priority),
          assignee: issue.assignee,
          estimate: issue.estimate,
          blockedBy: blockers.map((b) => issueMap.get(b)?.identifier || b),
          blocks: blocking.map((b) => issueMap.get(b)?.identifier || b),
          isReady: unblockedIds.includes(id),
          isInProgress: isInProgress(issue),
          isAssignedToOther: isAssignedToOther(issue, viewer),
          isParent: isParent(issue),
          isRootParent: isRootParent(issue, issueMap),
          parentIdentifier: issue.parentIdentifier,
          children: buildChildrenJson(issue),
        };
      }),
      viewer: viewer.name,
      inProgress: [...issueMap.values()].filter(isInProgress).map((i) => i.identifier),
      readyToWork: unblockedIds
        .filter((id) => !isInProgress(issueMap.get(id)) && !isAssignedToOther(issueMap.get(id), viewer))
        .map((id) => issueMap.get(id)?.identifier || id),
      readyButAssigned: unblockedIds
        .filter((id) => !isInProgress(issueMap.get(id)) && isAssignedToOther(issueMap.get(id), viewer))
        .map((id) => {
          const issue = issueMap.get(id);
          return { identifier: issue?.identifier || id, assignee: issue?.assignee };
        }),
      cycles: cycled.map((id) => issueMap.get(id)?.identifier || id),
      summary: {
        total: issueMap.size,
        inProgress: [...issueMap.values()].filter(isInProgress).length,
        readyLeaf: unblockedIds.filter((id) => !isInProgress(issueMap.get(id)) && !isAssignedToOther(issueMap.get(id), viewer) && !isParent(issueMap.get(id))).length,
        readyEpics: unblockedIds.filter((id) => !isInProgress(issueMap.get(id)) && !isAssignedToOther(issueMap.get(id), viewer) && isParent(issueMap.get(id))).length,
        claimedByOthers: unblockedIds.filter((id) => !isInProgress(issueMap.get(id)) && isAssignedToOther(issueMap.get(id), viewer)).length,
        blocked: issueMap.size - unblockedIds.length - [...issueMap.values()].filter(isCompleted).length - cycled.length,
        completed: [...issueMap.values()].filter(isCompleted).length,
        inCycle: cycled.length,
      },
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable output
  const completedCount = [...issueMap.values()].filter(isCompleted).length;
  const inProgressIds = [...issueMap.entries()]
    .filter(([, issue]) => isInProgress(issue))
    .map(([id]) => id);
  const claimedCount = unblockedIds.filter((id) => !isInProgress(issueMap.get(id)) && isAssignedToOther(issueMap.get(id), viewer)).length;
  const epicReadyCount = unblockedIds.filter((id) => !isInProgress(issueMap.get(id)) && !isAssignedToOther(issueMap.get(id), viewer) && isParent(issueMap.get(id))).length;
  const leafReadyCount = unblockedIds.filter((id) => !isInProgress(issueMap.get(id)) && !isAssignedToOther(issueMap.get(id), viewer) && !isParent(issueMap.get(id))).length;
  const blockedCount = issueMap.size - unblockedIds.length - completedCount - cycled.length;

  console.log("=".repeat(60));
  console.log("  LINEAR TASK DEPENDENCY ANALYSIS");
  console.log("=".repeat(60));
  console.log();
  const readyStr = epicReadyCount > 0 ? `Ready: ${leafReadyCount} + ${epicReadyCount} epics` : `Ready: ${leafReadyCount}`;
  console.log(`Total: ${issueMap.size} | In Progress: ${inProgressIds.length} | ${readyStr}${claimedCount ? ` (${claimedCount} claimed)` : ""} | Blocked: ${blockedCount} | Done: ${completedCount}${cycled.length ? ` | Cycles: ${cycled.length}` : ""}`);
  console.log();

  if (inProgressIds.length > 0) {
    console.log("-".repeat(60));
    console.log("  IN PROGRESS");
    console.log("-".repeat(60));
    for (const id of inProgressIds) {
      const issue = issueMap.get(id);
      const pri = priorityLabel(issue.priority);
      const assignee = issue.assignee ? ` (${issue.assignee})` : "";
      const blocking = [...(blocksGraph.get(id) || [])].filter((b) => issueMap.has(b) && !isCompleted(issueMap.get(b)));
      const state = issue.state ? ` {${issue.state}}` : "";
      const parentStr = issue.parentIdentifier ? ` (parent: ${issue.parentIdentifier})` : "";
      const blockingStr = blocking.length > 0
        ? ` [unblocks: ${blocking.map((b) => issueMap.get(b)?.identifier || b).join(", ")}]`
        : "";
      console.log(`  [${pri}] ${label(issue)}${state}${assignee}${parentStr}${blockingStr}`);
    }
    console.log();
  }

  console.log("-".repeat(60));
  console.log(`  READY TO WORK (unblocked, not in progress) — viewer: ${viewer.name}`);
  console.log("-".repeat(60));
  const allReadyIssues = unblockedIds
    .filter((id) => !isInProgress(issueMap.get(id)))
    .sort((a, b) => {
      const priA = issueMap.get(a)?.priority ?? 4;
      const priB = issueMap.get(b)?.priority ?? 4;
      return priA - priB;
    });

  const myReadyLeaf = allReadyIssues.filter((id) => !isAssignedToOther(issueMap.get(id), viewer) && !isParent(issueMap.get(id)));
  const myReadyEpics = allReadyIssues.filter((id) => !isAssignedToOther(issueMap.get(id), viewer) && isParent(issueMap.get(id)));
  const othersReadyIssues = allReadyIssues.filter((id) => isAssignedToOther(issueMap.get(id), viewer));

  if (myReadyLeaf.length === 0) {
    console.log("  (no leaf issues available for you)");
  } else {
    for (const id of myReadyLeaf) {
      const issue = issueMap.get(id);
      const blocking = [...(blocksGraph.get(id) || [])].filter((b) => issueMap.has(b) && !isCompleted(issueMap.get(b)));
      const state = issue.state ? ` {${issue.state}}` : "";
      const unblockStr = blocking.length > 0
        ? ` [unblocks: ${blocking.map((b) => issueMap.get(b)?.identifier || b).join(", ")}]`
        : "";
      const assigneeStr = issue.assignee ? ` (${issue.assignee})` : "";
      const parentStr = issue.parentIdentifier ? ` (parent: ${issue.parentIdentifier})` : "";
      console.log(`  [${priorityLabel(issue.priority)}] ${label(issue)}${state}${assigneeStr}${parentStr}${unblockStr}`);
    }
  }

  if (myReadyEpics.length > 0) {
    console.log();
    console.log("  Epics (work on sub-issues, not the epic directly):");
    for (const id of myReadyEpics) {
      const issue = issueMap.get(id);
      const blocking = [...(blocksGraph.get(id) || [])].filter((b) => issueMap.has(b) && !isCompleted(issueMap.get(b)));
      const state = issue.state ? ` {${issue.state}}` : "";
      const progress = childProgress(issue, issueMap);
      const unblockStr = blocking.length > 0
        ? ` [unblocks: ${blocking.map((b) => issueMap.get(b)?.identifier || b).join(", ")}]`
        : "";
      console.log(`  [${priorityLabel(issue.priority)}] ${label(issue)}${state}${progress}${unblockStr}`);
    }
  }

  if (othersReadyIssues.length > 0) {
    console.log();
    console.log("  Assigned to others (unblocked but claimed):");
    for (const id of othersReadyIssues) {
      const issue = issueMap.get(id);
      const blocking = [...(blocksGraph.get(id) || [])].filter((b) => issueMap.has(b) && !isCompleted(issueMap.get(b)));
      const state = issue.state ? ` {${issue.state}}` : "";
      const unblockStr = blocking.length > 0
        ? ` [unblocks: ${blocking.map((b) => issueMap.get(b)?.identifier || b).join(", ")}]`
        : "";
      console.log(`  [${priorityLabel(issue.priority)}] ${label(issue)}${state} (assigned: ${issue.assignee})${unblockStr}`);
    }
  }
  console.log();

  console.log("-".repeat(60));
  console.log("  RECOMMENDED WORK ORDER (topological sort)");
  console.log("-".repeat(60));
  let orderNum = 0;
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[i];
    const issue = issueMap.get(id);
    if (isCompleted(issue)) continue;
    orderNum++;
    const status = issue.state ? ` {${issue.state}}` : "";
    const isReady = unblockedIds.includes(id) && !isInProgress(issue);
    const claimedByOther = isReady && isAssignedToOther(issue, viewer);
    const epic = isReady && isParent(issue);
    const ready = isReady
      ? (claimedByOther ? ` >> CLAIMED (${issue.assignee})`
        : epic ? ` >> EPIC${childProgress(issue, issueMap)}`
        : " >> READY")
      : "";
    const blockers = [...(blockedByGraph.get(id) || [])].filter((b) => issueMap.has(b) && !isCompleted(issueMap.get(b)));
    const blockerStr = blockers.length > 0
      ? `\n       blocked by: ${blockers.map((b) => issueMap.get(b)?.identifier || b).join(", ")}`
      : "";
    console.log(`  ${String(orderNum).padStart(3)}. ${label(issue)}${status}${ready}${blockerStr}`);
  }

  // --- Epic breakdown (parent-child hierarchy, recursive) ---
  const rootParents = [...issueMap.values()].filter(
    (i) => isRootParent(i, issueMap) && !isCompleted(i)
  );
  if (rootParents.length > 0) {
    console.log();
    console.log("-".repeat(60));
    console.log("  EPIC BREAKDOWN (parent → sub-issues)");
    console.log("-".repeat(60));

    function printEpicTree(issue, depth = 0, seen = new Set()) {
      if (seen.has(issue.id)) return;
      seen.add(issue.id);

      const indent = "  " + "  ".repeat(depth);
      if (depth === 0) {
        const progress = childProgress(issue, issueMap);
        const state = issue.state ? ` {${issue.state}}` : "";
        console.log(`  ${label(issue)}${state}${progress}`);
      } else {
        const childState = issue.state ? ` {${issue.state}}` : "";
        const done = isCompleted(issue) ? " ✓" : "";
        const assignee = issue.assignee ? ` (${issue.assignee})` : "";
        const subCount = issue.children.length > 0
          ? ` [${issue.children.length} sub-issues]`
          : "";
        console.log(`${indent}~> ${label(issue)}${childState}${assignee}${done}${subCount}`);
      }

      for (const child of issue.children) {
        const childIssue = issueMap.get(child.id);
        if (childIssue) {
          printEpicTree(childIssue, depth + 1, new Set(seen));
        } else {
          const childIndent = "  " + "  ".repeat(depth + 1);
          const childState = child.state ? ` {${child.state}}` : "";
          const done = COMPLETED_TYPES.has(child.stateType) ? " ✓" : "";
          console.log(`${childIndent}~> ${child.identifier}${childState}${done}`);
        }
      }

      if (depth === 0) console.log();
    }

    for (const parent of rootParents) {
      printEpicTree(parent);
    }
  }

  console.log("-".repeat(60));
  console.log("  DEPENDENCY GRAPH");
  console.log("-".repeat(60));

  const hasRelations = [...blocksGraph.values()].some((s) => s.size > 0);
  if (!hasRelations) {
    console.log("  (no blocking relationships found)");
  } else {
    const printed = new Set();
    const roots = [...issueMap.keys()].filter((id) => {
      const blockers = [...(blockedByGraph.get(id) || [])].filter((b) => issueMap.has(b));
      return blockers.length === 0;
    });

    function hasActiveNode(id, seen = new Set()) {
      if (seen.has(id)) return false;
      seen.add(id);
      if (!isCompleted(issueMap.get(id))) return true;
      const dependents = [...(blocksGraph.get(id) || [])].filter((b) => issueMap.has(b));
      return dependents.some((dep) => hasActiveNode(dep, seen));
    }

    function printTree(id, indent = 0, seen = new Set()) {
      if (seen.has(id)) {
        console.log(`${"  ".repeat(indent + 1)}-> ${issueMap.get(id)?.identifier || id} (circular)`);
        return;
      }
      seen.add(id);
      const prefix = "  ".repeat(indent + 1);
      const marker = indent === 0 ? "" : "-> ";
      const state = issueMap.get(id)?.state ? ` {${issueMap.get(id).state}}` : "";
      console.log(`${prefix}${marker}${label(issueMap.get(id))}${state}`);
      printed.add(id);

      const dependents = [...(blocksGraph.get(id) || [])].filter((b) => issueMap.has(b));
      for (const dep of dependents) {
        printTree(dep, indent + 1, new Set(seen));
      }
    }

    for (const root of roots) {
      if ((blocksGraph.get(root)?.size || 0) > 0 && hasActiveNode(root)) {
        printTree(root);
        console.log();
      }
    }

    if (printed.size === 0) {
      console.log("  (no active blocking relationships found)");
    }
  }

  if (cycled.length > 0) {
    console.log();
    console.log("-".repeat(60));
    console.log("  WARNING: CIRCULAR DEPENDENCIES DETECTED");
    console.log("-".repeat(60));
    for (const id of cycled) {
      console.log(`  ${label(issueMap.get(id))}`);
    }
  }

  console.log();
  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
