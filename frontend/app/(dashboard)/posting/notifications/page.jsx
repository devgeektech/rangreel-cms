"use client";

import {
  Bell,
  LayoutDashboard,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import NotificationsPage from "@/components/notifications/NotificationsPage";

const navItems = [
  { href: "/posting", label: "Dashboard", icon: LayoutDashboard },
  { href: "/posting/notifications", label: "Notifications", icon: Bell },
];

export default function PostingNotificationsPage() {
  return (
    <DashboardShell navItems={navItems}>
      <NotificationsPage />
    </DashboardShell>
  );
}
