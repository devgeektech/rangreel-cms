"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Edit, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

const numberField = z.preprocess((value) => {
  if (value === "" || value === null || typeof value === "undefined") {
    return 0;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}, z.number().min(0));

const packageSchema = z.object({
  name: z.preprocess(
    (value) => (typeof value === "string" ? value : ""),
    z.string().trim().min(1, "Package name is required")
  ),
  noOfReels: numberField,
  noOfStaticPosts: numberField,
  noOfCarousels: numberField,
  noOfGoogleReviews: numberField,
  gmbPosting: z.boolean(),
  campaignManagement: z.boolean(),
});

const defaultValues = {
  name: "",
  noOfReels: 0,
  noOfStaticPosts: 0,
  noOfCarousels: 0,
  noOfGoogleReviews: 0,
  gmbPosting: false,
  campaignManagement: false,
};

function BoolBadge({ enabled }) {
  return (
    <Badge
      variant="outline"
      className={enabled === true ? "border-green-600 text-green-700" : "text-muted-foreground"}
    >
      {enabled === true ? "Included" : "Not Included"}
    </Badge>
  );
}

function PackageCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-6 w-1/2" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminPackagesPage() {
  const [loading, setLoading] = useState(true);
  const [packages, setPackages] = useState([]);
  const [openForm, setOpenForm] = useState(false);
  const [editingPackage, setEditingPackage] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [gmbPostingState, setGmbPostingState] = useState(false);
  const [campaignManagementState, setCampaignManagementState] = useState(false);

  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(packageSchema),
    defaultValues,
  });

  const loadPackages = async () => {
    try {
      setLoading(true);
      const response = await api.getPackages();
      setPackages(response?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load packages");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPackages();
  }, []);

  const openCreate = () => {
    setEditingPackage(null);
    reset(defaultValues);
    setGmbPostingState(false);
    setCampaignManagementState(false);
    setOpenForm(true);
  };

  const openEdit = (pkg) => {
    setEditingPackage(pkg);
    reset({
      name: pkg.name || "",
      noOfReels: pkg.noOfReels ?? 0,
      noOfStaticPosts: pkg.noOfStaticPosts ?? 0,
      noOfCarousels: pkg.noOfCarousels ?? 0,
      noOfGoogleReviews: pkg.noOfGoogleReviews ?? 0,
      gmbPosting: Boolean(pkg.gmbPosting),
      campaignManagement: Boolean(pkg.campaignManagement),
    });
    setGmbPostingState(Boolean(pkg.gmbPosting));
    setCampaignManagementState(Boolean(pkg.campaignManagement));
    setOpenForm(true);
  };

  const onSubmit = async (values) => {
    try {
      const payload = {
        ...values,
        name: (values.name || "").trim(),
        gmbPosting: gmbPostingState === true,
        campaignManagement: campaignManagementState === true,
      };

      if (editingPackage) {
        await api.updatePackage(editingPackage._id, payload);
        toast.success("Package updated");
      } else {
        await api.createPackage(payload);
        toast.success("Package created");
      }
      setOpenForm(false);
      await loadPackages();
    } catch (error) {
      toast.error(error.message || "Failed to save package");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await api.deletePackage(pendingDelete._id);
      toast.success("Package deleted");
      setPendingDelete(null);
      await loadPackages();
    } catch (error) {
      toast.error(error.message || "Failed to delete package");
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Packages</h2>
          <p className="text-sm text-muted-foreground">Configure service deliverables by package.</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> Add Package
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 6 }).map((_, idx) => <PackageCardSkeleton key={idx} />)
          : packages.map((pkg) => (
              <Card key={pkg._id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg font-semibold">{pkg.name}</CardTitle>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => openEdit(pkg)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setPendingDelete(pkg)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Row label="Reels" value={pkg.noOfReels} />
                  <Row label="Static Posts" value={pkg.noOfStaticPosts} />
                  <Row label="Carousels" value={pkg.noOfCarousels} />
                  <Row label="Google Reviews" value={pkg.noOfGoogleReviews} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">GMB Posting</span>
                    <BoolBadge enabled={pkg.gmbPosting} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Campaign Management</span>
                    <BoolBadge enabled={pkg.campaignManagement} />
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPackage ? "Edit Package" : "Add Package"}</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={handleSubmit(onSubmit)}>
            <Field label="Package Name" error={errors.name?.message}>
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <Input
                    value={field.value ?? ""}
                    onChange={(event) => field.onChange(event.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                  />
                )}
              />
            </Field>
            <Field label="No. of Reels" error={errors.noOfReels?.message}>
              <Controller
                name="noOfReels"
                control={control}
                render={({ field }) => (
                  <Input
                    type="number"
                    min={0}
                    value={field.value ?? 0}
                    onChange={(event) => field.onChange(event.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                  />
                )}
              />
            </Field>
            <Field label="No. of Static Posts" error={errors.noOfStaticPosts?.message}>
              <Controller
                name="noOfStaticPosts"
                control={control}
                render={({ field }) => (
                  <Input
                    type="number"
                    min={0}
                    value={field.value ?? 0}
                    onChange={(event) => field.onChange(event.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                  />
                )}
              />
            </Field>
            <Field label="No. of Carousels" error={errors.noOfCarousels?.message}>
              <Controller
                name="noOfCarousels"
                control={control}
                render={({ field }) => (
                  <Input
                    type="number"
                    min={0}
                    value={field.value ?? 0}
                    onChange={(event) => field.onChange(event.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                  />
                )}
              />
            </Field>
            <Field label="No. of Google Reviews" error={errors.noOfGoogleReviews?.message}>
              <Controller
                name="noOfGoogleReviews"
                control={control}
                render={({ field }) => (
                  <Input
                    type="number"
                    min={0}
                    value={field.value ?? 0}
                    onChange={(event) => field.onChange(event.target.value)}
                    onBlur={field.onBlur}
                    name={field.name}
                  />
                )}
              />
            </Field>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label>GMB Posting</Label>
                <p className="text-xs text-muted-foreground">
                  {gmbPostingState ? "Included" : "Not Included"}
                </p>
              </div>
              <Checkbox
                checked={gmbPostingState}
                onCheckedChange={(checked) => {
                  const nextValue = checked === true;
                  setGmbPostingState(nextValue);
                  setValue("gmbPosting", nextValue, { shouldValidate: true });
                }}
                aria-label="Toggle GMB Posting"
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <Label>Campaign Management</Label>
                <p className="text-xs text-muted-foreground">
                  {campaignManagementState ? "Included" : "Not Included"}
                </p>
              </div>
              <Checkbox
                checked={campaignManagementState}
                onCheckedChange={(checked) => {
                  const nextValue = checked === true;
                  setCampaignManagementState(nextValue);
                  setValue("campaignManagement", nextValue, { shouldValidate: true });
                }}
                aria-label="Toggle Campaign Management"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpenForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Saving..." : editingPackage ? "Update Package" : "Create Package"}
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
        title="Delete package?"
        description={`${
          pendingDelete?.name || "This package"
        } will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </section>
  );
}

function Field({ label, children, error }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
