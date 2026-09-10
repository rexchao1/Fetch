import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 w-full rounded-md bg-surface-2 px-3 text-sm text-fg shadow-[var(--shadow-border)]",
        "placeholder:text-subtle file:border-0 file:bg-transparent file:text-sm",
        "focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
