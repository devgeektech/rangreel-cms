"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import EmptyState from "@/components/shared/EmptyState";
import { StatCardsSkeleton } from "@/components/shared/AdminSkeletons";

function StatCard({ title, value, loading }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-8 w-24" /> : <p className="text-3xl font-semibold">{value}</p>}
      </CardContent>
    </Card>
  );
}

export default function AdminDashboardPage() {
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState([]);
  const [managers, setManagers] = useState([]);
  const [users, setUsers] = useState([]);
  const [adminClients, setAdminClients] = useState([]);
  const [adminCalendar, setAdminCalendar] = useState(null);

  const currentMonth = new Date().toISOString().slice(0, 7);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [rolesData, managersData, usersData, clientsData, calendarData] = await Promise.all([
          api.getRoles(),
          api.getManagers(),
          api.getUsers(),
          api.getAdminClients(),
          api.getAdminCalendar(currentMonth),
        ]);
        setRoles(rolesData?.data || []);
        setManagers(managersData?.data || []);
        setUsers(usersData?.data || []);
        setAdminClients(clientsData?.data || clientsData || []);
        setAdminCalendar(calendarData?.data || calendarData || null);
      } catch (error) {
        toast.error(error.message || "Failed to load admin dashboard");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const stats = useMemo(() => {
    const activeRoles = roles.filter((role) => role.isActive).length;
    const systemRoles = roles.filter((role) => role.isSystem).length;
    const totalActiveClients = (adminClients || []).filter((c) => String(c.status || "").toLowerCase() === "active").length;
    const contentItemsThisMonth = (adminCalendar?.groups || []).reduce(
      (sum, g) => sum + ((g?.items || []).length || 0),
      0
    );
    return {
      totalManagers: managers.length,
      totalUsers: users.length,
      activeRoles,
      systemRoles,
      totalActiveClients,
      contentItemsThisMonth,
    };
  }, [roles, managers, users, adminClients, adminCalendar]);

  const recentUsers = useMemo(
    () =>
      [...users]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5),
    [users]
  );

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Admin Dashboard</h2>
          <p className="text-sm text-muted-foreground">Monitor team and role distribution at a glance.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/admin/users">
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add User / Manager
            </Button>
          </Link>
          <Link href="/admin/roles">
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" /> Add Role
            </Button>
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, idx) => (
            <Card key={idx}>
              <CardContent>
                <Skeleton className="h-8 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
          <StatCard title="Total Managers" value={stats.totalManagers} loading={loading} />
          <StatCard title="Total Users" value={stats.totalUsers} loading={loading} />
          <StatCard title="Active Roles" value={stats.activeRoles} loading={loading} />
          <StatCard title="System Roles" value={stats.systemRoles} loading={loading} />
          <StatCard title="Total Active Clients" value={stats.totalActiveClients} loading={loading} />
          <StatCard title="Content Items This Month" value={stats.contentItemsThisMonth} loading={loading} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center justify-between gap-3">
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-6 w-20" />
              </div>
            ))
          ) : recentUsers.length ? (
            recentUsers.map((user) => (
              <div
                key={user._id}
                className="flex flex-col gap-1 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium">{user.name}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString()}
                </p>
              </div>
            ))
          ) : (
            <EmptyState
              icon={Users}
              title="No users yet"
              description="Add your first user to start assigning work."
              ctaLabel="Add User"
              onCta={() => (window.location.href = "/admin/users")}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
