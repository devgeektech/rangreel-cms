"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";
import { z } from "zod";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ContentCalendarDnd from "@/components/calendar/ContentCalendarDnd";
import { cn } from "@/lib/utils";

const stepLabels = ["Basic info", "Package & schedule", "Team"];

const optionalStr = z.string().optional().default("");

const clientBriefShape = z.object({
  usp: optionalStr,
  brandTone: z
    .enum(["luxury", "premium", "bold", "friendly", "minimal", "other", ""])
    .optional()
    .default(""),
  brandToneOther: optionalStr,
  targetAudience: optionalStr,
  keyProductsServices: optionalStr,
  priorityFocus: optionalStr,
  festivalsToTarget: optionalStr,
  language: z.enum(["english", "hindi", "other", ""]).optional().default("english"),
  languageOther: optionalStr,
  competitors: optionalStr,
  accountsYouLikeReason: optionalStr,
  mainGoal: z.enum(["awareness", "sales", "social_growth", ""]).optional().default(""),
  ageGroup: optionalStr,
  focusLocations: optionalStr,
  contentPreference: z
    .array(z.enum(["education", "promotional", "entertaining", "trend_based"]))
    .optional()
    .default([]),
  shootAvailability: z
    .object({
      storeOrOfficeForShoot: z.boolean().optional().default(false),
      productsReadyForShoot: z.boolean().optional().default(false),
      modelsAvailable: z.boolean().optional().default(false),
    })
    .optional(),
  preferredShootDaysTiming: optionalStr,
  bestPostingTime: optionalStr,
});

const socialHandlesShape = z.object({
  instagram: optionalStr,
  facebook: optionalStr,
  youtube: optionalStr,
  googleBusiness: optionalStr,
  twitter: optionalStr,
  linkedin: optionalStr,
  tiktok: optionalStr,
  pinterest: optionalStr,
  other: optionalStr,
});

const optionalTeamStr = z.string().optional().default("");

const teamGroupReelsShape = z.object({
  strategist: optionalTeamStr,
  videographer: optionalTeamStr,
  videoEditor: optionalTeamStr,
  manager: optionalTeamStr,
  postingExecutive: optionalTeamStr,
});

const teamGroupPostShape = z.object({
  strategist: optionalTeamStr,
  graphicDesigner: optionalTeamStr,
  manager: optionalTeamStr,
  postingExecutive: optionalTeamStr,
});

const REEL_KEYS = ["strategist", "videographer", "videoEditor", "manager", "postingExecutive"];
const POST_KEYS = ["strategist", "graphicDesigner", "manager", "postingExecutive"];

const filled = (s) => s != null && String(s).trim() !== "";

function buildClientSchema(packagesList) {
  return z
    .object({
      clientName: z.string().trim().min(1, "Client Name is required"),
      brandName: z.string().trim().min(1, "Brand Name is required"),
      contactNumber: optionalStr,
      email: optionalStr,
      website: optionalStr,
      socialHandles: socialHandlesShape,
      socialCredentialsNotes: optionalStr,
      clientBrief: clientBriefShape,
      industry: z.string().optional().default(""),
      packageId: z.string().min(1, "Package selection is required"),
      startDate: z.string().min(1, "Start date is required"),
      contentEnabled: z
        .object({
          reels: z.boolean().optional(),
          posts: z.boolean().optional(),
          carousel: z.boolean().optional(),
        })
        .optional(),
      team: z.object({
        reels: teamGroupReelsShape,
        posts: teamGroupPostShape,
        carousel: teamGroupPostShape,
      }),
    })
    .strict()
    .superRefine((data, ctx) => {
      const pkg = (packagesList || []).find((p) => String(p._id) === String(data.packageId));
      if (!pkg) return;

      const ce = data.contentEnabled || {};
      const reelCap = Number(pkg.noOfReels) || 0;
      const postCap = (Number(pkg.noOfPosts) || 0) + (Number(pkg.noOfStaticPosts) || 0);
      const carCap = Number(pkg.noOfCarousels) || 0;
      const reelsCount = ce.reels === false ? 0 : reelCap;
      const postsCount = ce.posts === false ? 0 : postCap;
      const carouselsCount = ce.carousel === false ? 0 : carCap;

      if (reelCap + postCap + carCap > 0 && reelsCount + postsCount + carouselsCount === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Turn on at least one of reels, static, or carousels",
          path: ["contentEnabled", "reels"],
        });
      }

      const reels = data.team.reels;
      const reelAny = REEL_KEYS.some((k) => filled(reels[k]));
      const reelAll = REEL_KEYS.every((k) => filled(reels[k]));
      if (reelsCount > 0) {
        if (!reelAll) {
          REEL_KEYS.forEach((k) => {
            if (!filled(reels[k])) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Required — reels are included in this package",
                path: ["team", "reels", k],
              });
            }
          });
        }
      } else if (reelAny) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This package has no reels — leave the reels team empty",
          path: ["team", "reels", "strategist"],
        });
      }

      const posts = data.team.posts;
      const postAny = POST_KEYS.some((k) => filled(posts[k]));
      const postAll = POST_KEYS.every((k) => filled(posts[k]));
      if (postsCount > 0) {
        if (!postAll) {
          POST_KEYS.forEach((k) => {
            if (!filled(posts[k])) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Required — static content is included for this client",
                path: ["team", "posts", k],
              });
            }
          });
        }
      } else if (postAny) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Static is not in this package — leave the static team empty",
          path: ["team", "posts", "strategist"],
        });
      }

      const carousel = data.team.carousel;
      const carAny = POST_KEYS.some((k) => filled(carousel[k]));
      const carAll = POST_KEYS.every((k) => filled(carousel[k]));
      if (carouselsCount > 0) {
        if (!carAll) {
          POST_KEYS.forEach((k) => {
            if (!filled(carousel[k])) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Required — carousels are included in this package",
                path: ["team", "carousel", k],
              });
            }
          });
        }
      } else if (carAny) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This package has no carousels — leave the carousel team empty",
          path: ["team", "carousel", "strategist"],
        });
      }
    });
}

