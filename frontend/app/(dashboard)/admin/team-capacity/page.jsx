"use client";

import { useCallback, useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const ROLE_LABELS = {
  strategist: "Strategist",
  videographer: "Videographer",
  videoEditor: "Video editor",
  manager: "Manager",
  postingExecutive: "Posting executive",
  graphicDesigner: "Graphic designer",
};

const ROLE_ALLOWED_FIELDS = {
  strategist: ["reelCapacity", "postCapacity", "carouselCapacity"],
  videographer: ["reelCapacity", "postCapacity", "carouselCapacity"],
  videoEditor: ["reelCapacity", "postCapacity", "carouselCapacity"],
  manager: ["reelCapacity", "postCapacity", "carouselCapacity"],
  postingExecutive: ["reelCapacity", "postCapacity", "carouselCapacity"],
  graphicDesigner: ["postCapacity", "carouselCapacity"],
};

function labelForRole(role) {
  return ROLE_LABELS[role] || role;
}

export default function AdminTeamCapacitySettingsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState({});
  const [savingRole, setSavingRole] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getTeamCapacity();
      const list = Array.isArray(res?.data) ? res.data : res;
      if (!Array.isArray(list)) {
        throw new Error("Invalid response");
      }
      setRows(list);
      const next = {};
      for (const r of list) {
        next[r.role] = {
          reelCapacity:
            r.reelCapacity === null || r.reelCapacity === undefined ? "" : String(r.reelCapacity),
          postCapacity:
            r.postCapacity === null || r.postCapacity === undefined ? "" : String(r.postCapacity),
          carouselCapacity:
            r.carouselCapacity === null || r.carouselCapacity === undefined
              ? ""
              : String(r.carouselCapacity),
        };
      }
      setDraft(next);
    } catch (e) {
      toast.error(e.message || "Failed to load role capacity");
      setRows([]);
      setDraft({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleChange = (role, field, value) => {
    setDraft((d) => ({ ...d, [role]: { ...(d[role] || {}), [field]: value } }));
  };

  const saveRole = async (role) => {
    const row = draft[role] || {};
    const allowed = ROLE_ALLOWED_FIELDS[role] || [];
    const payload = {};
    for (const field of allowed) {
      const raw = String(row[field] ?? "").trim();
      if (raw === "") {
        toast.error("Enter a non-negative number");
        return;
      }
      const n = Number(raw);
      if (Number.isNaN(n) || n < 0) {
        toast.error("Enter a non-negative number");
        return;
      }
      payload[field] = n;
    }
    try {
      setSavingRole(role);
      await api.patchTeamCapacity(role, payload);
      toast.success(`${labelForRole(role)} saved`);
      await load();
    } catch (e) {
      toast.error(e.message || "Save failed");
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-7 w-7 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">Role capacity</h1>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Global per-role capacity by content type. `0` means unlimited for that role/type.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-muted/40 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium w-[220px]">Role</th>
                  <th className="px-4 py-3 font-medium">Reels</th>
                  <th className="px-4 py-3 font-medium">Posts</th>
                  <th className="px-4 py-3 font-medium">Carousels</th>
                  <th className="px-4 py-3 font-medium text-right w-[140px]">Edit</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No roles returned.
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr key={r.role} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{labelForRole(r.role)}</td>
                      <td className="px-4 py-3">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          className="max-w-[140px]"
                          value={draft[r.role]?.reelCapacity ?? ""}
                          disabled={r.role === "graphicDesigner"}
                          onChange={(e) => handleChange(r.role, "reelCapacity", e.target.value)}
                          aria-label={`Reel capacity for ${r.role}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          className="max-w-[140px]"
                          value={draft[r.role]?.postCapacity ?? ""}
                          onChange={(e) => handleChange(r.role, "postCapacity", e.target.value)}
                          aria-label={`Post capacity for ${r.role}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          className="max-w-[140px]"
                          value={draft[r.role]?.carouselCapacity ?? ""}
                          onChange={(e) => handleChange(r.role, "carouselCapacity", e.target.value)}
                          aria-label={`Carousel capacity for ${r.role}`}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          type="button"
                          size="sm"
                          disabled={savingRole === r.role}
                          onClick={() => saveRole(r.role)}
                        >
                          {savingRole === r.role ? "Saving…" : "Save"}
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
