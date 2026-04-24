"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";

function formatWhen(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [busyId, setBusyId] = useState("");

  const load = async ({ silent = false } = {}) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.getMyNotifications();
      setItems(Array.isArray(res?.data) ? res.data : []);
    } catch (error) {
      toast.error(error.message || "Failed to load notifications");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== "rr:lastNotificationAt") return;
      load({ silent: true });
    };
    const onRealtime = () => load({ silent: true });
    window.addEventListener("storage", onStorage);
    window.addEventListener("rr:notification", onRealtime);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("rr:notification", onRealtime);
    };
  }, []);

  const unreadCount = useMemo(
    () => (items || []).filter((n) => n?.isRead !== true).length,
    [items]
  );

  const markRead = async (id) => {
    if (!id) return;
    try {
      setBusyId(String(id));
      await api.markNotificationRead(id);
      setItems((prev) =>
        (prev || []).map((n) =>
          String(n?._id || "") === String(id) ? { ...n, isRead: true } : n
        )
      );
    } catch (error) {
      toast.error(error.message || "Failed to mark notification as read");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="space-y-6">
      <Card className="border-sky-500/30 bg-gradient-to-r from-sky-500/15 to-transparent">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <h2 className="text-2xl font-semibold">Notifications</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Realtime and saved notifications across workflows.
            </p>
          </div>
          <Badge className="bg-sky-600 text-white">Unread: {unreadCount}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="rounded-lg border border-border p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-full" />
                  <Skeleton className="mt-2 h-3 w-40" />
                </div>
              ))}
            </div>
          ) : (items || []).length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications yet"
              description="You will see workflow, approval and reminder updates here."
            />
          ) : (
            <div className="space-y-3">
              {(items || []).map((n) => {
                const id = String(n?._id || "");
                const isRead = n?.isRead === true;
                return (
                  <div
                    key={id}
                    className={`rounded-lg border p-3 ${isRead ? "border-border" : "border-sky-500/40 bg-sky-500/5"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{n?.title || "Notification"}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{n?.message || ""}</p>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline">{String(n?.type || "info")}</Badge>
                          <span>{formatWhen(n?.createdAt)}</span>
                        </div>
                      </div>
                      {!isRead ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === id}
                          onClick={() => markRead(id)}
                        >
                          <CheckCheck className="mr-1 h-4 w-4" />
                          Mark read
                        </Button>
                      ) : (
                        <Badge variant="secondary">Read</Badge>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
