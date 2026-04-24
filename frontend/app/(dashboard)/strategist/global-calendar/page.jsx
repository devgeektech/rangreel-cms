"use client";

import { Bell, Calendar, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { GlobalCalendarPage } from "../../manager/calendar/page";

const navItems = [
  { href: "/strategist", label: "Dashboard", icon: LayoutDashboard },
  { href: "/strategist/global-calendar", label: "Calendar", icon: Calendar },
  { href: "/strategist/notifications", label: "Notifications", icon: Bell },
];

export default function StrategistGlobalCalendarPage() {
  return (
    <DashboardShell navItems={navItems} defaultCollapsed>
      <GlobalCalendarPage actor="strategist" />
    </DashboardShell>
  );
}
