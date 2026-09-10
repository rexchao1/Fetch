import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/components/settings/settings-page";
import { useOrigin } from "@/hooks/use-origin";
import { useChannelList } from "@/lib/store";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
  const origin = useOrigin();
  const channels = useChannelList();
  if (!origin) return null;
  return <SettingsPage channels={channels} origin={origin} />;
}
