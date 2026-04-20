"use client";

import { Bell, Calendar, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import NotificationsPage from "@/components/notifications/NotificationsPage";

const navItems = [
  { href: "/strategist", label: "Dashboard", icon: LayoutDashboard },
  { href: "/strategist/global-calendar", label: "Calendar", icon: Calendar },
  { href: "/strategist/notifications", label: "Notifications", icon: Bell },
];

export default function StrategistNotificationsPage() {
  return (
    <DashboardShell navItems={navItems}>
      <NotificationsPage />
    </DashboardShell>
  );
}
