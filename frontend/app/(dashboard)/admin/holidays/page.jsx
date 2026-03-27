"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarOff, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { z } from "zod";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";

const holidaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please select a valid date"),
  title: z.string().trim().min(1, "Title is required"),
});

const defaultValues = {
  date: "",
  title: "",
};

function formatHolidayDate(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    // Use UTC to avoid timezone shifting day/month.
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  } catch {
    return "";
  }
}

function HolidaysTableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, idx) => (
        <div key={idx} className="grid grid-cols-[1fr_2fr_120px] items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-8 w-14 justify-self-end" />
        </div>
      ))}
    </div>
  );
}

export default function AdminHolidaysPage() {
  const [loading, setLoading] = useState(true);
  const [holidays, setHolidays] = useState([]);
  const [openForm, setOpenForm] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(holidaySchema),
    defaultValues,
  });

  const loadHolidays = async () => {
    try {
      setLoading(true);
      const res = await api.getHolidays();
      setHolidays(res?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load holidays");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHolidays();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreateModal = () => {
    reset(defaultValues);
    setOpenForm(true);
  };

  const onSubmit = async (values) => {
    try {
      await api.createHoliday(values);
      toast.success("Holiday created");
      setOpenForm(false);
      await loadHolidays();
    } catch (error) {
      toast.error(error.message || "Failed to create holiday");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await api.deleteHoliday(pendingDelete._id);
      toast.success("Holiday deleted");
      setPendingDelete(null);
      await loadHolidays();
    } catch (error) {
      toast.error(error.message || "Failed to delete holiday");
    }
  };

  const sortedHolidays = useMemo(() => {
    return [...holidays].sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [holidays]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Public Holidays</h2>
          <p className="text-sm text-muted-foreground">Manage holiday dates used by the calendar generator.</p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" /> Add Holiday
        </Button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <HolidaysTableSkeleton />
        </div>
      ) : sortedHolidays.length === 0 ? (
        <EmptyState
          icon={CalendarOff}
          title="No holidays found"
          description="Add holidays so the calendar generator can skip non-working days."
          ctaLabel="Add Holiday"
          onCta={openCreateModal}
        />
      ) : (
        <div className="rounded-xl border border-border bg-card/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedHolidays.map((holiday) => (
                <tr key={holiday._id} className="border-t">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{formatHolidayDate(holiday.date)}</Badge>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium">{holiday.title}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPendingDelete(holiday)}
                      aria-label={`Delete ${holiday.title}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Holiday</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <Label>Date</Label>
              <Controller
                name="date"
                control={control}
                render={({ field }) => (
                  <Input
                    type="date"
                    value={field.value}
                    onChange={(event) => field.onChange(event.target.value)}
                  />
                )}
              />
              {errors.date?.message ? <p className="text-xs text-destructive">{errors.date.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label>Title</Label>
              <Controller
                name="title"
                control={control}
                render={({ field }) => (
                  <Input value={field.value} onChange={(event) => field.onChange(event.target.value)} />
                )}
              />
              {errors.title?.message ? <p className="text-xs text-destructive">{errors.title.message}</p> : null}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpenForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : "Add Holiday"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title="Delete holiday?"
        description={`${pendingDelete?.title || "This holiday"} will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </section>
  );
}