const defaultClientBrief = {
  usp: "",
  brandTone: "",
  brandToneOther: "",
  targetAudience: "",
  keyProductsServices: "",
  priorityFocus: "",
  festivalsToTarget: "",
  language: "english",
  languageOther: "",
  competitors: "",
  accountsYouLikeReason: "",
  mainGoal: "",
  ageGroup: "",
  focusLocations: "",
  contentPreference: [],
  shootAvailability: {
    storeOrOfficeForShoot: false,
    productsReadyForShoot: false,
    modelsAvailable: false,
  },
  preferredShootDaysTiming: "",
  bestPostingTime: "",
};

const defaultValues = {
  clientName: "",
  brandName: "",
  contactNumber: "",
  email: "",
  website: "",
  socialHandles: {
    instagram: "",
    facebook: "",
    youtube: "",
    googleBusiness: "",
    twitter: "",
    linkedin: "",
    tiktok: "",
    pinterest: "",
    other: "",
  },
  socialCredentialsNotes: "",
  clientBrief: { ...defaultClientBrief },
  industry: "",
  packageId: "",
  startDate: "",
  contentEnabled: {
    reels: true,
    posts: true,
    carousel: true,
  },
  team: {
    reels: {
      strategist: "",
      videographer: "",
      videoEditor: "",
      manager: "",
      postingExecutive: "",
    },
    posts: {
      strategist: "",
      graphicDesigner: "",
      manager: "",
      postingExecutive: "",
    },
    carousel: {
      strategist: "",
      graphicDesigner: "",
      manager: "",
      postingExecutive: "",
    },
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

const emptyBriefFiles = { brandKit: [], socialCredentials: [], other: [] };

function BriefFilePicker({ label, hint, files, onFilesAdded }) {
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{label}</Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Input
        type="file"
        multiple
        className="cursor-pointer text-sm file:mr-2"
        onChange={(e) => {
          const list = e.target.files;
          if (list?.length) onFilesAdded(Array.from(list));
          e.target.value = "";
        }}
      />
      {files.length > 0 ? (
        <ul className="mt-1 max-h-28 overflow-y-auto rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`}>{f.name}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export default function NewClientPage() {
  const isCustomizationMode = true;
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [packagesLoading, setPackagesLoading] = useState(true);
  const [packages, setPackages] = useState([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [calendarDraftLoading, setCalendarDraftLoading] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState(null);
  const [customizingSchedule, setCustomizingSchedule] = useState(false);
  const [scheduleSubmitted, setScheduleSubmitted] = useState(false);
  const [calendarDraftError, setCalendarDraftError] = useState("");
  const [briefFiles, setBriefFiles] = useState(emptyBriefFiles);
  const packagesRef = useRef(packages);
  packagesRef.current = packages;

  const {
    control,
    handleSubmit,
    watch,
    trigger,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: (...args) => zodResolver(buildClientSchema(packagesRef.current))(...args),
    defaultValues,
  });

  const selectedPackageId = watch("packageId");
  const startDateWatch = watch("startDate");
  const teamWatch = watch("team");
  const contentEnabledW = watch("contentEnabled");
  const selectedPackage = useMemo(
    () => (packages || []).find((p) => String(p._id) === String(selectedPackageId)),
    [packages, selectedPackageId]
  );

  const pkgReelCap = selectedPackage ? (Number(selectedPackage.noOfReels) || 0) > 0 : false;
  const pkgPostCap =
    selectedPackage
      ? ((Number(selectedPackage.noOfPosts) || 0) + (Number(selectedPackage.noOfStaticPosts) || 0)) > 0
      : false;
  const pkgCarouselCap = selectedPackage ? (Number(selectedPackage.noOfCarousels) || 0) > 0 : false;

  const needReels = pkgReelCap && contentEnabledW?.reels !== false;
  const needPosts = pkgPostCap && contentEnabledW?.posts !== false;
  const needCarousel = pkgCarouselCap && contentEnabledW?.carousel !== false;

  const reelsCompleteNow = !needReels || REEL_KEYS.every((k) => filled(teamWatch?.reels?.[k]));
  const postsCompleteNow = !needPosts || POST_KEYS.every((k) => filled(teamWatch?.posts?.[k]));
  const carouselsCompleteNow = !needCarousel || POST_KEYS.every((k) => filled(teamWatch?.carousel?.[k]));

  // Dependency stability: `watch("team")` may keep object identity stable. These signatures
  // ensure the preview generation effect reruns when dropdown values change.
  const reelsTeamSignature = REEL_KEYS.map((k) => teamWatch?.reels?.[k] ?? "").join("|");
  const postsTeamSignature = POST_KEYS.map((k) => teamWatch?.posts?.[k] ?? "").join("|");
  const carouselsTeamSignature = POST_KEYS.map((k) => teamWatch?.carousel?.[k] ?? "").join("|");

  const missingTeams = [];
  if (needReels && !reelsCompleteNow) missingTeams.push("Reels team");
  if (needPosts && !postsCompleteNow) missingTeams.push("Static team");
  if (needCarousel && !carouselsCompleteNow) missingTeams.push("Carousel team");

  const enabledTypeLabels = [];
  if (needReels) enabledTypeLabels.push("Reels");
  if (needPosts) enabledTypeLabels.push("Static");
  if (needCarousel) enabledTypeLabels.push("Carousels");

  const keyLabelReels = {
    strategist: "Strategist",
    videographer: "Videographer",
    videoEditor: "Editor",
    manager: "Manager",
    postingExecutive: "Posting Executive",
  };
  const keyLabelPost = {
    strategist: "Strategist",
    graphicDesigner: "Graphic Designer",
    manager: "Manager",
    postingExecutive: "Posting Executive",
  };

  const missingRoleDetails = [];
  if (needReels && !reelsCompleteNow) {
    const missingKeys = REEL_KEYS.filter((k) => !filled(teamWatch?.reels?.[k]));
    missingRoleDetails.push(`Reels: ${missingKeys.map((k) => keyLabelReels[k] || k).join(", ")}`);
  }
  if (needPosts && !postsCompleteNow) {
    const missingKeys = POST_KEYS.filter((k) => !filled(teamWatch?.posts?.[k]));
    missingRoleDetails.push(`Static: ${missingKeys.map((k) => keyLabelPost[k] || k).join(", ")}`);
  }
  if (needCarousel && !carouselsCompleteNow) {
    const missingKeys = POST_KEYS.filter((k) => !filled(teamWatch?.carousel?.[k]));
    missingRoleDetails.push(`Carousels: ${missingKeys.map((k) => keyLabelPost[k] || k).join(", ")}`);
  }

  /** Only reset toggles when the user picks a different package — not on unrelated re-renders. */
  const scheduleSyncedPackageIdRef = useRef(null);
  useEffect(() => {
    if (!selectedPackageId) {
      scheduleSyncedPackageIdRef.current = null;
      return;
    }
    const idStr = String(selectedPackageId);
    const pkg = (packages || []).find((p) => String(p._id) === idStr);
    if (!pkg) return;
    if (scheduleSyncedPackageIdRef.current === idStr) return;
    scheduleSyncedPackageIdRef.current = idStr;
    setValue(
      "contentEnabled",
      {
        reels: (Number(pkg.noOfReels) || 0) > 0,
        posts: (Number(pkg.noOfPosts) || 0) + (Number(pkg.noOfStaticPosts) || 0) > 0,
        carousel: (Number(pkg.noOfCarousels) || 0) > 0,
      },
      { shouldValidate: false }
    );
  }, [selectedPackageId, packages, setValue]);

  useEffect(() => {
    if (!contentEnabledW) return;
    if (contentEnabledW.reels === false) {
      setValue("team.reels", { ...defaultValues.team.reels });
    }
    if (contentEnabledW.posts === false) {
      setValue("team.posts", { ...defaultValues.team.posts });
    }
    if (contentEnabledW.carousel === false) {
      setValue("team.carousel", { ...defaultValues.team.carousel });
    }
  }, [contentEnabledW, setValue]);

  useEffect(() => {
    if (step !== 2) return;
    if (!selectedPackageId) return;
    if (!startDateWatch) return;
    if (!selectedPackage) return;

    const reelsComplete = !needReels || REEL_KEYS.every((k) => filled(teamWatch?.reels?.[k]));
    const postsComplete = !needPosts || POST_KEYS.every((k) => filled(teamWatch?.posts?.[k]));
    const carouselsComplete = !needCarousel || POST_KEYS.every((k) => filled(teamWatch?.carousel?.[k]));

    if (!reelsComplete || !postsComplete || !carouselsComplete) return;

    let mounted = true;
    setCalendarDraftLoading(true);
    setCalendarDraftError("");

    const t = setTimeout(async () => {
      try {
        const res = await api.generateCalendarDraft({
          packageId: selectedPackageId,
          startDate: startDateWatch,
          team: teamWatch,
          contentEnabled: contentEnabledW || {},
        });

        const payload = res?.data ?? res;
        if (!mounted) return;
        setCalendarDraft(payload || null);
        setCustomizingSchedule(false);
        setScheduleSubmitted(false);
      } catch (err) {
        if (!mounted) return;
        setCalendarDraft(null);
        setCalendarDraftError(err?.message || "Failed to generate schedule preview");
      } finally {
        if (!mounted) return;
        setCalendarDraftLoading(false);
      }
    }, 450);

    return () => {
      mounted = false;
      clearTimeout(t);
    };
  }, [
    step,
    selectedPackageId,
    startDateWatch,
    selectedPackage,
    needReels,
    needPosts,
    needCarousel,
    reelsTeamSignature,
    postsTeamSignature,
    carouselsTeamSignature,
    contentEnabledW,
  ]);

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
      manager: [],
    };

    (users || []).forEach((u) => {
      const slug = u?.role?.slug;
      if (!slug) return;
      if (slug === "strategist") map.strategist.push(u);
      if (slug === "videographer") map.videographer.push(u);
      if (slug === "editor" || slug === "video-editor" || slug === "videoeditor") map.videoEditor.push(u);
      if (slug === "designer") map.graphicDesigner.push(u);
      if (slug === "posting") map.postingExecutive.push(u);
      if (slug === "manager" || slug === "campaign-manager") map.manager.push(u);
    });

    return map;
  }, [users]);

  const userById = useMemo(() => {
    const map = {};
    (users || []).forEach((u) => {
      if (u?._id) map[String(u._id)] = u;
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
      const brief = values.clientBrief || {};
      const payload = {
        clientName: values.clientName.trim(),
        brandName: values.brandName.trim(),
        contactNumber: (values.contactNumber || "").trim(),
        email: (values.email || "").trim(),
        website: (values.website || "").trim(),
        industry: values.industry || "",
        businessType: "",
        socialCredentialsNotes: (values.socialCredentialsNotes || "").trim(),
        socialHandles: {
          instagram: (values.socialHandles?.instagram || "").trim(),
          facebook: (values.socialHandles?.facebook || "").trim(),
          youtube: (values.socialHandles?.youtube || "").trim(),
          googleBusiness: (values.socialHandles?.googleBusiness || "").trim(),
          twitter: (values.socialHandles?.twitter || "").trim(),
          linkedin: (values.socialHandles?.linkedin || "").trim(),
          tiktok: (values.socialHandles?.tiktok || "").trim(),
          pinterest: (values.socialHandles?.pinterest || "").trim(),
          other: (values.socialHandles?.other || "").trim(),
        },
        clientBrief: {
          ...defaultClientBrief,
          ...brief,
          contentPreference: Array.isArray(brief.contentPreference) ? brief.contentPreference : [],
          shootAvailability: {
            ...defaultClientBrief.shootAvailability,
            ...(brief.shootAvailability || {}),
          },
        },
        startDate: toIsoUtcMidnight(values.startDate),
        status: "active",
        package: values.packageId,
        contentEnabled: {
          reels: values.contentEnabled?.reels !== false,
          posts: values.contentEnabled?.posts !== false,
          carousel: values.contentEnabled?.carousel !== false,
        },
        calendarDraft: calendarDraft && Array.isArray(calendarDraft.items) ? calendarDraft : undefined,
        customStages:
          calendarDraft && Array.isArray(calendarDraft.items)
            ? calendarDraft.items.map((item) => ({
                contentItemId: item.contentId,
                type: item.type,
                title: item.title,
                postingDate: item.postingDate,
                stages: (item.stages || []).map((s) => ({
                  stageName: s.name,
                  dueDate: s.date,
                  role: s.role,
                  assignedUser: s.assignedUser,
                  status: s.status,
                })),
              }))
            : undefined,
        team: {
          reels: {
            strategist: values.team?.reels?.strategist || undefined,
            videographer: values.team?.reels?.videographer || undefined,
            videoEditor: values.team?.reels?.videoEditor || undefined,
            manager: values.team?.reels?.manager || undefined,
            postingExecutive: values.team?.reels?.postingExecutive || undefined,
          },
          posts: {
            strategist: values.team?.posts?.strategist || undefined,
            graphicDesigner: values.team?.posts?.graphicDesigner || undefined,
            manager: values.team?.posts?.manager || undefined,
            postingExecutive: values.team?.posts?.postingExecutive || undefined,
          },
          carousel: {
            strategist: values.team?.carousel?.strategist || undefined,
            graphicDesigner: values.team?.carousel?.graphicDesigner || undefined,
            manager: values.team?.carousel?.manager || undefined,
            postingExecutive: values.team?.carousel?.postingExecutive || undefined,
          },
        },
      };

      const res = await api.createClient(payload);
      const clientId = res?.data?._id;
      const fileCount =
        briefFiles.brandKit.length + briefFiles.socialCredentials.length + briefFiles.other.length;
      if (clientId && fileCount > 0) {
        try {
          const formData = new FormData();
          briefFiles.brandKit.forEach((f) => formData.append("brandKit", f));
          briefFiles.socialCredentials.forEach((f) => formData.append("socialCredentials", f));
          briefFiles.other.forEach((f) => formData.append("other", f));
          await api.uploadClientBriefAssets(clientId, formData);
        } catch (uploadErr) {
          toast.error(
            uploadErr.message || "Client was created, but file upload failed. Add files from the client page."
          );
          router.push(`/manager/clients/${clientId}`);
          return;
        }
      }
      toast.success("Client created");
      if (clientId) router.push(`/manager/clients/${clientId}`);
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
          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle>Client info</CardTitle>
                <CardDescription>
                  Capture brand, contact, positioning, and production preferences. Upload brand kit, credentials, and
                  other files directly — they are stored securely for your team.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Name *" error={errors.clientName?.message}>
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
                <Field label="Contact number" error={errors.contactNumber?.message}>
                  <Controller
                    name="contactNumber"
                    control={control}
                    render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                  />
                </Field>
                <Field label="Email" error={errors.email?.message}>
                  <Controller
                    name="email"
                    control={control}
                    render={({ field }) => <Input type="email" value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                  />
                </Field>
                <Field label="Website" error={errors.website?.message}>
                  <Controller
                    name="website"
                    control={control}
                    render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} placeholder="https://..." />}
                  />
                </Field>
                <Field label="Industry" error={errors.industry?.message}>
                  <Controller
                    name="industry"
                    control={control}
                    render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} placeholder="Optional" />}
                  />
                </Field>

                <div className="md:col-span-2">
                  <Label className="mb-2 block">All social media credentials (free text)</Label>
                  <Controller
                    name="socialCredentialsNotes"
                    control={control}
                    render={({ field }) => (
                      <TextArea {...field} placeholder="Handles, passwords shared securely, agency access notes…" />
                    )}
                  />
                </div>

                <div className="md:col-span-2 border-t border-border pt-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Social handles (optional rows)</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["socialHandles.instagram", "Instagram"],
                      ["socialHandles.facebook", "Facebook"],
                      ["socialHandles.youtube", "YouTube"],
                      ["socialHandles.googleBusiness", "Google Business"],
                      ["socialHandles.twitter", "X / Twitter"],
                      ["socialHandles.linkedin", "LinkedIn"],
                      ["socialHandles.tiktok", "TikTok"],
                      ["socialHandles.pinterest", "Pinterest"],
                      ["socialHandles.other", "Other"],
                    ].map(([name, label]) => (
                      <Field key={name} label={label}>
                        <Controller
                          name={name}
                          control={control}
                          render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                        />
                      </Field>
                    ))}
                  </div>
                </div>

                <div className="md:col-span-2 border-t border-border pt-4">
                  <Label className="mb-1">USP — what makes you different?</Label>
                  <Controller
                    name="clientBrief.usp"
                    control={control}
                    render={({ field }) => <TextArea {...field} />}
                  />
                </div>

                <Field label="Brand tone" error={errors.clientBrief?.brandTone?.message}>
                  <Controller
                    name="clientBrief.brandTone"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={(v) => field.onChange(v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose one" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="luxury">Luxury</SelectItem>
                          <SelectItem value="premium">Premium</SelectItem>
                          <SelectItem value="bold">Bold</SelectItem>
                          <SelectItem value="friendly">Friendly</SelectItem>
                          <SelectItem value="minimal">Minimal</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                {(watch("clientBrief.brandTone") === "other") ? (
                  <Field label="Brand tone (other)">
                    <Controller
                      name="clientBrief.brandToneOther"
                      control={control}
                      render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                    />
                  </Field>
                ) : null}

                <div className="md:col-span-2">
                  <Label className="mb-1">Who is your target audience?</Label>
                  <Controller
                    name="clientBrief.targetAudience"
                    control={control}
                    render={({ field }) => <TextArea {...field} />}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-1">Key products / services</Label>
                  <Controller
                    name="clientBrief.keyProductsServices"
                    control={control}
                    render={({ field }) => <TextArea {...field} />}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-1">Priority focus — what do you want to push?</Label>
                  <Controller
                    name="clientBrief.priorityFocus"
                    control={control}
                    render={({ field }) => <TextArea {...field} />}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-1">Festivals to target aggressively</Label>
                  <Controller
                    name="clientBrief.festivalsToTarget"
                    control={control}
                    render={({ field }) => <TextArea {...field} />}
                  />
                </div>

                <Field label="Language">
                  <Controller
                    name="clientBrief.language"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={(v) => field.onChange(v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="english">English</SelectItem>
                          <SelectItem value="hindi">Hindi</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                {(watch("clientBrief.language") === "other") ? (
                  <Field label="Language (other)">
                    <Controller
                      name="clientBrief.languageOther"
                      control={control}
                      render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                    />
                  </Field>
                ) : null}

                <div className="md:col-span-2">
                  <Label className="mb-1">Competitors</Label>
                  <Controller
                    name="clientBrief.competitors"
                    control={control}
                    render={({ field }) => <TextArea {...field} />}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-1">Accounts you like — and why</Label>
                  <Controller
                    name="clientBrief.accountsYouLikeReason"
                    control={control}
                    render={({ field }) => <TextArea {...field} />}
                  />
                </div>

                <Field label="Main goal">
                  <Controller
                    name="clientBrief.mainGoal"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={(v) => field.onChange(v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose one" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="awareness">Awareness</SelectItem>
                          <SelectItem value="sales">Sales</SelectItem>
                          <SelectItem value="social_growth">Social growth</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>

                <Field label="Age group">
                  <Controller
                    name="clientBrief.ageGroup"
                    control={control}
                    render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                  />
                </Field>

                <div className="md:col-span-2">
                  <Label className="mb-1">Locations we must focus on</Label>
                  <Controller
                    name="clientBrief.focusLocations"
                    control={control}
                    render={({ field }) => <TextArea {...field} />}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-2 block">Content you prefer (multi-select)</Label>
                  <Controller
                    name="clientBrief.contentPreference"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-3">
                        {[
                          ["education", "Educational"],
                          ["promotional", "Promotional"],
                          ["entertaining", "Entertaining"],
                          ["trend_based", "Trend-based"],
                        ].map(([value, label]) => {
                          const set = new Set(field.value || []);
                          const checked = set.has(value);
                          return (
                            <label key={value} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(next) => {
                                  const s = new Set(field.value || []);
                                  if (next === true) s.add(value);
                                  else s.delete(value);
                                  field.onChange(Array.from(s));
                                }}
                              />
                              {label}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  />
                </div>

                <div className="md:col-span-2 border-t border-border pt-4">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">Do you have the following for shoot?</p>
                  <div className="flex flex-col gap-2">
                    {[
                      ["clientBrief.shootAvailability.storeOrOfficeForShoot", "Store / office location for shoot"],
                      ["clientBrief.shootAvailability.productsReadyForShoot", "Products ready for shoot"],
                      ["clientBrief.shootAvailability.modelsAvailable", "Models available"],
                    ].map(([name, label]) => (
                      <Controller
                        key={name}
                        name={name}
                        control={control}
                        render={({ field }) => (
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox checked={field.value === true} onCheckedChange={(v) => field.onChange(v === true)} />
                            {label}
                          </label>
                        )}
                      />
                    ))}
                  </div>
                </div>

                <Field label="Preferred shoot days / timing">
                  <Controller
                    name="clientBrief.preferredShootDaysTiming"
                    control={control}
                    render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                  />
                </Field>
                <Field label="Best posting time (if any)">
                  <Controller
                    name="clientBrief.bestPostingTime"
                    control={control}
                    render={({ field }) => <Input value={field.value} onChange={(e) => field.onChange(e.target.value)} />}
                  />
                </Field>

                <div className="md:col-span-2 border-t border-border pt-4">
                  <p className="mb-2 text-sm font-medium">Onboarding files</p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Upload brand kit / identity, social media credential exports, and any other items we must have. You can
                    select multiple files per category (max 50MB each). Files are saved right after the client is created.
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <BriefFilePicker
                      label="Brand kit / identity"
                      hint="Logos, fonts, guidelines, ZIPs, PDFs, etc."
                      files={briefFiles.brandKit}
                      onFilesAdded={(added) =>
                        setBriefFiles((prev) => ({ ...prev, brandKit: [...prev.brandKit, ...added] }))
                      }
                    />
                    <BriefFilePicker
                      label="Social media credentials"
                      hint="Exports or documents with handles / access details."
                      files={briefFiles.socialCredentials}
                      onFilesAdded={(added) =>
                        setBriefFiles((prev) => ({ ...prev, socialCredentials: [...prev.socialCredentials, ...added] }))
                      }
                    />
                    <div className="sm:col-span-2">
                      <BriefFilePicker
                        label="Other essential files"
                        hint="Briefs, contracts, reference assets, etc."
                        files={briefFiles.other}
                        onFilesAdded={(added) =>
                          setBriefFiles((prev) => ({ ...prev, other: [...prev.other, ...added] }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
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
                              <StatChip label="Static" value={(Number(pkg.noOfPosts) || 0) + (Number(pkg.noOfStaticPosts) || 0)} />
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

              {selectedPackage ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Content to schedule</CardTitle>
                    <p className="text-xs font-normal text-muted-foreground">
                      Uncheck types you don’t need for this client (e.g. only reels). Team assignment follows these checkboxes.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <ScheduleToggleRow
                      label={`Reels (${Number(selectedPackage.noOfReels) || 0} in package)`}
                      disabled={!((Number(selectedPackage.noOfReels) || 0) > 0)}
                      name="contentEnabled.reels"
                      control={control}
                    />
                    <ScheduleToggleRow
                      label={`Static (${(Number(selectedPackage.noOfPosts) || 0) + (Number(selectedPackage.noOfStaticPosts) || 0)} in package)`}
                      disabled={!(((Number(selectedPackage.noOfPosts) || 0) + (Number(selectedPackage.noOfStaticPosts) || 0)) > 0)}
                      name="contentEnabled.posts"
                      control={control}
                    />
                    <ScheduleToggleRow
                      label={`Carousels (${Number(selectedPackage.noOfCarousels) || 0} in package)`}
                      disabled={!((Number(selectedPackage.noOfCarousels) || 0) > 0)}
                      name="contentEnabled.carousel"
                      control={control}
                    />
                  </CardContent>
                </Card>
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
              <div className="space-y-5">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">🎬 Reels team</CardTitle>
                    <p className="text-xs font-normal text-muted-foreground">
                      {needReels
                        ? "Scheduled for this client — assign all five roles."
                        : "Not scheduled — leave empty (enable “Reels” under Content to schedule if this package includes reels)."}
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <TeamSelect
                      label={needReels ? "Strategist *" : "Strategist"}
                      name="team.reels.strategist"
                      control={control}
                      options={roleOptions.strategist}
                      error={errors.team?.reels?.strategist?.message}
                    />
                    <TeamSelect
                      label={needReels ? "Videographer *" : "Videographer"}
                      name="team.reels.videographer"
                      control={control}
                      options={roleOptions.videographer}
                      error={errors.team?.reels?.videographer?.message}
                    />
                    <TeamSelect
                      label={needReels ? "Editor *" : "Editor"}
                      name="team.reels.videoEditor"
                      control={control}
                      options={roleOptions.videoEditor}
                      error={errors.team?.reels?.videoEditor?.message}
                    />
                    <TeamSelect
                      label={needReels ? "Manager *" : "Manager"}
                      name="team.reels.manager"
                      control={control}
                      options={roleOptions.manager}
                      error={errors.team?.reels?.manager?.message}
                    />
                    <TeamSelect
                      label={needReels ? "Posting Executive *" : "Posting Executive"}
                      name="team.reels.postingExecutive"
                      control={control}
                      options={roleOptions.postingExecutive}
                      error={errors.team?.reels?.postingExecutive?.message}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">🖼 Static team</CardTitle>
                    <p className="text-xs font-normal text-muted-foreground">
                      {needPosts
                        ? "Scheduled for this client — assign all four roles."
                        : "Not scheduled — leave empty."}
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <TeamSelect
                      label={needPosts ? "Strategist *" : "Strategist"}
                      name="team.posts.strategist"
                      control={control}
                      options={roleOptions.strategist}
                      error={errors.team?.posts?.strategist?.message}
                    />
                    <TeamSelect
                      label={needPosts ? "Graphic Designer *" : "Graphic Designer"}
                      name="team.posts.graphicDesigner"
                      control={control}
                      options={roleOptions.graphicDesigner}
                      error={errors.team?.posts?.graphicDesigner?.message}
                    />
                    <TeamSelect
                      label={needPosts ? "Manager *" : "Manager"}
                      name="team.posts.manager"
                      control={control}
                      options={roleOptions.manager}
                      error={errors.team?.posts?.manager?.message}
                    />
                    <TeamSelect
                      label={needPosts ? "Posting Executive *" : "Posting Executive"}
                      name="team.posts.postingExecutive"
                      control={control}
                      options={roleOptions.postingExecutive}
                      error={errors.team?.posts?.postingExecutive?.message}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">📚 Carousel team</CardTitle>
                    <p className="text-xs font-normal text-muted-foreground">
                      {needCarousel
                        ? "Scheduled for this client — assign all four roles."
                        : "Not scheduled — leave empty (uncheck Carousels under Content to schedule on the package step if you only want reels)."}
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <TeamSelect
                      label={needCarousel ? "Strategist *" : "Strategist"}
                      name="team.carousel.strategist"
                      control={control}
                      options={roleOptions.strategist}
                      error={errors.team?.carousel?.strategist?.message}
                    />
                    <TeamSelect
                      label={needCarousel ? "Graphic Designer *" : "Graphic Designer"}
                      name="team.carousel.graphicDesigner"
                      control={control}
                      options={roleOptions.graphicDesigner}
                      error={errors.team?.carousel?.graphicDesigner?.message}
                    />
                    <TeamSelect
                      label={needCarousel ? "Manager *" : "Manager"}
                      name="team.carousel.manager"
                      control={control}
                      options={roleOptions.manager}
                      error={errors.team?.carousel?.manager?.message}
                    />
                    <TeamSelect
                      label={needCarousel ? "Posting Executive *" : "Posting Executive"}
                      name="team.carousel.postingExecutive"
                      control={control}
                      options={roleOptions.postingExecutive}
                      error={errors.team?.carousel?.postingExecutive?.message}
                    />
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        ) : null}

        {step === 2 ? (
          <Card className="mt-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">📅 Schedule preview</CardTitle>
              <CardDescription>
                Auto schedule is read-only. Customize to reschedule stages; capacity warnings are non-blocking.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {calendarDraftError ? (
                <p className="text-sm text-destructive">{calendarDraftError}</p>
              ) : calendarDraftLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-10 w-full" />
                  ))}
                </div>
              ) : calendarDraft && Array.isArray(calendarDraft.items) && calendarDraft.items.length > 0 ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    {!customizingSchedule ? (
                      <Button
                        type="button"
                        onClick={() => {
                          setCustomizingSchedule(true);
                          setScheduleSubmitted(false);
                        }}
                      >
                        Customize Schedule
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        onClick={() => {
                          setCustomizingSchedule(false);
                          setScheduleSubmitted(true);
                          toast.success("Schedule saved in preview (warnings allowed)");
                        }}
                      >
                        {scheduleSubmitted ? "Schedule Submitted" : "Submit schedule"}
                      </Button>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {customizingSchedule ? "Drag stages to reschedule" : "Preview mode"}
                    </span>
                  </div>

                  <ContentCalendarDnd
                    draft={calendarDraft}
                    controlledDraft
                    canEdit={customizingSchedule}
                    isCustomizationMode={isCustomizationMode}
                    editableStageNames={customizingSchedule ? ["Plan", "Shoot", "Edit", "Approval", "Post"] : ["Plan", "Shoot", "Edit", "Approval"]}
                    conflictMode="new"
                    roleCapMap={{}}
                    saving={false}
                    userById={userById}
                    onCalendarStateChange={(nextDraft) => setCalendarDraft(nextDraft)}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {calendarDraft && Array.isArray(calendarDraft.items) && calendarDraft.items.length === 0
                    ? "Schedule preview generated 0 items. Check that enabled content types have counts in the selected package."
                    : missingTeams.length
                      ? `Fill required teams to generate schedule preview (${missingRoleDetails.join("; ")}).`
                      : enabledTypeLabels.length
                        ? `Teams for enabled types (${enabledTypeLabels.join(", ")}) look complete, but preview is not generated yet. Change any team selection or refresh.`
                        : "Fill required teams to generate schedule preview."}
                </p>
              )}
            </CardContent>
          </Card>
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
            <Button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Creating..." : "Create Client"}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}

function TextArea({ className, ...props }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-[96px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    />
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

function ScheduleToggleRow({ label, disabled, name, control }) {
  const inputId = useId();
  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => {
        const checked = disabled ? false : field.value !== false;
        return (
          <div
            className={`flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2 ${disabled ? "bg-muted/40 opacity-70" : ""}`}
          >
            <label htmlFor={inputId} className={`flex-1 cursor-pointer text-sm ${disabled ? "cursor-not-allowed" : ""}`}>
              {label}
            </label>
            <Checkbox
              id={inputId}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(next) => {
                if (!disabled) field.onChange(next === true);
              }}
            />
          </div>
        );
      }}
    />
  );
}

function TeamSelect({ label, name, control, options, error }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          const selected = (options || []).find((u) => String(u?._id) === String(field.value));
          return (
          <Select value={field.value || undefined} onValueChange={(value) => field.onChange(value)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a user">
                {selected?.name || (field.value ? "Selected user" : "")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(options || []).map((u) => (
                <SelectItem key={u._id} value={u._id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          );
        }}
      />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
