"use client";

import {
  Bell,
  CalendarClock,
  LayoutDashboard,
  ListOrdered,
  Send,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import NotificationsPage from "@/components/notifications/NotificationsPage";

const navItems = [
  { href: "/posting", label: "Dashboard", icon: LayoutDashboard },
  { href: "/posting/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/posting/queue", label: "Queue", icon: ListOrdered },
  { href: "/posting/published", label: "Published", icon: Send },
  { href: "/posting/notifications", label: "Notifications", icon: Bell },
];

export default function PostingNotificationsPage() {
  return (
    <DashboardShell navItems={navItems}>
      <NotificationsPage />
    </DashboardShell>
  );
}
