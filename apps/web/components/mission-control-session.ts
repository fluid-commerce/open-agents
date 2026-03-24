import type { SessionWithUnread } from "@/hooks/use-sessions";

export type MissionControlLane = "needs-you" | "running" | "completed";

const missionControlLanePriority: Record<MissionControlLane, number> = {
  "needs-you": 0,
  running: 1,
  completed: 2,
};

export function isWaitingOnAgent(session: SessionWithUnread): boolean {
  return session.hasStreaming;
}

export function needsAction(session: SessionWithUnread): boolean {
  return (
    !session.hasStreaming &&
    (session.needsResponse || session.prStatus === "open")
  );
}

export function getMissionControlLane(
  session: SessionWithUnread,
): MissionControlLane {
  if (needsAction(session)) {
    return "needs-you";
  }

  if (isWaitingOnAgent(session)) {
    return "running";
  }

  return "completed";
}

export function getSessionActivityTimestamp(
  session: SessionWithUnread,
): number {
  return new Date(session.lastActivityAt ?? session.createdAt).getTime();
}

function getLaneSpecificPriority(session: SessionWithUnread): number {
  const lane = getMissionControlLane(session);

  if (lane === "needs-you") {
    return session.prStatus === "open" ? 0 : 1;
  }

  if (lane === "completed") {
    if (session.prStatus === "merged") {
      return 0;
    }

    if (session.prStatus === "closed") {
      return 1;
    }
  }

  return 2;
}

export function sortSessionsForMissionControl(
  sessions: SessionWithUnread[],
): SessionWithUnread[] {
  return [...sessions].sort((left, right) => {
    const lanePriorityDelta =
      missionControlLanePriority[getMissionControlLane(left)] -
      missionControlLanePriority[getMissionControlLane(right)];
    if (lanePriorityDelta !== 0) {
      return lanePriorityDelta;
    }

    const laneSpecificPriorityDelta =
      getLaneSpecificPriority(left) - getLaneSpecificPriority(right);
    if (laneSpecificPriorityDelta !== 0) {
      return laneSpecificPriorityDelta;
    }

    return (
      getSessionActivityTimestamp(right) - getSessionActivityTimestamp(left)
    );
  });
}

export function sortSessionsByRecentActivity(
  sessions: SessionWithUnread[],
): SessionWithUnread[] {
  return [...sessions].sort(
    (left, right) =>
      getSessionActivityTimestamp(right) - getSessionActivityTimestamp(left),
  );
}

export function getTopMissionControlSession(
  sessions: SessionWithUnread[],
): SessionWithUnread | null {
  return sortSessionsForMissionControl(sessions)[0] ?? null;
}

export function getMissionControlStatusLabel(
  session: SessionWithUnread,
): string {
  if (session.prStatus === "open" && !session.hasStreaming) {
    return "Ready for review";
  }

  if (session.needsResponse && !session.hasStreaming) {
    return "Needs reply";
  }

  if (session.hasStreaming) {
    return "Running";
  }

  if (session.prStatus === "merged") {
    return "Merged";
  }

  if (session.prStatus === "closed") {
    return "Closed";
  }

  return "Quiet";
}

export function getMissionControlSummary(session: SessionWithUnread): string {
  if (session.prStatus === "open" && !session.hasStreaming) {
    return session.prNumber
      ? `Pull request #${session.prNumber} is open and ready for review.`
      : "A pull request is open and ready for review.";
  }

  if (session.needsResponse && !session.hasStreaming) {
    return "The latest response is waiting on you.";
  }

  if (session.hasStreaming) {
    return "The agent is actively working in this session.";
  }

  if (session.prStatus === "merged") {
    return session.prNumber
      ? `Pull request #${session.prNumber} was merged successfully.`
      : "This session wrapped up with a merged pull request.";
  }

  if (session.prStatus === "closed") {
    return session.prNumber
      ? `Pull request #${session.prNumber} was closed.`
      : "This session was wrapped up and no longer needs attention.";
  }

  return "This session is quiet and ready whenever you want to resume.";
}

export function getMissionControlPrimaryActionLabel(
  session: SessionWithUnread,
): string {
  if (session.prStatus === "open" && !session.hasStreaming) {
    return "Review PR";
  }

  if (session.needsResponse && !session.hasStreaming) {
    return "Reply";
  }

  if (session.hasStreaming) {
    return "Open live session";
  }

  if (session.prStatus === "merged") {
    return "View result";
  }

  return "Open session";
}
