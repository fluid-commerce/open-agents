import { getServerSession } from "@/lib/session/get-server-session";
import {
  getConnectedAppById,
  deleteConnectedApp,
} from "@/lib/db/connected-apps";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  // Verify connector belongs to user
  const connector = await getConnectedAppById(id);
  if (!connector) {
    return Response.json({ error: "Connector not found" }, { status: 404 });
  }

  if (connector.installedByUserId !== session.user.id) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const success = await deleteConnectedApp(id);
    if (!success) {
      return Response.json(
        { error: "Failed to disconnect connector" },
        { status: 500 },
      );
    }
    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to disconnect connector:", error);
    return Response.json(
      { error: "Failed to disconnect connector" },
      { status: 500 },
    );
  }
}
