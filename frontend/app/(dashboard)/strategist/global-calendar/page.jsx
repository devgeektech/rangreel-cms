"use client";

import { Calendar, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { GlobalCalendarPage } from "../../manager/calendar/page";

const navItems = [
  { href: "/strategist", label: "Dashboard", icon: LayoutDashboard },
  { href: "/strategist/global-calendar", label: "Calendar", icon: Calendar },
];

export default function StrategistGlobalCalendarPage() {
  return (
    <DashboardShell navItems={navItems} defaultCollapsed>
      <GlobalCalendarPage actor="strategist" />
    </DashboardShell>
  );
}
