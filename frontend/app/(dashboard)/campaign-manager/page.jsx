"use client";

import { Bell, BriefcaseBusiness, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { Card, CardContent } from "@/components/ui/card";

const navItems = [
  { href: "/campaign-manager", label: "Dashboard", icon: LayoutDashboard },
  { href: "/campaign-manager/notifications", label: "Notifications", icon: Bell },
];

export default function CampaignManagerDashboardPage() {
  return (
    <DashboardShell navItems={navItems}>
      <section className="space-y-6">
        <Card className="border-indigo-500/30 bg-gradient-to-r from-indigo-500/15 to-transparent">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Campaign Manager Dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Campaign management workspace is ready. Calendar and task ownership remain with manager roles for now.
              </p>
            </div>
            <BriefcaseBusiness className="h-10 w-10 shrink-0 text-indigo-500" />
          </CardContent>
        </Card>
      </section>
    </DashboardShell>
  );
}
