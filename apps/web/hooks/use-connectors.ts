"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr";

export interface ConnectedApp {
  id: string;
  provider: "slack" | "discord" | "teams";
  workspaceId: string;
  workspaceName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ConnectorsResponse {
  connectors: ConnectedApp[];
}

export function useConnectors() {
  const { data, error, isLoading, mutate } = useSWR<ConnectorsResponse>(
    "/api/connectors",
    fetcher,
  );

  const connectors = data?.connectors ?? [];

  const disconnectConnector = async (connectorId: string) => {
    // Optimistically remove the connector from cache
    await mutate(
      (current) => ({
        connectors: (current?.connectors ?? []).filter(
          (c) => c.id !== connectorId,
        ),
      }),
      { revalidate: false },
    );

    try {
      const res = await fetch(`/api/connectors/${connectorId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const errorData = (await res.json()) as { error?: string };
        throw new Error(errorData.error ?? "Failed to disconnect connector");
      }
    } catch (error) {
      // Revalidate to restore server state on error
      await mutate();
      throw error;
    }
  };

  return {
    connectors,
    loading: isLoading,
    error: error?.message ?? null,
    disconnectConnector,
    refreshConnectors: mutate,
  };
}
