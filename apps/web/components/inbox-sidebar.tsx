"use client";

import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  History,
  Loader2,
  Plus,
  Settings,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InboxSidebarRenameDialog } from "@/components/inbox-sidebar-rename-dialog";
import { MissionControlSection } from "@/components/mission-control-section";
import { MissionControlSessionCard } from "@/components/mission-control-session-card";
import {
  getMissionControlLane,
  sortSessionsByRecentActivity,
  sortSessionsForMissionControl,
} from "@/components/mission-control-session";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useSession } from "@/hooks/use-session";
import type { SessionWithUnread } from "@/hooks/use-sessions";
import type { Session as AuthSession } from "@/lib/session/types";
import { cn } from "@/lib/utils";

type InboxSidebarProps = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  sessionsLoading: boolean;
  activeSessionId: string;
  pendingSessionId: string | null;
  onSessionClick: (session: SessionWithUnread) => void;
  onSessionPrefetch: (session: SessionWithUnread) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onArchiveSession: (sessionId: string) => Promise<void>;
  onOpenNewSession: () => void;
  initialUser?: AuthSession["user"];
};

type ArchivedSessionsResponse = {
  sessions: SessionWithUnread[];
  archivedCount: number;
  pagination?: {
    hasMore: boolean;
    nextOffset: number;
  };
  error?: string;
};

type MissionControlView = "mission-control" | "history";

const ARCHIVED_SESSIONS_PAGE_SIZE = 50;

function getAvatarFallback(username: string): string {
  const normalized = username.trim();
  if (!normalized) {
    return "?";
  }

  return normalized.slice(0, 2).toUpperCase();
}

function SummaryStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: ComponentType<{ className?: string }>;
  tone: "needs-you" | "running" | "completed";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-3 py-3 shadow-sm",
        tone === "needs-you"
          ? "border-amber-500/20 bg-amber-500/5"
          : tone === "running"
            ? "border-sky-500/20 bg-sky-500/5"
            : "border-emerald-500/20 bg-emerald-500/5",
      )}
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums text-foreground">
        {value}
      </div>
    </div>
  );
}

