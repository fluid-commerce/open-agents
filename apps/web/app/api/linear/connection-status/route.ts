import { getLinearAccount } from "@/lib/db/accounts";
import { getServerSession } from "@/lib/session/get-server-session";

export async function GET(): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ connected: false }, { status: 401 });
  }
  const account = await getLinearAccount(session.user.id);
  if (!account) {
    return Response.json({ connected: false });
  }
  return Response.json({
    connected: true,
    displayName: account.username,
    workspaceName: account.workspaceName ?? null,
  });
}
