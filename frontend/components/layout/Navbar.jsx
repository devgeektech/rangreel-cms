"use client";

import { usePathname } from "next/navigation";
import { Bell, ChevronRight, LogOut } from "lucide-react";
import ThemeToggle from "./ThemeToggle";
import AppLogo from "@/components/shared/AppLogo";

function titleFromPath(pathname) {
  if (!pathname || pathname === "/") return "Dashboard";
  const parts = pathname.split("/").filter(Boolean);
  return parts[parts.length - 1]
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function Navbar({ user, onLogout }) {
  const pathname = usePathname();
  const pageTitle = titleFromPath(pathname);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="hidden md:block">
              <AppLogo width={72} height={22} className="h-6 w-auto" />
            </span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="truncate">{pageTitle}</span>
          </div>
          {/* <h1 className="truncate text-lg font-semibold">{pageTitle}</h1> */}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border/70 bg-card text-foreground transition-colors duration-200 hover:bg-muted"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>

          <ThemeToggle />
          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-card px-3 text-sm text-destructive transition-colors duration-200 hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