function MissionControlSkeleton() {
  return (
    <div className="space-y-4 px-4 py-4">
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-border/70 bg-background/80 p-4 shadow-sm"
        >
          <div className="h-4 w-28 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-52 animate-pulse rounded bg-muted" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 2 }).map((__, cardIndex) => (
              <div
                key={cardIndex}
                className="rounded-2xl border border-border/70 p-4"
              >
                <div className="flex items-center gap-2">
                  <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
                  <div className="ml-auto h-4 w-16 animate-pulse rounded bg-muted" />
                </div>
                <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="mt-2 h-4 w-full animate-pulse rounded bg-muted" />
                <div className="mt-3 h-7 w-40 animate-pulse rounded-full bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InboxSidebar({
  sessions,
  archivedCount,
  sessionsLoading,
  activeSessionId,
  pendingSessionId,
  onSessionClick,
  onSessionPrefetch,
  onRenameSession,
  onArchiveSession,
  onOpenNewSession,
  initialUser,
}: InboxSidebarProps) {
  const router = useRouter();
  const { session } = useSession();
  const [activeView, setActiveView] =
    useState<MissionControlView>("mission-control");
  const [archivedSessions, setArchivedSessions] = useState<SessionWithUnread[]>(
    [],
  );
  const [archivedSessionsLoading, setArchivedSessionsLoading] = useState(false);
  const [archivedSessionsError, setArchivedSessionsError] = useState<
    string | null
  >(null);
  const [hasMoreArchivedSessions, setHasMoreArchivedSessions] = useState(false);
  const archivedRequestInFlightRef = useRef(false);
  const lastLoadedArchivedCountRef = useRef(0);
  const [renameDialogSession, setRenameDialogSession] =
    useState<SessionWithUnread | null>(null);

  const fetchArchivedSessionsPage = useCallback(
    async ({ offset, replace }: { offset: number; replace: boolean }) => {
      if (archivedRequestInFlightRef.current) {
        return;
      }

      archivedRequestInFlightRef.current = true;
      setArchivedSessionsLoading(true);
      setArchivedSessionsError(null);

      try {
        const query = new URLSearchParams({
          status: "archived",
          limit: String(ARCHIVED_SESSIONS_PAGE_SIZE),
          offset: String(offset),
        });
        const res = await fetch(`/api/sessions?${query.toString()}`);
        const data = (await res.json()) as ArchivedSessionsResponse;

        if (!res.ok) {
          throw new Error(data.error ?? "Failed to load history");
        }

        setArchivedSessions((current) => {
          if (replace) {
            return data.sessions;
          }

          const existingIds = new Set(
            current.map((targetSession) => targetSession.id),
          );
          const nextSessions = data.sessions.filter(
            (targetSession) => !existingIds.has(targetSession.id),
          );

          return [...current, ...nextSessions];
        });
        lastLoadedArchivedCountRef.current = data.archivedCount;
        setHasMoreArchivedSessions(Boolean(data.pagination?.hasMore));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load history";
        setArchivedSessionsError(message);
      } finally {
        archivedRequestInFlightRef.current = false;
        setArchivedSessionsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (activeView !== "history") {
      return;
    }

    if (archivedCount === 0) {
      setArchivedSessions([]);
      setHasMoreArchivedSessions(false);
      setArchivedSessionsError(null);
      lastLoadedArchivedCountRef.current = 0;
      return;
    }

    if (lastLoadedArchivedCountRef.current === archivedCount) {
      return;
    }

    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [activeView, archivedCount, fetchArchivedSessionsPage]);

  const missionControlSessions = useMemo(() => {
    const grouped = {
      needsYou: [] as SessionWithUnread[],
      running: [] as SessionWithUnread[],
      completed: [] as SessionWithUnread[],
    };

    for (const targetSession of sortSessionsForMissionControl(sessions)) {
      const lane = getMissionControlLane(targetSession);
      if (lane === "needs-you") {
        grouped.needsYou.push(targetSession);
      } else if (lane === "running") {
        grouped.running.push(targetSession);
      } else {
        grouped.completed.push(targetSession);
      }
    }

    return grouped;
  }, [sessions]);
  const missionControlCounts = {
    needsYou: missionControlSessions.needsYou.length,
    running: missionControlSessions.running.length,
    completed: missionControlSessions.completed.length,
  };
  const sortedArchivedSessions = useMemo(
    () => sortSessionsByRecentActivity(archivedSessions),
    [archivedSessions],
  );
  const showMissionControlLoadingState =
    sessionsLoading && sessions.length === 0;
  const showHistoryLoadingState =
    (archivedSessionsLoading && sortedArchivedSessions.length === 0) ||
    (activeView === "history" &&
      archivedCount > 0 &&
      sortedArchivedSessions.length === 0 &&
      lastLoadedArchivedCountRef.current !== archivedCount &&
      !archivedSessionsError);
  const sidebarUser = session?.user ?? initialUser;

  const handleSessionClick = useCallback(
    (targetSession: SessionWithUnread) => {
      onSessionClick(targetSession);
    },
    [onSessionClick],
  );

  const handleSessionPrefetch = useCallback(
    (targetSession: SessionWithUnread) => {
      onSessionPrefetch(targetSession);
    },
    [onSessionPrefetch],
  );

  const handleArchiveSession = useCallback(
    async (targetSession: SessionWithUnread) => {
      try {
        await onArchiveSession(targetSession.id);
        setArchivedSessions((current) => {
          const nextSessions = [
            { ...targetSession, status: "archived" as const },
            ...current.filter(
              (sessionItem) => sessionItem.id !== targetSession.id,
            ),
          ];
          const maxCachedSessions = Math.max(
            current.length,
            ARCHIVED_SESSIONS_PAGE_SIZE,
          );

          return nextSessions.slice(0, maxCachedSessions);
        });
        setHasMoreArchivedSessions(
          (currentHasMore) =>
            currentHasMore || archivedCount + 1 > ARCHIVED_SESSIONS_PAGE_SIZE,
        );
      } catch (error) {
        console.error("Failed to archive session:", error);
      }
    },
    [archivedCount, onArchiveSession],
  );

  const handleLoadMoreArchivedSessions = useCallback(() => {
    if (archivedSessionsLoading) {
      return;
    }

    void fetchArchivedSessionsPage({
      offset: archivedSessions.length,
      replace: false,
    });
  }, [
    archivedSessions.length,
    archivedSessionsLoading,
    fetchArchivedSessionsPage,
  ]);

  const handleRetryArchivedSessions = useCallback(() => {
    void fetchArchivedSessionsPage({ offset: 0, replace: true });
  }, [fetchArchivedSessionsPage]);

  const closeRenameDialog = useCallback(() => {
    setRenameDialogSession(null);
  }, []);

  const handleOpenRenameDialog = useCallback(
    (targetSession: SessionWithUnread) => {
      setRenameDialogSession(targetSession);
    },
    [],
  );

  const handleRenameArchivedSession = useCallback(
    (sessionId: string, title: string) => {
      setArchivedSessions((current) =>
        current.map((targetSession) =>
          targetSession.id === sessionId
            ? { ...targetSession, title }
            : targetSession,
        ),
      );
    },
    [],
  );

  const renderMissionControlCard = useCallback(
    (targetSession: SessionWithUnread) => (
      <MissionControlSessionCard
        key={targetSession.id}
        session={targetSession}
        lane={getMissionControlLane(targetSession)}
        isActive={targetSession.id === activeSessionId}
        isPending={targetSession.id === pendingSessionId}
        onSessionClick={handleSessionClick}
        onSessionPrefetch={handleSessionPrefetch}
        onOpenRenameDialog={handleOpenRenameDialog}
        onArchiveSession={handleArchiveSession}
      />
    ),
    [
      activeSessionId,
      handleArchiveSession,
      handleOpenRenameDialog,
      handleSessionClick,
      handleSessionPrefetch,
      pendingSessionId,
    ],
  );

  return (
    <>
      <div className="border-b border-border/70 bg-background/95">
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                {activeView === "history"
                  ? "Session history"
                  : "Sessions workspace"}
              </div>
              <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                {activeView === "history" ? "History" : "Mission Control"}
              </h1>
              <p className="mt-1 max-w-xl text-sm leading-6 text-muted-foreground">
                {activeView === "history"
                  ? "Archived sessions and older threads live here once they leave Mission Control."
                  : "Supervise active agents, jump into reviews, and keep recent completions in view."}
              </p>
            </div>

            <div className="flex items-center gap-1">
              {sidebarUser ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => router.push("/settings")}
                  aria-label="Open settings"
                >
                  <Avatar className="h-5 w-5">
                    {sidebarUser.avatar ? (
                      <AvatarImage
                        src={sidebarUser.avatar}
                        alt={sidebarUser.username}
                      />
                    ) : null}
                    <AvatarFallback className="text-[8px]">
                      {getAvatarFallback(sidebarUser.username)}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => router.push("/settings")}
                  aria-label="Open settings"
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>

          {activeView === "mission-control" ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <SummaryStat
                  label="Needs You"
                  value={missionControlCounts.needsYou}
                  icon={ArrowUpRight}
                  tone="needs-you"
                />
                <SummaryStat
                  label="Running"
                  value={missionControlCounts.running}
                  icon={Loader2}
                  tone="running"
                />
                <SummaryStat
                  label="Completed"
                  value={missionControlCounts.completed}
                  icon={CheckCircle2}
                  tone="completed"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={onOpenNewSession}>
                  <Plus className="h-4 w-4" />
                  <span>New session</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setActiveView("history")}
                >
                  <History className="h-4 w-4" />
                  <span>History</span>
                  <span className="tabular-nums text-muted-foreground">
                    {archivedCount}
                  </span>
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setActiveView("mission-control")}
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Mission Control</span>
              </Button>
              <Button type="button" size="sm" onClick={onOpenNewSession}>
                <Plus className="h-4 w-4" />
                <span>New session</span>
              </Button>
              <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                <span className="tabular-nums">{archivedCount}</span>
                <span className="ml-1">archived</span>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeView === "mission-control" ? (
          showMissionControlLoadingState ? (
            <MissionControlSkeleton />
          ) : sessions.length === 0 ? (
            <div className="px-4 py-6">
              <Empty className="rounded-2xl border border-dashed border-border/70 bg-background/80">
                <EmptyMedia variant="icon">
                  <Plus className="h-5 w-5" />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>No sessions yet</EmptyTitle>
                  <EmptyDescription>
                    Start a session to begin tracking active work in Mission
                    Control.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button type="button" onClick={onOpenNewSession}>
                    <Plus className="h-4 w-4" />
                    <span>New session</span>
                  </Button>
                </EmptyContent>
              </Empty>
            </div>
          ) : (
            <div className="space-y-4 px-4 py-4">
              <MissionControlSection
                title="Needs You"
                description="Pull requests ready for review and conversations waiting on a reply."
                count={missionControlCounts.needsYou}
                emptyMessage="Nothing is waiting on you right now."
                tone="needs-you"
              >
                {missionControlSessions.needsYou.map(renderMissionControlCard)}
              </MissionControlSection>

              <MissionControlSection
                title="Running"
                description="Sessions where the agent is actively working right now."
                count={missionControlCounts.running}
                emptyMessage="No sessions are actively running."
                tone="running"
              >
                {missionControlSessions.running.map(renderMissionControlCard)}
              </MissionControlSection>

              <MissionControlSection
                title="Completed"
                description="Quiet sessions and recent finishes that no longer need attention."
                count={missionControlCounts.completed}
                emptyMessage="Nothing has wrapped up yet."
                tone="completed"
              >
                {missionControlSessions.completed.map(renderMissionControlCard)}
              </MissionControlSection>
            </div>
          )
        ) : showHistoryLoadingState ? (
          <MissionControlSkeleton />
        ) : archivedSessionsError && sortedArchivedSessions.length === 0 ? (
          <div className="px-4 py-6">
            <Empty className="rounded-2xl border border-dashed border-border/70 bg-background/80">
              <EmptyMedia variant="icon">
                <History className="h-5 w-5" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>History is unavailable</EmptyTitle>
                <EmptyDescription>{archivedSessionsError}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRetryArchivedSessions}
                >
                  Retry
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        ) : archivedCount === 0 ? (
          <div className="px-4 py-6">
            <Empty className="rounded-2xl border border-dashed border-border/70 bg-background/80">
              <EmptyMedia variant="icon">
                <History className="h-5 w-5" />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>No archived sessions</EmptyTitle>
                <EmptyDescription>
                  Sessions moved out of Mission Control will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        ) : (
          <div className="space-y-4 px-4 py-4">
            <MissionControlSection
              title="History"
              description="Older and archived sessions that are no longer part of the active workspace."
              count={archivedCount}
              emptyMessage="No history is available yet."
              tone="history"
            >
              {sortedArchivedSessions.map((targetSession) => (
                <MissionControlSessionCard
                  key={targetSession.id}
                  session={targetSession}
                  lane={getMissionControlLane(targetSession)}
                  variant="history"
                  isActive={targetSession.id === activeSessionId}
                  isPending={targetSession.id === pendingSessionId}
                  onSessionClick={handleSessionClick}
                  onSessionPrefetch={handleSessionPrefetch}
                  onOpenRenameDialog={handleOpenRenameDialog}
                />
              ))}
            </MissionControlSection>

            {hasMoreArchivedSessions || archivedSessionsError ? (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={
                  archivedSessionsError
                    ? handleRetryArchivedSessions
                    : handleLoadMoreArchivedSessions
                }
                disabled={archivedSessionsLoading}
              >
                {archivedSessionsLoading
                  ? "Loading..."
                  : archivedSessionsError
                    ? "Retry loading history"
                    : "Load more history"}
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <InboxSidebarRenameDialog
        session={renameDialogSession}
        onClose={closeRenameDialog}
        onRenameSession={onRenameSession}
        onRenamed={handleRenameArchivedSession}
      />
    </>
  );
}
