"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { usePlayer } from "@/components/providers/PlayerProvider";
import { PlayerDock } from "@/components/player/PlayerDock";
import { SyncIndicator } from "./SyncIndicator";
import { ClockIcon, HomeIcon, LibraryIcon, ListIcon, MusicIcon, SearchIcon, SettingsIcon } from "@/components/ui/icons";

const NAV = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/search", label: "Search", Icon: SearchIcon },
  { href: "/library", label: "My Library", short: "Library", Icon: LibraryIcon },
  { href: "/playlists", label: "Playlists", Icon: ListIcon },
  { href: "/recent", label: "Recently Played", short: "Recent", Icon: ClockIcon },
  { href: "/settings", label: "Settings", Icon: SettingsIcon },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children, email }: { children: ReactNode; email: string | null }) {
  const pathname = usePathname();
  const { current } = usePlayer();

  // Leave room at the bottom so the player never covers the end of a page.
  const bottomSpace = current
    ? "pb-[calc(4rem+4.5rem+max(200px,56.25vw)+2rem)] md:pb-28"
    : "pb-[calc(4rem+2rem)] md:pb-10";

  return (
    <div className="min-h-dvh md:pl-60">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-lg focus:bg-violet focus:px-4 focus:py-2 focus:text-ink"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-surface px-3 py-5 md:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-3 text-lg font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-violet to-blue text-ink">
            <MusicIcon size={18} />
          </span>
          MyMusic
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {NAV.map(({ href, label, Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-violet/15 text-violet" : "text-muted hover:bg-white/5 hover:text-fg"
                }`}
              >
                <Icon /> {label}
              </Link>
            );
          })}
        </nav>
        {email && (
          <p className="truncate px-3 text-xs text-muted" title={email}>
            {email}
          </p>
        )}
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-line bg-ink/85 px-4 backdrop-blur md:px-8">
        <Link href="/" className="flex items-center gap-2 text-base font-semibold md:hidden">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-gradient-to-br from-violet to-blue text-ink">
            <MusicIcon size={16} />
          </span>
          MyMusic
        </Link>
        <span className="hidden md:block" />
        <SyncIndicator />
      </header>

      <main id="main" tabIndex={-1} className={`mx-auto w-full max-w-5xl px-4 pt-6 md:px-8 md:pt-8 ${bottomSpace}`}>
        {children}
      </main>

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV.map((item) => {
          const { href, label, Icon } = item;
          const short = "short" in item ? item.short : label;
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              aria-label={label}
              className={`flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium ${active ? "text-violet" : "text-muted"}`}
            >
              <Icon size={22} />
              <span>{short}</span>
            </Link>
          );
        })}
      </nav>

      <PlayerDock />
    </div>
  );
}
