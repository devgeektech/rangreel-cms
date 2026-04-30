"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Bell, Calendar, LayoutDashboard, UserCircle2 } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { useAuthStore } from "@/lib/store";
import { api } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function navForRole(role) {
  if (role === "strategist") {
    return [
      { href: "/strategist", label: "Dashboard", icon: LayoutDashboard },
      { href: "/strategist/global-calendar", label: "Calendar", icon: Calendar },
      { href: "/strategist/notifications", label: "Notifications", icon: Bell },
      { href: "/strategist/profile", label: "Profile", icon: UserCircle2 },
    ];
  }
  if (role === "manager") {
    return [
      { href: "/manager", label: "Dashboard", icon: LayoutDashboard },
      { href: "/manager/notifications", label: "Notifications", icon: Bell },
      { href: "/manager/profile", label: "Profile", icon: UserCircle2 },
    ];
  }
  if (role === "campaign-manager") {
    return [
      { href: "/campaign-manager", label: "Dashboard", icon: LayoutDashboard },
      { href: "/campaign-manager/notifications", label: "Notifications", icon: Bell },
      { href: "/campaign-manager/profile", label: "Profile", icon: UserCircle2 },
    ];
  }
  if (role === "editor") {
    return [
      { href: "/editor", label: "Dashboard", icon: LayoutDashboard },
      { href: "/editor/notifications", label: "Notifications", icon: Bell },
      { href: "/editor/profile", label: "Profile", icon: UserCircle2 },
    ];
  }
  if (role === "designer") {
    return [
      { href: "/designer", label: "Dashboard", icon: LayoutDashboard },
      { href: "/designer/notifications", label: "Notifications", icon: Bell },
      { href: "/designer/profile", label: "Profile", icon: UserCircle2 },
    ];
  }
  if (role === "videographer") {
    return [
      { href: "/videographer", label: "Dashboard", icon: LayoutDashboard },
      { href: "/videographer/notifications", label: "Notifications", icon: Bell },
      { href: "/videographer/profile", label: "Profile", icon: UserCircle2 },
    ];
  }
  if (role === "posting") {
    return [
      { href: "/posting", label: "Dashboard", icon: LayoutDashboard },
      { href: "/posting/notifications", label: "Notifications", icon: Bell },
      { href: "/posting/profile", label: "Profile", icon: UserCircle2 },
    ];
  }
  return [];
}

export default function RoleProfilePage() {
  const params = useParams();
  const role = String(params?.role || "");
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const navItems = useMemo(() => navForRole(role), [role]);
  const [name, setName] = useState(String(user?.name || ""));
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  if (!navItems.length || role === "admin") {
    return (
      <DashboardShell navItems={[]}>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Profile is not available for this role.</CardContent>
        </Card>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell navItems={navItems}>
      <section className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Edit profile</CardTitle>
            <CardDescription>Update your display name.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={savingName}
                onClick={async () => {
                  try {
                    setSavingName(true);
                    const res = await api.updateMe({ name });
                    const nextUser = res?.data?.user || res?.user || null;
                    if (nextUser) setUser(nextUser);
                    toast.success("Name updated");
                  } catch (err) {
                    toast.error(err?.message || "Failed to update name");
                  } finally {
                    setSavingName(false);
                  }
                }}
              >
                {savingName ? "Saving…" : "Save name"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Use a strong password with uppercase, number, and special character.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                disabled={savingPassword}
                onClick={async () => {
                  if (newPassword !== confirmPassword) {
                    toast.error("New password and confirm password do not match");
                    return;
                  }
                  try {
                    setSavingPassword(true);
                    const res = await api.changePassword({ currentPassword, newPassword });
                    const nextUser = res?.user || res?.data?.user || null;
                    if (nextUser) setUser(nextUser);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                    toast.success("Password changed");
                  } catch (err) {
                    toast.error(err?.message || "Failed to change password");
                  } finally {
                    setSavingPassword(false);
                  }
                }}
              >
                {savingPassword ? "Saving…" : "Update password"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </DashboardShell>
  );
}

