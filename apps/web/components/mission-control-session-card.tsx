"use client";

import {
  Archive,
  EllipsisVertical,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Loader2,
  Pencil,
} from "lucide-react";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import { cn } from "@/lib/utils";
import {
  getMissionControlPrimaryActionLabel,
  getMissionControlStatusLabel,
  getMissionControlSummary,
  type MissionControlLane,
} from "./mission-control-session";

type MissionControlSessionCardProps = {
  session: SessionWithUnread;
  lane: MissionControlLane;
  isActive: boolean;
  isPending: boolean;
  variant?: "mission-control" | "history";
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onOpenRenameDialog: (session: SessionWithUnread) => void;
  onArchiveSession?: (session: SessionWithUnread) => void;
};

const cardPerformanceStyle: CSSProperties = {
  contentVisibility: "auto",
  containIntrinsicSize: "12rem",
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) {
    return "now";
  }

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }

  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getRepoMeta(session: SessionWithUnread): string | null {
  const parts: string[] = [];

  if (session.repoOwner && session.repoName) {
    parts.push(`${session.repoOwner}/${session.repoName}`);
  } else if (session.repoName) {
    parts.push(session.repoName);
  }

  if (session.branch) {
    parts.push(session.branch);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

function getGitHubPrUrl(session: SessionWithUnread): string | null {
  if (!session.prNumber || !session.repoOwner || !session.repoName) {
    return null;
  }

  return `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`;
}

function getGitHubRepoUrl(session: SessionWithUnread): string | null {
  if (!session.repoOwner || !session.repoName) {
    return null;
  }

  return `https://github.com/${session.repoOwner}/${session.repoName}`;
}

function getHistorySummary(session: SessionWithUnread): string {
  if (session.prStatus === "merged") {
    return session.prNumber
      ? `Pull request #${session.prNumber} was merged before this session moved to history.`
      : "This session was archived after work was merged.";
  }

  return "This session lives in history and is ready whenever you need to revisit it.";
}

function StatusPill({
  label,
  lane,
  variant,
}: {
  label: string;
  lane: MissionControlLane;
  variant: "mission-control" | "history";
}) {
  const classes =
    variant === "history"
      ? "border-border bg-muted/60 text-muted-foreground"
      : lane === "needs-you"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : lane === "running"
          ? "border-sky-500/20 bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : label === "Merged"
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "border-border bg-muted/60 text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium",
        classes,
      )}
    >
      {variant === "history" ? "Archived" : label}
    </span>
  );
}

function PrBadge({ session }: { session: SessionWithUnread }) {
  if (!session.prNumber) {
    return null;
  }

  const isMerged = session.prStatus === "merged";
  const classes = isMerged
    ? "border-purple-500/20 bg-purple-500/10 text-purple-700 dark:text-purple-300"
    : "border-green-500/20 bg-green-500/10 text-green-700 dark:text-green-300";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-medium",
        classes,
      )}
    >
      {isMerged ? (
        <GitMerge className="h-3 w-3" />
      ) : (
        <GitPullRequest className="h-3 w-3" />
      )}
      <span>#{session.prNumber}</span>
    </span>
  );
}

function DiffStats({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) {
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
      {added !== null ? (
        <span className="text-green-600 dark:text-green-400">+{added}</span>
      ) : null}
      {removed !== null ? (
        <span className="text-red-600 dark:text-red-400">-{removed}</span>
      ) : null}
    </span>
  );
}

export function MissionControlSessionCard({
  session,
  lane,
  isActive,
  isPending,
  variant = "mission-control",
  onSessionClick,
  onSessionPrefetch,
  onOpenRenameDialog,
  onArchiveSession,
}: MissionControlSessionCardProps) {
  const lastActivityLabel = formatRelativeTime(
    new Date(session.lastActivityAt ?? session.createdAt),
  );
  const repoMeta = getRepoMeta(session);
  const statusLabel = getMissionControlStatusLabel(session);
  const summary =
    variant === "history"
      ? getHistorySummary(session)
      : getMissionControlSummary(session);
  const primaryActionLabel =
    variant === "history"
      ? "Open session"
      : getMissionControlPrimaryActionLabel(session);
  const prUrl = getGitHubPrUrl(session);
  const repoUrl = getGitHubRepoUrl(session);

  return (
    <article
      className={cn(
        "rounded-2xl border bg-card/95 p-4 shadow-sm transition-all",
        isActive
          ? "border-foreground/15 bg-accent/35 shadow-md"
          : "border-border/70 hover:border-foreground/10 hover:bg-accent/15",
        variant === "mission-control" && lane === "needs-you"
          ? "border-amber-500/20"
          : null,
        variant === "mission-control" && lane === "running"
          ? "border-sky-500/20"
          : null,
        variant === "mission-control" && statusLabel === "Merged"
          ? "border-emerald-500/20"
          : null,
        isPending ? "opacity-70" : "opacity-100",
      )}
      style={cardPerformanceStyle}
      data-session-id={session.id}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onSessionClick(session)}
          onMouseEnter={() => onSessionPrefetch(session)}
          onFocus={() => onSessionPrefetch(session)}
          className="min-w-0 flex-1 text-left"
          aria-current={isActive ? "page" : undefined}
          aria-busy={isPending}
        >
          <div className="flex items-center gap-2">
            <StatusPill label={statusLabel} lane={lane} variant={variant} />
            {session.prNumber ? <PrBadge session={session} /> : null}
            <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              <span className="tabular-nums">{lastActivityLabel}</span>
            </span>
          </div>

          <div className="mt-3 space-y-2">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {session.title}
            </p>
            <p className="text-sm leading-6 text-muted-foreground">{summary}</p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              <span className="truncate font-mono">
                {repoMeta ?? "No repository connected"}
              </span>
            </span>
            <DiffStats
              added={session.linesAdded}
              removed={session.linesRemoved}
            />
          </div>
        </button>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button
            type="button"
            size="sm"
            variant={
              variant === "history"
                ? "outline"
                : lane === "needs-you"
                  ? "default"
                  : "outline"
            }
            className="min-w-[8rem] justify-center"
            onClick={() => onSessionClick(session)}
          >
            {primaryActionLabel}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={`Open menu for ${session.title}`}
              >
                <EllipsisVertical className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={() => onSessionClick(session)}
                className="gap-2"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open session</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onOpenRenameDialog(session)}
                className="gap-2"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Rename</span>
              </DropdownMenuItem>
              {onArchiveSession ? (
                <DropdownMenuItem
                  onClick={() => onArchiveSession(session)}
                  className="gap-2"
                >
                  <Archive className="h-3.5 w-3.5" />
                  <span>Move to history</span>
                </DropdownMenuItem>
              ) : null}
              {prUrl || repoUrl ? <DropdownMenuSeparator /> : null}
              {prUrl ? (
                <DropdownMenuItem
                  onClick={() =>
                    window.open(prUrl, "_blank", "noopener,noreferrer")
                  }
                  className="gap-2"
                >
                  {session.prStatus === "merged" ? (
                    <GitMerge className="h-3.5 w-3.5" />
                  ) : (
                    <GitPullRequest className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {session.prStatus === "merged"
                      ? "View merged PR"
                      : "View PR"}
                    {session.prNumber ? ` #${session.prNumber}` : ""}
                  </span>
                </DropdownMenuItem>
              ) : null}
              {repoUrl ? (
                <DropdownMenuItem
                  onClick={() =>
                    window.open(repoUrl, "_blank", "noopener,noreferrer")
                  }
                  className="gap-2"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>View on GitHub</span>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}
