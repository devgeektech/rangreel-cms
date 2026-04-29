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
  const userName = String(user?.name || user?.fullName || "User");
  const userRoleRaw = user?.role?.name || user?.role?.slug || user?.role || "—";
  const userRoleSlug = String(user?.role?.slug || userRoleRaw || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
  const userRole = String(userRoleRaw)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
  const roleColorBySlug = {
    strategist: "border-cyan-500/40 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
    editor: "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300",
    "video-editor": "border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-300",
    videographer: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    designer: "border-pink-500/40 bg-pink-500/15 text-pink-700 dark:text-pink-300",
    "graphic-designer": "border-pink-500/40 bg-pink-500/15 text-pink-700 dark:text-pink-300",
    manager: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    admin: "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300",
  };
  const roleTone =
    roleColorBySlug[userRoleSlug] ||
    roleColorBySlug[String(userRoleRaw || "").toLowerCase().replace(/\s+/g, "-")] ||
    "border-primary/30 bg-primary/10 text-primary";

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
          <div className="hidden max-w-[320px] items-end text-right md:flex md:flex-col">
            <p className="truncate text-sm font-medium leading-tight">{userName}</p>
            <span className={`mt-1 inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${roleTone}`}>
              {userRole}
            </span>
          </div>
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
