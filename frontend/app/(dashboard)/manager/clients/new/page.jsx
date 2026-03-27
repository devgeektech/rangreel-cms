"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Package as PackageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { z } from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

const stepLabels = ["Basic info", "Package & schedule", "Team"];

const teamSchema = z.object({
  strategist: z.string().optional().default(""),
  videographer: z.string().optional().default(""),
  videoEditor: z.string().optional().default(""),
  graphicDesigner: z.string().optional().default(""),
  postingExecutive: z.string().optional().default(""),
  campaignManager: z.string().optional().default(""),
  photographer: z.string().optional().default(""),
});

const fullSchema = z
  .object({
    clientName: z.string().trim().min(1, "Client Name is required"),
    brandName: z.string().trim().min(1, "Brand Name is required"),
    industry: z.string().optional().default(""),
    packageId: z.string().min(1, "Package selection is required"),
    startDate: z.string().min(1, "Start date is required"),
    team: teamSchema,
  })
  .strict();

const defaultValues = {
  clientName: "",
  brandName: "",
  industry: "",
  packageId: "",
  startDate: "",
  team: {
    strategist: "",
    videographer: "",
    videoEditor: "",
    graphicDesigner: "",
    postingExecutive: "",
    campaignManager: "",
    photographer: "",
  },
};

function toIsoUtcMidnight(dateOnly) {
  if (!dateOnly) return "";
  const m = String(dateOnly).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  return new Date(Date.UTC(year, monthIndex, day)).toISOString();
}

