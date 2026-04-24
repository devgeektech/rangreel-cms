"use client";

import { Bell, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import NotificationsPage from "@/components/notifications/NotificationsPage";

const navItems = [
  { href: "/videographer", label: "Dashboard", icon: LayoutDashboard },
  { href: "/videographer/notifications", label: "Notifications", icon: Bell },
];

export default function VideographerNotificationsPage() {
  return (
    <DashboardShell navItems={navItems}>
      <NotificationsPage />
    </DashboardShell>
  );
}
