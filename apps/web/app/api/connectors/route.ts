import { getServerSession } from "@/lib/session/get-server-session";
import { getConnectedAppsByUserId } from "@/lib/db/connected-apps";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const apps = await getConnectedAppsByUserId(session.user.id);

  // Return connectors without sensitive data (botToken is encrypted and should not be exposed)
  const connectors = apps.map((app) => ({
    id: app.id,
    provider: app.provider,
    workspaceId: app.workspaceId,
    workspaceName: app.workspaceName,
    metadata: app.metadata,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  }));

  return Response.json({ connectors });
}
