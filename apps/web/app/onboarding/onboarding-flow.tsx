"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Check, Github, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { ModelCombobox } from "@/components/model-combobox";
import { useModelOptions } from "@/hooks/use-model-options";
import { useSession } from "@/hooks/use-session";
import { useUserPreferences } from "@/hooks/use-user-preferences";
import { getDefaultModelOptionId } from "@/lib/model-options";
import { fetcher } from "@/lib/swr";

// ─── Types ───────────────────────────────────────────────────────────────────

interface VercelTeam {
  id: string;
  slug: string;
  name: string;
  avatar: string | null;
  membership: { role: string };
}

interface TeamsResponse {
  teams: VercelTeam[];
}

type StepId = 1 | 2 | 3;

// ─── Logo (matches OG image) ────────────────────────────────────────────────

function OpenAgentsLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-label="Open Agents"
    >
      <path
        d="M4 17L10 11L4 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 19H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function OnboardingFlow() {
  const router = useRouter();
  const [activeStep, setActiveStep] = useState<StepId>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<StepId>>(
    new Set(),
  );
  const [isCompleting, setIsCompleting] = useState(false);

  const markComplete = useCallback((step: StepId) => {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      next.add(step);
      return next;
    });
    if (step < 3) {
      setActiveStep((step + 1) as StepId);
    }
  }, []);

  const canOpenStep = (step: StepId): boolean => {
    if (step === 1) return true;
    for (let i = 1; i < step; i++) {
      if (!completedSteps.has(i as StepId)) return false;
    }
    return true;
  };

  const handleStepClick = (step: StepId) => {
    if (canOpenStep(step)) {
      setActiveStep(step);
    }
  };

  const handleGetStarted = async () => {
    setIsCompleting(true);
    try {
      const res = await fetch("/api/onboarding/complete", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to complete onboarding");
      }
      router.push("/");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Something went wrong",
      );
      setIsCompleting(false);
    }
  };

  const allDone =
    completedSteps.has(1) && completedSteps.has(2) && completedSteps.has(3);

  const steps: { id: StepId; title: string }[] = [
    { id: 1, title: "Select Vercel Team" },
    { id: 2, title: "Connect GitHub" },
    { id: 3, title: "Model Preferences" },
  ];

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* ── Left panel: branding ── */}
      <div className="flex shrink-0 flex-col justify-between bg-black px-6 py-6 md:w-1/2 md:px-12 md:py-10">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <OpenAgentsLogo className="size-7 text-white/50" />
          <span className="text-lg font-semibold tracking-tight text-white/50">
            Open Agents
          </span>
        </div>

        {/* Tagline — hidden on mobile, bottom-left */}
        <p className="hidden max-w-sm text-sm leading-relaxed text-zinc-600 md:block">
          Spawn coding agents that run infinitely in the cloud. Powered by AI
          SDK, Gateway, Sandbox, and Workflow SDK.
        </p>
      </div>

      {/* ── Right panel: steps ── */}
      <div className="flex flex-1 flex-col bg-zinc-950 px-6 py-8 md:px-10 md:py-10">
        <div className="flex w-full flex-1 flex-col">
          {/* Section heading */}
          <h1 className="mb-6 text-2xl font-semibold tracking-tight text-white">
            Onboarding
          </h1>

          {/* Steps list */}
          <div className="flex-1">
            {steps.map((step) => {
              const isActive = activeStep === step.id;
              const isCompleted = completedSteps.has(step.id);
              const isLocked = !canOpenStep(step.id);

              return (
                <div key={step.id} className="border-b border-white/10">
                  {/* Step header */}
                  <button
                    type="button"
                    onClick={() => handleStepClick(step.id)}
                    disabled={isLocked}
                    className={`flex w-full items-center gap-3 py-4 text-left transition-colors duration-200 disabled:cursor-not-allowed ${
                      isLocked
                        ? "text-zinc-600"
                        : isCompleted
                          ? "text-zinc-400"
                          : isActive
                            ? "text-white"
                            : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className={`text-sm tabular-nums ${
                        isLocked
                          ? "text-zinc-700"
                          : isActive
                            ? "text-white"
                            : "text-zinc-500"
                      }`}
                    >
                      {step.id}.
                    </span>
                    <span className="text-sm font-medium">{step.title}</span>
                    {isCompleted && (
                      <span className="ml-auto text-xs text-emerald-500">
                        ✓
                      </span>
                    )}
                  </button>

                  {/* Collapsible content */}
                  <div
                    className={`grid transition-all duration-300 ease-in-out ${
                      isActive
                        ? "grid-rows-[1fr] opacity-100"
                        : "grid-rows-[0fr] opacity-0"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="pb-5">
                        {step.id === 1 && (
                          <TeamSelector
                            onComplete={() => markComplete(1)}
                          />
                        )}
                        {step.id === 2 && (
                          <GitHubConnector
                            isActive={isActive}
                            onComplete={() => markComplete(2)}
                          />
                        )}
                        {step.id === 3 && (
                          <ModelSelector
                            onComplete={() => markComplete(3)}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Get Started */}
          <div className="mt-10 flex justify-end">
            <Button
              size="lg"
              disabled={!allDone || isCompleting}
              onClick={handleGetStarted}
              className="min-w-[140px] gap-2 bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500"
            >
              {isCompleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Setting up…
                </>
              ) : (
                "Get Started"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Team Selector ──────────────────────────────────────────────────

function TeamSelector({ onComplete }: { onComplete: () => void }) {
  const { data, isLoading, error } = useSWR<TeamsResponse>(
    "/api/vercel/teams",
    fetcher,
  );
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isExchanging, setIsExchanging] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const autoSelectedRef = useRef(false);

  const teams = data?.teams ?? [];

  // Auto-select if only one team
  useEffect(() => {
    if (teams.length === 1 && !autoSelectedRef.current && !isDone) {
      autoSelectedRef.current = true;
      handleSelectTeam(teams[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams.length]);

  const handleSelectTeam = async (team: VercelTeam) => {
    setSelectedTeamId(team.id);
    setIsExchanging(true);
    try {
      const res = await fetch("/api/vercel/gateway-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId: team.id, teamSlug: team.slug }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to exchange API key");
      }
      setIsDone(true);
      toast.success(`Connected to ${team.name}`);
      onComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to connect team",
      );
      setSelectedTeamId(null);
    } finally {
      setIsExchanging(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-1">
        <Skeleton className="h-10 w-full rounded bg-white/5" />
        <Skeleton className="h-10 w-full rounded bg-white/5" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-red-400">
        Failed to load teams. Please refresh and try again.
      </p>
    );
  }

  if (teams.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No Vercel teams found. Make sure your account has at least one team.
      </p>
    );
  }

  return (
    <div className="max-h-[200px] overflow-y-auto">
      {teams.map((team) => {
        const isSelected = selectedTeamId === team.id;
        const isThisDone = isSelected && isDone;

        return (
          <button
            key={team.id}
            type="button"
            disabled={isExchanging || isDone}
            onClick={() => handleSelectTeam(team)}
            className="flex w-full items-center gap-3 rounded px-1 py-2 text-left transition-colors duration-150 hover:bg-white/5 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            {/* Avatar — use Vercel's avatar API with teamId for consistent fallback */}
            <img
              src={`https://vercel.com/api/www/avatar?teamId=${team.id}&s=48`}
              alt=""
              className="size-6 rounded-full bg-zinc-800"
            />

            {/* Team name only */}
            <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
              {team.name}
            </span>

            {/* Status indicator */}
            {isSelected && isExchanging ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-zinc-500" />
            ) : isThisDone ? (
              <Check
                className="size-3.5 shrink-0 text-emerald-500"
                strokeWidth={2.5}
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ─── Step 2: GitHub Connector ───────────────────────────────────────────────

function GitHubConnector({
  isActive,
  onComplete,
}: {
  isActive: boolean;
  onComplete: () => void;
}) {
  const { session, loading, hasGitHubAccount, hasGitHubInstallations } =
    useSession();
  const hasCalledComplete = useRef(false);

  const isConnected = hasGitHubAccount && hasGitHubInstallations;

  // Only auto-complete when this step is actually active
  useEffect(() => {
    if (isActive && isConnected && !hasCalledComplete.current) {
      hasCalledComplete.current = true;
      onComplete();
    }
  }, [isActive, isConnected, onComplete]);

  if (loading) {
    return <Skeleton className="h-10 w-full rounded bg-white/5" />;
  }

  if (isConnected) {
    return (
      <div className="flex items-center gap-2.5">
        <Check className="size-4 text-emerald-500" strokeWidth={2.5} />
        <span className="text-sm text-zinc-300">
          Connected as{" "}
          <span className="text-white">{session?.user?.name ?? "GitHub"}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <a href="/api/auth/github/reconnect?next=/onboarding">
        <Button
          variant="outline"
          className="gap-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
        >
          <Github className="size-4" />
          Connect GitHub
        </Button>
      </a>
      <button
        type="button"
        onClick={onComplete}
        className="block text-xs text-zinc-600 underline-offset-2 transition-colors hover:text-zinc-400 hover:underline"
      >
        Skip for now
      </button>
    </div>
  );
}

// ─── Step 3: Model Selector ─────────────────────────────────────────────────

function ModelSelector({ onComplete }: { onComplete: () => void }) {
  const { modelOptions, loading: modelsLoading } = useModelOptions();
  const { preferences, loading: prefsLoading, updatePreferences } =
    useUserPreferences();
  const [isSaving, setIsSaving] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const defaultId = useMemo(
    () => getDefaultModelOptionId(modelOptions),
    [modelOptions],
  );
  const currentModelId = preferences?.defaultModelId ?? defaultId;

  const items = useMemo(
    () =>
      modelOptions.map((opt) => ({
        id: opt.id,
        label: opt.label,
        description: opt.description,
        isVariant: opt.isVariant,
      })),
    [modelOptions],
  );

  const handleModelChange = async (id: string) => {
    setIsSaving(true);
    try {
      await updatePreferences({ defaultModelId: id });
      toast.success("Default model saved");
      setIsDone(true);
      onComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save preference",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirm = async () => {
    await handleModelChange(currentModelId);
  };

  if (modelsLoading || prefsLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-9 w-full max-w-xs rounded bg-white/5" />
        <Skeleton className="h-9 w-24 rounded bg-white/5" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs text-zinc-500">Default Model</Label>
        <ModelCombobox
          value={currentModelId}
          items={items}
          placeholder="Select a model"
          searchPlaceholder="Search models…"
          emptyText="No models found."
          disabled={isSaving || isDone}
          onChange={handleModelChange}
        />
      </div>

      {!isDone && (
        <Button
          size="sm"
          disabled={isSaving}
          onClick={handleConfirm}
          className="gap-2 bg-white text-black hover:bg-zinc-200"
        >
          {isSaving ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Confirm"
          )}
        </Button>
      )}

      {isDone && (
        <div className="flex items-center gap-2 text-sm text-emerald-500">
          <Check className="size-4" strokeWidth={2.5} />
          Saved
        </div>
      )}
    </div>
  );
}
