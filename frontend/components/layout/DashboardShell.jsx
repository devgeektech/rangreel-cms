"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, UserCircle2 } from "lucide-react";
import Navbar from "./Navbar";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import AppLogo from "@/components/shared/AppLogo";
import { toast } from "sonner";

function isItemActive(pathname, href) {
  if (href === "/") return pathname === "/";
  if (pathname === href) return true;

  const pathParts = pathname.split("/").filter(Boolean);
  const hrefParts = href.split("/").filter(Boolean);
  const isRootDashboardRoute = hrefParts.length === 1;

  if (isRootDashboardRoute) {
    return false;
  }

  return pathname.startsWith(`${href}/`);
}

export default function DashboardShell({ children, navItems = [], defaultCollapsed = false }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const clearUser = useAuthStore((state) => state.clearUser);
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed));
  const socketRef = useRef(null);

  const resolvedNavItems = useMemo(() => {
    const firstSeg = String(pathname || "").split("/").filter(Boolean)[0] || "";
    const isDashboardRoleRoute = Boolean(firstSeg);
    if (!isDashboardRoleRoute || firstSeg === "admin") return navItems;
    const profileHref = `/${firstSeg}/profile`;
    if (navItems.some((x) => String(x?.href || "") === profileHref)) return navItems;
    return [...navItems, { href: profileHref, label: "Profile", icon: UserCircle2 }];
  }, [navItems, pathname]);

  const mobileItems = useMemo(() => resolvedNavItems.slice(0, 5), [resolvedNavItems]);

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch (error) {
      // Client-side cleanup should still happen if logout endpoint fails.
    } finally {
      clearUser();
      router.push("/login");
    }
  };

  useEffect(() => {
    let mounted = true;
    if (user?._id) return undefined;
    (async () => {
      try {
        const me = await api.getMe();
        if (!mounted) return;
        const nextUser = me?.user || me?.data || null;
        if (nextUser) setUser(nextUser);
      } catch {
        // Ignore here; route guards handle unauthenticated states.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user?._id, setUser]);

  useEffect(() => {
    let mounted = true;
    const userId = String(user?._id || "");
    if (!userId) return undefined;

    const baseApiUrl = process.env.NEXT_PUBLIC_API_URL || "";
    const socketBase = baseApiUrl.replace(/\/api\/?$/, "");
    if (!socketBase) return undefined;

    const connectSocket = async () => {
      try {
        if (!window.io) {
          await new Promise((resolve, reject) => {
            const id = "socket-io-client-script";
            const existing = document.getElementById(id);
            if (existing) {
              existing.addEventListener("load", () => resolve(), { once: true });
              existing.addEventListener("error", () => reject(new Error("Socket script failed")), { once: true });
              return;
            }
            const script = document.createElement("script");
            script.id = id;
            script.src = `${socketBase}/socket.io/socket.io.js`;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error("Socket script failed"));
            document.head.appendChild(script);
          });
        }
        if (!mounted || !window.io) return;
        const socket = window.io(socketBase, { withCredentials: true });
        socketRef.current = socket;
        socket.emit("join", userId);
        socket.on("notification", (data) => {
          const message = String(data?.message || "New notification");
          toast(message);
          window.dispatchEvent(new Event("rr:notification"));
          try {
            localStorage.setItem("rr:lastNotificationAt", String(Date.now()));
          } catch {
            // ignore storage errors in private/locked environments
          }
        });
      } catch (err) {
        console.warn("[socket] client unavailable:", err?.message || err);
      }
    };

    connectSocket();
    return () => {
      mounted = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [user?._id]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden border-r border-white/10 bg-sidebar text-sidebar-foreground md:flex md:flex-col ${
          collapsed ? "w-20" : "w-[240px]"
        } transition-all duration-200`}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-3">
          <div className="flex min-w-0 items-center gap-2">
            {/* <AppLogo
              width={collapsed ? 44 : 150}
              height={collapsed ? 44 : 38}
              className={collapsed ? "h-11 w-11" : "h-10 w-auto"}
            /> */}
            <img
              src="/assets/images/white_logo.png"
              alt="Rangreel logo"
              width="150"
              height="38"
              className=""
            />
            </div>
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/90 transition-colors duration-200 hover:bg-white/10"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
          {resolvedNavItems.map((item) => {
            const active = isItemActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors duration-200 ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-sidebar-foreground/90 hover:bg-muted/20"
                } ${collapsed ? "justify-center" : "gap-3"}`}
                title={collapsed ? item.label : undefined}
              >
                {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3" />
      </aside>

      <div
        className={`transition-all duration-200 ${
          collapsed ? "md:ml-20" : "md:ml-[240px]"
        } pb-16 md:pb-0`}
      >
        <Navbar user={user} onLogout={handleLogout} />
        <main className="p-4 md:p-6">{children}</main>
      </div>

      <div className="fixed left-3 top-3 z-30 md:hidden">
        <AppLogo width={96} height={30} className="h-9 w-auto" />
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur md:hidden">
        <div className="grid h-16 grid-cols-5">
          {mobileItems.map((item) => {
            const active = isItemActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`inline-flex items-center justify-center transition-colors duration-200 ${
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
                aria-label={item.label}
              >
                {Icon ? <Icon className="h-5 w-5" /> : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
