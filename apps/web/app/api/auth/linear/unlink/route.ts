import { decrypt } from "@/lib/crypto";
import { deleteLinearAccount, getLinearAccount } from "@/lib/db/accounts";
import { revokeLinearToken } from "@/lib/linear/oauth";
import { getServerSession } from "@/lib/session/get-server-session";

export async function POST(): Promise<Response> {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const account = await getLinearAccount(session.user.id);
  if (!account) {
    return Response.json({ success: true, alreadyUnlinked: true });
  }

  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (clientId && clientSecret) {
    try {
      const accessToken = decrypt(account.accessToken);
      await revokeLinearToken({ token: accessToken, clientId, clientSecret });
    } catch (err) {
      console.error("Linear access-token revoke failed (continuing):", err);
    }
    if (account.refreshToken) {
      try {
        const refreshToken = decrypt(account.refreshToken);
        await revokeLinearToken({
          token: refreshToken,
          clientId,
          clientSecret,
        });
      } catch (err) {
        console.error("Linear refresh-token revoke failed (continuing):", err);
      }
    }
  }

  await deleteLinearAccount(session.user.id);
  return Response.json({ success: true });
}
