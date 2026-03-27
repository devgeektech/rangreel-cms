"use client";

import {
  LayoutDashboard,
  Users2,
  ShieldCheck,
  Package,
  CalendarOff,
  Calendar,
  SlidersHorizontal,
  Settings,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";

const adminNavItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users2 },
  { href: "/admin/roles", label: "Roles", icon: ShieldCheck },
  { href: "/admin/packages", label: "Packages", icon: Package },
  { href: "/admin/holidays", label: "Holidays", icon: CalendarOff },
  { href: "/admin/calendar", label: "Global Calendar", icon: Calendar },
  { href: "/admin/team-capacity", label: "Role capacity", icon: SlidersHorizontal },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export default function AdminLayout({ children }) {
  return <DashboardShell navItems={adminNavItems}>{children}</DashboardShell>;
}
