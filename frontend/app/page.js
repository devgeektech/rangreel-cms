"use client";

import {
  BarChart3,
  CalendarCheck2,
  ClipboardList,
  FolderKanban,
  Users,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";

const defaultNavItems = [
  { href: "/", label: "Overview", icon: BarChart3 },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/calendar", label: "Calendar", icon: CalendarCheck2 },
  { href: "/team", label: "Team", icon: Users },
];

export default function Home() {
  return (
    <DashboardShell navItems={defaultNavItems}>
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold">Welcome to Rangreel</h2>
        <p className="text-muted-foreground">
          This page uses the shared `DashboardShell` infrastructure. Define role-specific
          `navItems` per page or per route-group layout as your role dashboards are added.
        </p>
      </section>
    </DashboardShell>
  );
}