function StatChip({ label, value }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

function BoolBadge({ value }) {
  return (
    <Badge
      variant="outline"
      className={value ? "border-green-600/40 text-green-700 dark:text-green-200" : "text-muted-foreground"}
    >
      {value ? "Included" : "Not Included"}
    </Badge>
  );
}

export default function NewClientPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packages, setPackages] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [users, setUsers] = useState([]);

  const {
    control,
    handleSubmit,
    watch,
    trigger,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(fullSchema),
    defaultValues,
  });

  const selectedPackageId = watch("packageId");

  const loadPackages = async () => {
    try {
      setPackagesLoading(true);
      const res = await api.getManagerPackages();
      setPackages(res?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load packages");
    } finally {
      setPackagesLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      setUsersLoading(true);
      const res = await api.getTeamUsers();
      setUsers(res?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load users");
    } finally {
      setUsersLoading(false);
    }
  };

  useEffect(() => {
    loadPackages();
    loadUsers();
  }, []);

  const roleOptions = useMemo(() => {
    const map = {
      strategist: [],
      videographer: [],
      videoEditor: [],
      graphicDesigner: [],
      postingExecutive: [],
      campaignManager: [],
      photographer: [],
    };

    (users || []).forEach((u) => {
      const slug = u?.role?.slug;
      if (!slug) return;
      if (slug === "strategist") map.strategist.push(u);
      if (slug === "videographer") map.videographer.push(u);
      if (slug === "editor" || slug === "video-editor" || slug === "videoeditor") map.videoEditor.push(u);
      if (slug === "designer") map.graphicDesigner.push(u);
      if (slug === "posting") map.postingExecutive.push(u);
      if (slug === "campaign-manager") map.campaignManager.push(u);
      if (slug === "photographer") map.photographer.push(u);
    });

    return map;
  }, [users]);

  const next = async () => {
    if (step === 0) {
      const ok = await trigger(["clientName", "brandName", "industry"]);
      if (!ok) return;
    }

    if (step === 1) {
      const ok = await trigger(["packageId", "startDate"]);
      if (!ok) return;
    }

    setStep((prev) => Math.min(prev + 1, 2));
  };

  const back = () => setStep((prev) => Math.max(prev - 1, 0));

  const onSubmit = async (values) => {
    if (step !== 2) return;

    try {
      const payload = {
        clientName: values.clientName.trim(),
        brandName: values.brandName.trim(),
        industry: values.industry || "",
        businessType: "",
        socialHandles: {
          instagram: "",
          facebook: "",
          youtube: "",
          googleBusiness: "",
        },
        startDate: toIsoUtcMidnight(values.startDate),
        status: "active",
        package: values.packageId,
        team: {
          strategist: values.team?.strategist || undefined,
          videographer: values.team?.videographer || undefined,
          videoEditor: values.team?.videoEditor || undefined,
          graphicDesigner: values.team?.graphicDesigner || undefined,
          postingExecutive: values.team?.postingExecutive || undefined,
          campaignManager: values.team?.campaignManager || undefined,
          photographer: values.team?.photographer || undefined,
        },
      };

      const res = await api.createClient(payload);
      toast.success("Client created");
      router.push(`/manager/clients/${res?.data?._id}`);
    } catch (error) {
      toast.error(error.message || "Failed to create client");
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Add Client</h2>
          <p className="text-sm text-muted-foreground">Create a client and generate their monthly content calendar.</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {stepLabels.map((label, idx) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  idx === step ? "bg-primary text-primary-foreground" : idx < step ? "bg-muted text-foreground" : "bg-muted/50 text-muted-foreground"
                }`}
              >
                {idx < step ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
              </div>
              <span className={`text-sm ${idx === step ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
              {idx !== stepLabels.length - 1 ? <span className="text-muted-foreground">/</span> : null}
            </div>
          ))}
        </div>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        {step === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Basic info</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:max-w-xl">
              <Field label="Client name *" error={errors.clientName?.message}>
                <Controller
                  name="clientName"
                  control={control}
                  render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                />
              </Field>
              <Field label="Brand name *" error={errors.brandName?.message}>
                <Controller
                  name="brandName"
                  control={control}
                  render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                />
              </Field>
              <Field label="Industry" error={errors.industry?.message}>
                <Controller
                  name="industry"
                  control={control}
                  render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} placeholder="Optional" />}
                />
              </Field>
            </CardContent>
          </Card>
        ) : null}

        {step === 1 ? (
          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Schedule</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 sm:max-w-md">
                <Field label="Start date *" error={errors.startDate?.message}>
                  <Controller
                    name="startDate"
                    control={control}
                    render={({ field }) => (
                      <Input type="date" value={field.value} onChange={(e) => field.onChange(e.target.value)} />
                    )}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">Calendar starts from next working day.</p>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <PackageIcon className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold">Package</h3>
              </div>

              {packagesLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <Card key={idx}>
                      <CardHeader>
                        <Skeleton className="h-5 w-1/2" />
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-4 w-full" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {packages.map((pkg) => {
                    const selected = pkg._id === selectedPackageId;
                    return (
                      <button
                        key={pkg._id}
                        type="button"
                        onClick={() => setValue("packageId", pkg._id, { shouldValidate: true })}
                        className="text-left"
                      >
                        <Card className={selected ? "border-primary ring-2 ring-primary/20" : ""}>
                          <CardHeader className="pb-2">
                            <div className="flex items-start justify-between gap-2">
                              <CardTitle className="text-base">{pkg.name}</CardTitle>
                              {selected ? <CheckCircle2 className="h-5 w-5 text-primary" /> : null}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3 text-sm">
                            <div className="flex flex-wrap gap-2">
                              <StatChip label="Reels" value={pkg.noOfReels} />
                              <StatChip label="Static" value={pkg.noOfStaticPosts} />
                              <StatChip label="Carousels" value={pkg.noOfCarousels} />
                              <StatChip label="Reviews" value={pkg.noOfGoogleReviews} />
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">GMB Posting</span>
                              <BoolBadge value={Boolean(pkg.gmbPosting)} />
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Campaign Management</span>
                              <BoolBadge value={Boolean(pkg.campaignManagement)} />
                            </div>
                          </CardContent>
                        </Card>
                      </button>
                    );
                  })}
                </div>
              )}

              {errors.packageId?.message ? (
                <p className="text-xs text-destructive">{errors.packageId.message}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Team assignment</h3>

            {usersLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <TeamSelect label="Strategist" name="team.strategist" control={control} options={roleOptions.strategist} />
                <TeamSelect label="Videographer" name="team.videographer" control={control} options={roleOptions.videographer} />
                <TeamSelect label="Video Editor" name="team.videoEditor" control={control} options={roleOptions.videoEditor} />
                <TeamSelect label="Graphic Designer" name="team.graphicDesigner" control={control} options={roleOptions.graphicDesigner} />
                <TeamSelect label="Posting Executive" name="team.postingExecutive" control={control} options={roleOptions.postingExecutive} />
                <TeamSelect label="Campaign Manager" name="team.campaignManager" control={control} options={roleOptions.campaignManager} />
                <TeamSelect label="Photographer" name="team.photographer" control={control} options={roleOptions.photographer} />
              </div>
            )}
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={(e) => {
              e.preventDefault();
              back();
            }}
            disabled={step === 0 || isSubmitting}
          >
            <ChevronLeft className="mr-2 h-4 w-4" /> Back
          </Button>

          {step < 2 ? (
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                next();
              }}
              disabled={isSubmitting}
            >
              Next <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Client"}
            </Button>
          )}
        </div>
      </form>
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

function TeamSelect({ label, name, control, options }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Select value={field.value || "unassigned"} onValueChange={(value) => field.onChange(value === "unassigned" ? "" : value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a user" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {(options || []).map((u) => (
                <SelectItem key={u._id} value={u._id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </div>
  );
}
