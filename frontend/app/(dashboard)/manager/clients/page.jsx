"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderOpen, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/AdminSkeletons";

function statusBadge(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "active") return <Badge>Active</Badge>;
  if (normalized === "paused") return <Badge variant="outline">Paused</Badge>;
  return <Badge variant="outline">Inactive</Badge>;
}

export default function ManagerClientsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);

  const loadClients = async () => {
    try {
      setLoading(true);
      const res = await api.getMyClients();
      setClients(res?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load clients");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
  }, []);

  const sorted = useMemo(() => {
    return [...clients].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [clients]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">My Clients</h2>
          <p className="text-sm text-muted-foreground">Create clients and manage their calendars.</p>
        </div>
        <Link href="/manager/clients/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Add Client
          </Button>
        </Link>
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3">Industry</th>
              <th className="px-4 py-3">Package</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="border-t">
                <td className="px-4 py-3" colSpan={7}>
                  <TableSkeleton rows={6} cols={7} />
                </td>
              </tr>
            ) : sorted.length ? (
              sorted.map((client) => (
                <tr
                  key={client._id}
                  className="border-t cursor-pointer transition-colors hover:bg-muted/40"
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(`/manager/clients/${client._id}`)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      router.push(`/manager/clients/${client._id}`);
                    }
                  }}
                >
                  <td className="px-4 py-3">
                    <div>
                      <p className="font-medium">{client.clientName}</p>
                      <p className="text-muted-foreground">{client.brandName}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{client.industry || "-"}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">{client.package?.name || "Package"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {client.startDate ? new Date(client.startDate).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {client.endDate ? new Date(client.endDate).toLocaleDateString() : "-"}
                  </td>
                  <td className="px-4 py-3">{statusBadge(client.status)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/manager/clients/${client._id}`} onClick={(e) => e.stopPropagation()}>
                      <Button variant="outline" size="sm" type="button">
                        View
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr className="border-t">
                <td className="px-4 py-6" colSpan={7}>
                  <EmptyState
                    icon={FolderOpen}
                    title="No clients yet"
                    description="Create your first client to generate a calendar."
                    ctaLabel="Add Client"
                    onCta={() => (window.location.href = "/manager/clients/new")}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, idx) => <Skeleton key={idx} className="h-28 w-full" />)
        ) : sorted.length ? (
          sorted.map((client) => (
            <div
              key={client._id}
              className="rounded-xl border border-border p-3 cursor-pointer transition-colors hover:bg-muted/30"
              role="button"
              tabIndex={0}
              onClick={() => router.push(`/manager/clients/${client._id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  router.push(`/manager/clients/${client._id}`);
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{client.clientName}</p>
                  <p className="text-xs text-muted-foreground">{client.brandName}</p>
                </div>
                {statusBadge(client.status)}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground">Package</p>
                  <p>{client.package?.name || "-"}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Industry</p>
                  <p>{client.industry || "-"}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Start</p>
                  <p>{client.startDate ? new Date(client.startDate).toLocaleDateString() : "-"}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">End</p>
                  <p>{client.endDate ? new Date(client.endDate).toLocaleDateString() : "-"}</p>
                </div>
              </div>
              <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                <Link href={`/manager/clients/${client._id}`} className="block">
                  <Button variant="outline" className="w-full" type="button">
                    View
                  </Button>
                </Link>
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            icon={FolderOpen}
            title="No clients yet"
            description="Create your first client to generate a calendar."
            ctaLabel="Add Client"
            onCta={() => (window.location.href = "/manager/clients/new")}
          />
        )}
      </div>
    </section>
  );
}

