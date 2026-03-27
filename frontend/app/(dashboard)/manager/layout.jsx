"use client";

import {
  LayoutDashboard,
  Users2,
  Calendar,
  UserCircle2,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";

const managerNavItems = [
  { href: "/manager", label: "Dashboard", icon: LayoutDashboard },
  { href: "/manager/clients", label: "Clients", icon: Users2 },
  { href: "/manager/calendar", label: "Calendar", icon: Calendar },
  { href: "/manager/profile", label: "Profile", icon: UserCircle2 },
];

export default function ManagerLayout({ children }) {
  return <DashboardShell navItems={managerNavItems}>{children}</DashboardShell>;
}

