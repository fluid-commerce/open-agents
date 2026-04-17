import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { getLinearAccount, updateLinearAccountTokens } from "@/lib/db/accounts";
import { refreshLinearToken } from "./oauth";

/**
 * Get a valid Linear access token for the given user.
 * If the token is expired (within 5-minute buffer) and a refresh token exists,
 * refreshes inline and updates the database.
 * Returns null if no account is linked or refresh fails (e.g. revoked token).
 */
export async function getUserLinearToken(
  userId: string,
): Promise<string | null> {
  try {
    const account = await getLinearAccount(userId);
    if (!account?.accessToken) return null;

    // Check if the token is still valid (with 5-minute buffer)
    if (account.expiresAt) {
      const now = Date.now();
      const bufferMs = 5 * 60 * 1000;
      const isExpired = account.expiresAt.getTime() - bufferMs < now;

      if (isExpired) {
        // Token is expired -- try to refresh
        if (!account.refreshToken) {
          console.error("Linear token expired but no refresh token available");
          return null;
        }

        const clientId = process.env.LINEAR_CLIENT_ID;
        const clientSecret = process.env.LINEAR_CLIENT_SECRET;
        if (!clientId || !clientSecret) {
          console.error(
            "Linear OAuth credentials not configured for token refresh",
          );
          return null;
        }

        const decryptedRefresh = decrypt(account.refreshToken);
        let refreshed;
        try {
          refreshed = await refreshLinearToken({
            refreshToken: decryptedRefresh,
            clientId,
            clientSecret,
          });
        } catch (refreshError) {
          console.error("Linear token refresh failed:", refreshError);
          return null;
        }

        const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

        // Persist the new tokens. If persistence fails, still return the token
        // so the current request succeeds.
        try {
          await updateLinearAccountTokens(userId, {
            accessToken: encrypt(refreshed.access_token),
            refreshToken: encrypt(refreshed.refresh_token),
            expiresAt: newExpiresAt,
          });
        } catch (persistError) {
          console.error(
            "Failed to persist refreshed Linear tokens. The current request will succeed, but subsequent requests may fail:",
            persistError,
          );
        }

        return refreshed.access_token;
      }
    }

    return decrypt(account.accessToken);
  } catch (error) {
    console.error("Error fetching Linear token:", error);
    return null;
  }
}
