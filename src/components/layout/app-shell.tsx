import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GlossaryButton, SettingsGlossary } from "@/components/guide/settings-glossary";
import { useLatchStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Guide" },
  { to: "/probe", label: "Add" },
  { to: "/capture", label: "Capture" },
  { to: "/playlist", label: "Playlist" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hydrate = useLatchStore((s) => s.hydrate);
  const [keysOpen, setKeysOpen] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="size-2 rounded-full bg-live" aria-hidden="true" />
            <span className="font-display text-xl tracking-tight italic">Latch</span>
          </Link>
          <nav className="flex flex-1 items-center justify-start gap-0.5 overflow-x-auto sm:pl-6">
            {NAV.map((item) => {
              const active = pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    "flex h-11 shrink-0 items-center rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 sm:px-3",
                    active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <GlossaryButton onClick={() => setKeysOpen(true)} />
        </div>
      </header>
      <div id="main">{children}</div>
      <SettingsGlossary open={keysOpen} onOpenChange={setKeysOpen} />
    </div>
  );
}
