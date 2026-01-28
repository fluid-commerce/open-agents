"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Trash2, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConnectors, type ConnectedApp } from "@/hooks/use-connectors";

// Provider display info
const providerInfo: Record<
  ConnectedApp["provider"],
  { name: string; description: string; icon: string }
> = {
  slack: {
    name: "Slack",
    description:
      "Interact with the agent by mentioning @Open Harness in any channel",
    icon: "/icons/slack.svg",
  },
  discord: {
    name: "Discord",
    description: "Coming soon",
    icon: "/icons/discord.svg",
  },
  teams: {
    name: "Microsoft Teams",
    description: "Coming soon",
    icon: "/icons/teams.svg",
  },
};

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

interface DisconnectDialogProps {
  connector: ConnectedApp | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisconnect: (connectorId: string) => Promise<void>;
}

function DisconnectDialog({
  connector,
  open,
  onOpenChange,
  onDisconnect,
}: DisconnectDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleDisconnect = async () => {
    if (!connector) return;

    setIsLoading(true);
    try {
      await onDisconnect(connector.id);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to disconnect:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const info = connector ? providerInfo[connector.provider] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect {info?.name ?? "Connector"}</DialogTitle>
          <DialogDescription>
            This will remove the connection to{" "}
            {connector?.workspaceName ?? "this workspace"}. Users in this
            workspace will no longer be able to interact with the agent.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDisconnect}
            disabled={isLoading}
          >
            {isLoading ? "Disconnecting..." : "Disconnect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface NotificationBannerProps {
  type: "success" | "error";
  message: string;
  onDismiss: () => void;
}

function NotificationBanner({
  type,
  message,
  onDismiss,
}: NotificationBannerProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      className={`mb-4 flex items-center gap-2 rounded-md p-3 text-sm ${
        type === "success"
          ? "bg-green-500/10 text-green-500"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {type === "success" ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <AlertCircle className="h-4 w-4" />
      )}
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="opacity-60 hover:opacity-100">
        &times;
      </button>
    </div>
  );
}

export function ConnectorsSection() {
  const { connectors, loading, disconnectConnector } = useConnectors();
  const [disconnectDialogConnector, setDisconnectDialogConnector] =
    useState<ConnectedApp | null>(null);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const searchParams = useSearchParams();

  // Handle URL query params for success/error messages
  useEffect(() => {
    const success = searchParams.get("success");
    const error = searchParams.get("error");
    const workspace = searchParams.get("workspace");

    if (success === "slack_installed" && workspace) {
      setNotification({
        type: "success",
        message: `Slack workspace "${workspace}" connected successfully!`,
      });
      // Clean up URL params
      window.history.replaceState({}, "", "/settings/connectors");
    } else if (error) {
      setNotification({
        type: "error",
        message: decodeURIComponent(error),
      });
      window.history.replaceState({}, "", "/settings/connectors");
    }
  }, [searchParams]);

  // Group connectors by provider
  const slackConnectors = connectors.filter((c) => c.provider === "slack");

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connectors</CardTitle>
          <CardDescription>Loading connectors...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      {notification && (
        <NotificationBanner
          type={notification.type}
          message={notification.message}
          onDismiss={() => setNotification(null)}
        />
      )}

      {/* Slack Section */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="currentColor"
                >
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                </svg>
              </div>
              <div>
                <CardTitle>Slack</CardTitle>
                <CardDescription>
                  Interact with the agent by mentioning it in any channel
                </CardDescription>
              </div>
            </div>
            <Button asChild>
              <Link href="/api/auth/slack/install">
                Add to Slack
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {slackConnectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No Slack workspaces connected. Click &quot;Add to Slack&quot; to
              install the bot.
            </p>
          ) : (
            <div className="space-y-4">
              {slackConnectors.map((connector) => (
                <div
                  key={connector.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="space-y-1">
                    <p className="font-medium">
                      {connector.workspaceName ?? connector.workspaceId}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Connected: {formatDate(connector.createdAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDisconnectDialogConnector(connector)}
                  >
                    <Trash2 className="h-4 w-4" />
                    <span className="sr-only">Disconnect</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Future: Discord Section */}
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="currentColor"
                >
                  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
                </svg>
              </div>
              <div>
                <CardTitle>Discord</CardTitle>
                <CardDescription>Coming soon</CardDescription>
              </div>
            </div>
            <Button disabled>Add to Discord</Button>
          </div>
        </CardHeader>
      </Card>

      <DisconnectDialog
        connector={disconnectDialogConnector}
        open={!!disconnectDialogConnector}
        onOpenChange={(open) => !open && setDisconnectDialogConnector(null)}
        onDisconnect={disconnectConnector}
      />
    </>
  );
}
