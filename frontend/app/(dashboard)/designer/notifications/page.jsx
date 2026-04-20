"use client";

import { Bell, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import NotificationsPage from "@/components/notifications/NotificationsPage";

const navItems = [
  { href: "/designer", label: "Dashboard", icon: LayoutDashboard },
  { href: "/designer/notifications", label: "Notifications", icon: Bell },
];

export default function DesignerNotificationsPage() {
  return (
    <DashboardShell navItems={navItems}>
      <NotificationsPage />
    </DashboardShell>
  );
}
