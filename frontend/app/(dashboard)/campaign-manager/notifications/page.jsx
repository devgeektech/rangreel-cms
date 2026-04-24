"use client";

import { Bell, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import NotificationsPage from "@/components/notifications/NotificationsPage";

const navItems = [
  { href: "/campaign-manager", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaign-manager/notifications", label: "Notifications", icon: Bell },
];

export default function CampaignManagerNotificationsPage() {
  return (
    <DashboardShell navItems={navItems}>
      <NotificationsPage />
    </DashboardShell>
  );
}
