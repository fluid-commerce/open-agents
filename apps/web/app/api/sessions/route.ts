import { nanoid } from "nanoid";
import { after } from "next/server";
import {
  createSessionWithInitialChat,
  getSessionsByUserId,
  updateSession,
} from "@/lib/db/sessions";
import { getUserPreferences } from "@/lib/db/user-preferences";
import { parseGitHubUrl } from "@/lib/github/client";
import { getRepoToken } from "@/lib/github/get-repo-token";
import { getUserGitHubToken } from "@/lib/github/user-token";
import { createSandboxForSession } from "@/lib/sandbox/create";
import { getServerSession } from "@/lib/session/get-server-session";

interface CreateSessionRequest {
  title?: string;
  repoOwner?: string;
  repoName?: string;
  branch?: string;
  cloneUrl?: string;
  isNewBranch?: boolean;
  sandboxType?: "hybrid" | "vercel" | "just-bash";
}

function generateBranchName(username: string, name?: string | null): string {
  let initials = "nb";
  if (name) {
    initials =
      name
        .split(" ")
        .map((n) => n[0]?.toLowerCase() ?? "")
        .join("")
        .slice(0, 2) || "nb";
  } else if (username) {
    initials = username.slice(0, 2).toLowerCase();
  }
  const randomSuffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `${initials}/${randomSuffix}`;
}

function resolveSessionTitle(input: CreateSessionRequest): string {
  if (input.title && input.title.trim()) {
    return input.title.trim();
  }
  if (input.repoName) {
    return input.repoName;
  }
  return "New session";
}

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const sessions = await getSessionsByUserId(session.user.id);
  return Response.json({ sessions });
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: CreateSessionRequest;
  try {
    body = (await req.json()) as CreateSessionRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    repoOwner,
    repoName,
    branch,
    cloneUrl,
    isNewBranch,
    sandboxType = "hybrid",
  } = body;

  let finalBranch = branch;
  if (isNewBranch) {
    finalBranch = generateBranchName(session.user.username, session.user.name);
  }

  // Resolve GitHub token early so we can pass it to background provisioning.
  // Failures here are non-fatal -- the client can still trigger sandbox
  // creation later via POST /api/sandbox.
  let githubToken: string | null = null;
  if (cloneUrl) {
    const parsedRepo = parseGitHubUrl(cloneUrl);
    if (parsedRepo) {
      try {
        const tokenResult = await getRepoToken(
          session.user.id,
          parsedRepo.owner,
        );
        githubToken = tokenResult.token;
      } catch {
        // Fall through -- token resolution will be retried by the client path
      }
    }
  } else {
    githubToken = await getUserGitHubToken();
  }

  try {
    const title = resolveSessionTitle(body);
    const preferences = await getUserPreferences(session.user.id);
    const result = await createSessionWithInitialChat({
      session: {
        id: nanoid(),
        userId: session.user.id,
        title,
        status: "running",
        repoOwner,
        repoName,
        branch: finalBranch,
        cloneUrl,
        isNewBranch: isNewBranch ?? false,
        sandboxState: { type: sandboxType },
        lifecycleState: "provisioning",
        lifecycleVersion: 0,
      },
      initialChat: {
        id: nanoid(),
        title: "New chat",
        modelId: preferences.defaultModelId,
      },
    });

    // Kick off sandbox provisioning in the background so it starts spinning up
    // before the browser finishes navigating to the new session page.
    const sessionId = result.session.id;
    const gitUser = {
      name: session.user.name ?? session.user.username,
      email:
        session.user.email ??
        `${session.user.username}@users.noreply.vercel.app`,
    };

    after(async () => {
      try {
        await createSandboxForSession({
          repoUrl: cloneUrl ?? undefined,
          branch: finalBranch ?? undefined,
          isNewBranch: isNewBranch ?? false,
          sessionId,
          sandboxType,
          githubToken,
          gitUser,
        });
        console.log(
          `[Session] Background sandbox provisioning completed for session ${sessionId}`,
        );
      } catch (error) {
        // Non-fatal: the client auto-create effect will retry.
        // Reset lifecycleState from "active" (set by claimSandboxProvisioning)
        // back to "provisioning" so the client's retry loop can detect the
        // failure and fall through to ensureSandboxReady() instead of polling
        // indefinitely.
        console.error(
          `[Session] Background sandbox provisioning failed for session ${sessionId}:`,
          error,
        );
        try {
          await updateSession(sessionId, {
            lifecycleState: "provisioning",
          });
        } catch (updateError) {
          console.error(
            `[Session] Failed to reset lifecycle state for session ${sessionId}:`,
            updateError,
          );
        }
      }
    });

    return Response.json(result);
  } catch (error) {
    console.error("Failed to create session:", error);
    return Response.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}
