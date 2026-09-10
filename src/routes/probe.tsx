import { createFileRoute } from "@tanstack/react-router";
import { ProbeLab } from "@/components/probe/probe-lab";
import { useOrigin } from "@/hooks/use-origin";

export const Route = createFileRoute("/probe")({ component: ProbePage });

function ProbePage() {
  const origin = useOrigin();
  return <ProbeLab origin={origin} />;
}
