import { createFileRoute } from "@tanstack/react-router";
import { CaptureDeck } from "@/components/capture/capture-deck";

export const Route = createFileRoute("/capture")({ component: CapturePage });

function CapturePage() {
  return <CaptureDeck />;
}
