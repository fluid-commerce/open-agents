import type { ReactNode } from "react";
import type { MissionControlLane } from "@/components/mission-control-session";
import { cn } from "@/lib/utils";

type MissionControlSectionProps = {
  title: string;
  description: string;
  count: number;
  emptyMessage: string;
  tone: MissionControlLane | "history";
  children: ReactNode;
};

const toneClasses: Record<MissionControlSectionProps["tone"], string> = {
  "needs-you":
    "border-amber-500/20 bg-amber-500/5 text-amber-700 dark:text-amber-300",
  running: "border-sky-500/20 bg-sky-500/5 text-sky-700 dark:text-sky-300",
  completed:
    "border-emerald-500/20 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
  history: "border-border bg-muted/50 text-muted-foreground",
};

export function MissionControlSection({
  title,
  description,
  count,
  emptyMessage,
  tone,
  children,
}: MissionControlSectionProps) {
  return (
    <section className="rounded-2xl border border-border/70 bg-background/90 p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            <span
              className={cn(
                "inline-flex min-w-6 items-center justify-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                toneClasses[tone],
              )}
            >
              {count}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {description}
          </p>
        </div>
      </div>

      {count > 0 ? (
        <div className="space-y-3">{children}</div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-4 py-5 text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      )}
    </section>
  );
}
