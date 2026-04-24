"use client";

import { Bell, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import NotificationsPage from "@/components/notifications/NotificationsPage";

const navItems = [
  { href: "/editor", label: "Dashboard", icon: LayoutDashboard },
  { href: "/editor/notifications", label: "Notifications", icon: Bell },
];

export default function EditorNotificationsPage() {
  return (
    <DashboardShell navItems={navItems}>
      <NotificationsPage />
    </DashboardShell>
  );
}
