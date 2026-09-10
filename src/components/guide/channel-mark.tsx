import { cn } from "@/lib/utils";

export function ChannelMark({
  mark,
  active,
  className,
}: {
  mark: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-2 font-display text-sm italic tracking-tight text-fg",
        active && "bg-accent text-accent-fg",
        className,
      )}
      aria-hidden="true"
    >
      {mark}
    </span>
  );
}
