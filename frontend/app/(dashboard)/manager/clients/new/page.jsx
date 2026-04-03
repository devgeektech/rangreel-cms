"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Package as PackageIcon,
  Plus,
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { z } from "zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ContentCalendarDnd from "@/components/calendar/ContentCalendarDnd";
import { cn } from "@/lib/utils";

const stepLabels = ["Basic info", "Package & schedule", "Team"];

const optionalStr = z.string().optional().default("");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TARGET_AUDIENCE_OPTIONS = [
  "Under 10",
  "10 – 15",
  "16 – 20",
  "21 – 25",
  "26 – 30",
  "31 – 40",
  "41 – 50",
  "51 – 60",
  "60+",
  "All ages",
];

const AGE_GROUP_OPTIONS = [
  { value: "gen_alpha", label: "Gen Alpha (born 2013+)" },
  { value: "gen_z", label: "Gen Z (born 1997–2012)" },
  { value: "millennials", label: "Millennials (born 1981–1996)" },
  { value: "gen_x", label: "Gen X (born 1965–1980)" },
  { value: "baby_boomers", label: "Baby Boomers (born 1946–1964)" },
  { value: "silent", label: "Silent Generation (born before 1946)" },
  { value: "mixed", label: "Mixed / All age groups" },
];

const WEEKDAY_OPTIONS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const SOCIAL_HANDLE_PLACEHOLDERS = {
  "socialHandles.instagram": "@username or instagram.com/…",
  "socialHandles.facebook": "Page name or facebook.com/…",
  "socialHandles.youtube": "Channel name or youtube.com/…",
  "socialHandles.googleBusiness": "Business name or Maps URL",
  "socialHandles.twitter": "@handle or x.com/…",
  "socialHandles.linkedin": "Company or profile URL",
  "socialHandles.pinterest": "@username or pinterest.com/…",
  "socialHandles.other": "Link or handle",
};

function buildHalfHourTimeOptions() {
  const out = [];
  for (let h = 0; h < 24; h += 1) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      const value = `${hh}:${mm}`;
      const d = new Date(Date.UTC(1970, 0, 1, h, m));
      const label = d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "UTC",
      });
      out.push({ value, label });
    }
  }
  return out;
}

const HALF_HOUR_TIME_OPTIONS = buildHalfHourTimeOptions();

const bestPostingTimeShape = z
  .object({
    from: z.string().optional().default(""),
    to: z.string().optional().default(""),
  })
  .superRefine((data, ctx) => {
    const from = (data.from || "").trim();
    const to = (data.to || "").trim();
    if (!from && !to) return;
    if (!from) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select a start time", path: ["from"] });
    }
    if (!to) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Select an end time", path: ["to"] });
    }
    if (from && to && from >= to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End time must be after start time",
        path: ["to"],
      });
    }
  });

const clientBriefShape = z.object({
  usp: optionalStr,
  brandTone: z
    .enum(["luxury", "premium", "bold", "friendly", "minimal", "other", ""])
    .optional()
    .default(""),
  brandToneOther: optionalStr,
  targetAudience: z.array(z.string()).optional().default([]),
  keyProductsServices: optionalStr,
  priorityFocus: optionalStr,
  festivalsToTarget: optionalStr,
  language: z.enum(["english", "hindi", "other", ""]).optional().default("english"),
  languageOther: optionalStr,
  competitors: optionalStr,
  accountsYouLikeReason: optionalStr,
  mainGoal: z.enum(["awareness", "sales", "social_growth", ""]).optional().default(""),
  ageGroup: z
    .string()
    .optional()
    .default("")
    .refine(
      (v) => !v || AGE_GROUP_OPTIONS.some((o) => o.value === v),
      "Select a valid age group"
    ),
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
  preferredShootDaysTiming: z.array(z.string()).optional().default([]),
  bestPostingTime: bestPostingTimeShape.optional().default({ from: "", to: "" }),
});

const socialHandlesShape = z.object({
  instagram: optionalStr,
  facebook: optionalStr,
  youtube: optionalStr,
  googleBusiness: optionalStr,
  twitter: optionalStr,
  linkedin: optionalStr,
  pinterest: optionalStr,
  other: optionalStr,
});

const optionalTeamStr = z.string().optional().default("");

const teamAssignmentShape = z.object({
  strategist: optionalTeamStr,
  videographer: optionalTeamStr,
  editor: optionalTeamStr,
  graphicDesigner: optionalTeamStr,
  manager: optionalTeamStr,
  postingExecutive: optionalTeamStr,
});

/** Same content-type flags as package counts (includes noOfPosts + noOfStaticPosts for static). */
function packageTeamFlags(pkg) {
  if (!pkg) return { hasReels: false, hasStatic: false, hasCarousels: false };
  return {
    hasReels: (Number(pkg.noOfReels) || 0) > 0,
    hasStatic: (Number(pkg.noOfStaticPosts) || 0) + (Number(pkg.noOfPosts) || 0) > 0,
    hasCarousels: (Number(pkg.noOfCarousels) || 0) > 0,
  };
}

function deriveTeamRoleNeeds({ hasReels, hasStatic, hasCarousels }) {
  const anyContent = hasReels || hasStatic || hasCarousels;
  return {
    needsStrategist: anyContent,
    needsVideographer: hasReels,
    needsEditor: hasReels,
    needsGraphicDesigner: hasStatic || hasCarousels,
    needsManager: anyContent,
    needsPostingExecutive: anyContent,
  };
}

/** Maps flat teamAssignment to API shape expected by calendar + createClient. */
function legacyTeamFromAssignment(ta, hasReels, hasStatic, hasCarousels) {
  const s = (v) => (filled(v) ? v : "");
  const a = ta || {};
  const reels = {
    strategist: "",
    videographer: "",
    videoEditor: "",
    manager: "",
    postingExecutive: "",
  };
  const posts = {
    strategist: "",
    graphicDesigner: "",
    manager: "",
    postingExecutive: "",
  };
  const carousel = { strategist: "", graphicDesigner: "", manager: "", postingExecutive: "" };

  if (hasReels) {
    reels.strategist = s(a.strategist);
    reels.videographer = s(a.videographer);
    reels.videoEditor = s(a.editor);
    reels.manager = s(a.manager);
    reels.postingExecutive = s(a.postingExecutive);
  }
  if (hasStatic) {
    posts.strategist = s(a.strategist);
    posts.graphicDesigner = s(a.graphicDesigner);
    posts.manager = s(a.manager);
    posts.postingExecutive = s(a.postingExecutive);
  }
  if (hasCarousels) {
    carousel.strategist = s(a.strategist);
    carousel.graphicDesigner = s(a.graphicDesigner);
    carousel.manager = s(a.manager);
    carousel.postingExecutive = s(a.postingExecutive);
  }
  return { reels, posts, carousel };
}

function buildTeamAssignmentPayload(ta, needs) {
  const a = ta || {};
  const pick = (key, need) => (need && filled(a[key]) ? a[key] : null);
  return {
    strategist: pick("strategist", needs.needsStrategist),
    videographer: pick("videographer", needs.needsVideographer),
    editor: pick("editor", needs.needsEditor),
    graphicDesigner: pick("graphicDesigner", needs.needsGraphicDesigner),
    manager: pick("manager", needs.needsManager),
    postingExecutive: pick("postingExecutive", needs.needsPostingExecutive),
  };
}

const TEAM_FIELD_LABELS = {
  strategist: "Strategist",
  videographer: "Videographer",
  editor: "Editor",
  graphicDesigner: "Graphic Designer",
  manager: "Manager",
  postingExecutive: "Posting Executive",
};

const TEAM_SELECT_CONFIG = [
  { field: "strategist", label: "Strategist", needsKey: "needsStrategist", optionsKey: "strategist" },
  { field: "videographer", label: "Videographer", needsKey: "needsVideographer", optionsKey: "videographer" },
  { field: "editor", label: "Editor", needsKey: "needsEditor", optionsKey: "videoEditor" },
  { field: "graphicDesigner", label: "Graphic Designer", needsKey: "needsGraphicDesigner", optionsKey: "graphicDesigner" },
  { field: "manager", label: "Manager", needsKey: "needsManager", optionsKey: "manager" },
  { field: "postingExecutive", label: "Posting Executive", needsKey: "needsPostingExecutive", optionsKey: "postingExecutive" },
];

const filled = (s) => s != null && String(s).trim() !== "";

/** Derived scheduling flags from package counts (no manual toggles). */
function getContentEnabledFromPackage(pkg) {
  if (!pkg) {
    return { reels: false, posts: false, carousel: false, googleReviews: false };
  }
  const reelCap = Number(pkg.noOfReels) || 0;
  const postCap = (Number(pkg.noOfPosts) || 0) + (Number(pkg.noOfStaticPosts) || 0);
  const carCap = Number(pkg.noOfCarousels) || 0;
  const reviewCap = Number(pkg.noOfGoogleReviews) || 0;
  return {
    reels: reelCap > 0,
    posts: postCap > 0,
    carousel: carCap > 0,
    googleReviews: reviewCap > 0,
  };
}

function buildClientSchema(packagesList) {
  return z
    .object({
      clientName: z
        .string()
        .trim()
        .min(1, "Name is required")
        .min(2, "Name must be at least 2 characters"),
      brandName: z
        .string()
        .trim()
        .min(1, "Brand name is required")
        .min(2, "Brand name must be at least 2 characters"),
      contactNumber: z
        .string()
        .trim()
        .min(1, "Contact number is required")
        .refine((val) => {
          const digits = String(val).replace(/\D/g, "");
          return digits.length === 10;
        }, "Enter a valid 10-digit mobile number"),
      email: z
        .string()
        .trim()
        .min(1, "Email is required")
        .regex(EMAIL_REGEX, "Enter a valid email address"),
      website: z
        .string()
        .default("")
        .refine((val) => {
          const t = String(val || "").trim();
          if (!t) return true;
          try {
            const u = new URL(t);
            return u.protocol === "http:" || u.protocol === "https:";
          } catch {
            return false;
          }
        }, "Enter a valid website URL (include https://)"),
      socialHandles: socialHandlesShape,
      socialCredentialsNotes: optionalStr,
      clientBrief: clientBriefShape,
      industry: z.string().optional().default(""),
      packageId: z.string().min(1, "Package selection is required"),
      startDate: z.string().min(1, "Start date is required"),
      teamAssignment: teamAssignmentShape,
    })
    .strict()
    .superRefine((data, ctx) => {
      const pkg = (packagesList || []).find((p) => String(p._id) === String(data.packageId));
      if (!pkg) return;

      const ce = getContentEnabledFromPackage(pkg);
      const reelCap = Number(pkg.noOfReels) || 0;
      const postCap = (Number(pkg.noOfPosts) || 0) + (Number(pkg.noOfStaticPosts) || 0);
      const carCap = Number(pkg.noOfCarousels) || 0;
      const reelsCount = ce.reels ? reelCap : 0;
      const postsCount = ce.posts ? postCap : 0;
      const carouselsCount = ce.carousel ? carCap : 0;

      if (reelCap + postCap + carCap > 0 && reelsCount + postsCount + carouselsCount === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "This package must include at least one of reels, static posts, or carousels",
          path: ["packageId"],
        });
      }

      const flags = packageTeamFlags(pkg);
      const needs = deriveTeamRoleNeeds(flags);
      const ta = data.teamAssignment || {};

      TEAM_SELECT_CONFIG.forEach(({ field, needsKey }) => {
        if (!needs[needsKey]) return;
        if (!filled(ta[field])) {
          const roleName = TEAM_FIELD_LABELS[field] || field;
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Please assign a ${roleName}`,
            path: ["teamAssignment", field],
          });
        }
      });
    });
}

const defaultClientBrief = {
  usp: "",
  brandTone: "",
  brandToneOther: "",
  targetAudience: [],
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
  preferredShootDaysTiming: [],
  bestPostingTime: { from: "", to: "" },
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
    pinterest: "",
    other: "",
  },
  socialCredentialsNotes: "",
  clientBrief: { ...defaultClientBrief },
  industry: "",
  packageId: "",
  startDate: "",
  teamAssignment: {
    strategist: "",
    videographer: "",
    editor: "",
    graphicDesigner: "",
    manager: "",
    postingExecutive: "",
  },
};

const emptyTeamAssignment = { ...defaultValues.teamAssignment };

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

const MAX_BRIEF_FILE_BYTES = 50 * 1024 * 1024;

const emptyBriefFiles = { brandKit: [], socialCredentials: [], other: [], agreement: [] };

function BriefFilePicker({ label, hint, files, onFilesAdded, accept, validateFile }) {
  const [localError, setLocalError] = useState("");
  return (
    <div className="space-y-1">
      <Label className="text-sm font-medium">{label}</Label>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <Input
        type="file"
        multiple
        accept={accept}
        className="cursor-pointer text-sm file:mr-2"
        onChange={(e) => {
          setLocalError("");
          const list = e.target.files;
          if (!list?.length) return;
          const picked = Array.from(list);
          const ok = [];
          for (const f of picked) {
            if (f.size > MAX_BRIEF_FILE_BYTES) {
              setLocalError(`Each file must be 50MB or less (${f.name})`);
              e.target.value = "";
              return;
            }
            if (typeof validateFile === "function") {
              const err = validateFile(f);
              if (err) {
                setLocalError(err);
                e.target.value = "";
                return;
              }
            }
            ok.push(f);
          }
          if (ok.length) onFilesAdded(ok);
          e.target.value = "";
        }}
      />
      {localError ? <p className="text-xs text-destructive">{localError}</p> : null}
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
  const [currentUserId, setCurrentUserId] = useState(null);
  const [createPackageOpen, setCreatePackageOpen] = useState(false);
  const [createPackageSubmitting, setCreatePackageSubmitting] = useState(false);
  const [createPackageError, setCreatePackageError] = useState("");
  const [newPkgForm, setNewPkgForm] = useState({
    name: "",
    noOfReels: 0,
    noOfStaticPosts: 0,
    noOfCarousels: 0,
    noOfGoogleReviews: 0,
    gmbPosting: false,
    campaignManagement: false,
  });
  const packagesRef = useRef(packages);
  packagesRef.current = packages;

  const {
    control,
    handleSubmit,
    watch,
    trigger,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: (...args) => zodResolver(buildClientSchema(packagesRef.current))(...args),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onBlur",
  });

  const selectedPackageId = watch("packageId");
  const startDateWatch = watch("startDate");
  /** useWatch (not watch) so nested Controller fields like `teamAssignment.strategist` update this object reliably. */
  const teamAssignmentWatch = useWatch({
    control,
    name: "teamAssignment",
    defaultValue: emptyTeamAssignment,
  });
  const selectedPackage = useMemo(
    () => (packages || []).find((p) => String(p._id) === String(selectedPackageId)),
    [packages, selectedPackageId]
  );

  const contentEnabledDerived = useMemo(
    () => getContentEnabledFromPackage(selectedPackage),
    [selectedPackage]
  );

  const teamFlags = useMemo(() => packageTeamFlags(selectedPackage), [selectedPackage]);
  const roleNeeds = useMemo(() => deriveTeamRoleNeeds(teamFlags), [teamFlags]);

  const teamAssignmentComplete = useMemo(() => {
    return TEAM_SELECT_CONFIG.every(({ field, needsKey }) => {
      if (!roleNeeds[needsKey]) return true;
      return filled(teamAssignmentWatch?.[field]);
    });
  }, [teamAssignmentWatch, roleNeeds]);

  const teamAssignmentFieldSignature = useMemo(
    () =>
      TEAM_SELECT_CONFIG.map(({ field, needsKey }) =>
        roleNeeds[needsKey] ? (teamAssignmentWatch?.[field] ?? "") : ""
      ).join("|"),
    [teamAssignmentWatch, roleNeeds]
  );

  const assigningTypeLabels = [];
  if (teamFlags.hasReels) assigningTypeLabels.push("Reels");
  if (teamFlags.hasStatic) assigningTypeLabels.push("Static");
  if (teamFlags.hasCarousels) assigningTypeLabels.push("Carousel");

  const missingRoleLabelsForPreview = [];
  TEAM_SELECT_CONFIG.forEach(({ field, needsKey }) => {
    if (!roleNeeds[needsKey]) return;
    if (!filled(teamAssignmentWatch?.[field])) {
      missingRoleLabelsForPreview.push(TEAM_FIELD_LABELS[field] || field);
    }
  });

  useEffect(() => {
    if (!selectedPackageId) return;
    setValue("teamAssignment", { ...emptyTeamAssignment }, { shouldValidate: false });
  }, [selectedPackageId, setValue]);

  useEffect(() => {
    if (step !== 2) return;
    if (!selectedPackageId) return;
    if (!startDateWatch) return;

    const pkg = packagesRef.current.find((p) => String(p._id) === String(selectedPackageId));
    if (!pkg) return;

    const ce = getContentEnabledFromPackage(pkg);
    if (!ce.reels && !ce.posts && !ce.carousel) return;

    if (!teamAssignmentComplete) return;

    let mounted = true;
    setCalendarDraftLoading(true);
    setCalendarDraftError("");

    const t = setTimeout(async () => {
      try {
        const pkgNow = packagesRef.current.find((p) => String(p._id) === String(selectedPackageId));
        if (!pkgNow) throw new Error("Package not found");
        const ta = getValues("teamAssignment");
        const flags = packageTeamFlags(pkgNow);
        const teamPayload = legacyTeamFromAssignment(ta, flags.hasReels, flags.hasStatic, flags.hasCarousels);

        const res = await api.generateCalendarDraft({
          packageId: selectedPackageId,
          startDate: startDateWatch,
          team: teamPayload,
          contentEnabled: getContentEnabledFromPackage(pkgNow),
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
    teamAssignmentComplete,
    teamAssignmentFieldSignature,
    getValues,
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

  const openCreatePackageModal = () => {
    setCreatePackageError("");
    setNewPkgForm({
      name: "",
      noOfReels: 0,
      noOfStaticPosts: 0,
      noOfCarousels: 0,
      noOfGoogleReviews: 0,
      gmbPosting: false,
      campaignManagement: false,
    });
    setCreatePackageOpen(true);
  };

  const submitCreatePackage = async (e) => {
    e.preventDefault();
    setCreatePackageError("");
    setCreatePackageSubmitting(true);
    try {
      const res = await api.createManagerPackage({
        name: newPkgForm.name.trim(),
        noOfReels: Number(newPkgForm.noOfReels),
        noOfStaticPosts: Number(newPkgForm.noOfStaticPosts),
        noOfCarousels: Number(newPkgForm.noOfCarousels),
        noOfGoogleReviews: Number(newPkgForm.noOfGoogleReviews) || 0,
        gmbPosting: Boolean(newPkgForm.gmbPosting),
        campaignManagement: Boolean(newPkgForm.campaignManagement),
      });
      const created = res?.data;
      if (!created?._id) throw new Error("Invalid response from server");
      setPackages((prev) => [created, ...(prev || [])]);
      setValue("packageId", created._id, { shouldValidate: true });
      setCreatePackageOpen(false);
      toast.success("Package created");
    } catch (err) {
      setCreatePackageError(err?.message || "Failed to create package");
    } finally {
      setCreatePackageSubmitting(false);
    }
  };

  useEffect(() => {
    loadPackages();
    loadUsers();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.getMe();
        const id = res?.user?._id;
        if (mounted && id) setCurrentUserId(String(id));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      mounted = false;
    };
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
      const ok = await trigger([
        "clientName",
        "brandName",
        "contactNumber",
        "email",
        "website",
        "clientBrief",
      ]);
      if (!ok) {
        setTimeout(() => {
          const wrap = document.querySelector("[data-client-step='1']");
          const err =
            wrap?.querySelector(".text-destructive") || document.querySelector("form .text-destructive");
          err?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
        return;
      }
    }

    if (step === 1) {
      const ok = await trigger(["packageId", "startDate"]);
      if (!ok) return;
    }

    setStep((prev) => Math.min(prev + 1, 2));
  };

  const back = () => setStep((prev) => Math.max(prev - 1, 0));

  const scrollToFirstTeamError = (formErrors) => {
    const order = ["strategist", "videographer", "editor", "graphicDesigner", "manager", "postingExecutive"];
    for (const key of order) {
      if (formErrors.teamAssignment?.[key]) {
        document
          .querySelector(`[data-rhf-field="teamAssignment.${key}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    document.querySelector("form .text-destructive")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const onSubmit = async (values) => {
    if (step !== 2) return;

    try {
      const brief = values.clientBrief || {};
      const bt = brief.bestPostingTime || {};
      const bestPostingTimeStr =
        bt.from && bt.to ? `${String(bt.from).trim()}-${String(bt.to).trim()}` : "";
      const targetAudienceStr = Array.isArray(brief.targetAudience)
        ? brief.targetAudience.filter(Boolean).join(", ")
        : String(brief.targetAudience || "");
      const preferredShootStr = Array.isArray(brief.preferredShootDaysTiming)
        ? brief.preferredShootDaysTiming.filter(Boolean).join(", ")
        : String(brief.preferredShootDaysTiming || "");

      const payload = {
        clientName: values.clientName.trim(),
        brandName: values.brandName.trim(),
        contactNumber: String(values.contactNumber || "").replace(/\D/g, ""),
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
          pinterest: (values.socialHandles?.pinterest || "").trim(),
          other: (values.socialHandles?.other || "").trim(),
        },
        clientBrief: {
          ...defaultClientBrief,
          ...brief,
          targetAudience: targetAudienceStr,
          preferredShootDaysTiming: preferredShootStr,
          bestPostingTime: bestPostingTimeStr,
          contentPreference: Array.isArray(brief.contentPreference) ? brief.contentPreference : [],
          shootAvailability: {
            ...defaultClientBrief.shootAvailability,
            ...(brief.shootAvailability || {}),
          },
        },
        startDate: toIsoUtcMidnight(values.startDate),
        status: "active",
        package: values.packageId,
        contentEnabled: (() => {
          const pkgSubmit = (packages || []).find((p) => String(p._id) === String(values.packageId));
          const ce = getContentEnabledFromPackage(pkgSubmit);
          return {
            reels: ce.reels,
            posts: ce.posts,
            carousel: ce.carousel,
          };
        })(),
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
        team: (() => {
          const pkgSubmit = (packages || []).find((p) => String(p._id) === String(values.packageId));
          const f = packageTeamFlags(pkgSubmit);
          return legacyTeamFromAssignment(values.teamAssignment, f.hasReels, f.hasStatic, f.hasCarousels);
        })(),
        teamAssignment: (() => {
          const pkgSubmit = (packages || []).find((p) => String(p._id) === String(values.packageId));
          const needs = deriveTeamRoleNeeds(packageTeamFlags(pkgSubmit));
          return buildTeamAssignmentPayload(values.teamAssignment, needs);
        })(),
      };

      const res = await api.createClient(payload);
      const clientId = res?.data?._id;
      const fileCount =
        briefFiles.brandKit.length +
        briefFiles.socialCredentials.length +
        briefFiles.other.length +
        briefFiles.agreement.length;
      if (clientId && fileCount > 0) {
        try {
          const formData = new FormData();
          briefFiles.brandKit.forEach((f) => formData.append("brandKit", f));
          briefFiles.socialCredentials.forEach((f) => formData.append("socialCredentials", f));
          briefFiles.other.forEach((f) => formData.append("other", f));
          briefFiles.agreement.forEach((f) => formData.append("agreement", f));
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

      <form className="space-y-5" onSubmit={handleSubmit(onSubmit, scrollToFirstTeamError)}>
        {step === 0 ? (
          <div className="space-y-5" data-client-step="1">
            <Card>
              <CardHeader>
                <CardTitle>Client info</CardTitle>
                <CardDescription>
                  Capture brand, contact, positioning, and production preferences. Upload brand kit, credentials, and
                  other files directly — they are stored securely for your team.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Name" required error={errors.clientName?.message}>
                  <Controller
                    name="clientName"
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        onChange={(e) => field.onChange(e.target.value)}
                        autoComplete="organization"
                        placeholder="Legal name or account name as on contract"
                      />
                    )}
                  />
                </Field>
                <Field label="Brand name" required error={errors.brandName?.message}>
                  <Controller
                    name="brandName"
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        onChange={(e) => field.onChange(e.target.value)}
                        autoComplete="organization"
                        placeholder="Public brand name (as shown on socials)"
                      />
                    )}
                  />
                </Field>
                <Field label="Contact number" required error={errors.contactNumber?.message}>
                  <Controller
                    name="contactNumber"
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        inputMode="numeric"
                        placeholder="9876543210"
                        onChange={(e) => field.onChange(e.target.value)}
                      />
                    )}
                  />
                </Field>
                <Field label="Email" required error={errors.email?.message}>
                  <Controller
                    name="email"
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        type="email"
                        onChange={(e) => field.onChange(e.target.value)}
                        autoComplete="email"
                        placeholder="name@company.com"
                      />
                    )}
                  />
                </Field>
                <Field label="Website" error={errors.website?.message}>
                  <Controller
                    name="website"
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        onChange={(e) => field.onChange(e.target.value)}
                        placeholder="https://www.example.com"
                      />
                    )}
                  />
                </Field>
                <Field label="Industry" error={errors.industry?.message}>
                  <Controller
                    name="industry"
                    control={control}
                    render={({ field }) => (
                      <Input
                        {...field}
                        onChange={(e) => field.onChange(e.target.value)}
                        placeholder="e.g. Retail, SaaS, Healthcare, F&B"
                      />
                    )}
                  />
                </Field>

                <div className="md:col-span-2">
                  <Label className="mb-2 block">All social media credentials (free text)</Label>
                  <Controller
                    name="socialCredentialsNotes"
                    control={control}
                    render={({ field }) => (
                      <TextArea
                        {...field}
                        placeholder="Paste handles, agency logins, or where credentials are stored (Vault, 1Password, shared drive). Never paste raw passwords in email — note the secure channel here."
                      />
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
                      ["socialHandles.pinterest", "Pinterest"],
                      ["socialHandles.other", "Other"],
                    ].map(([name, label]) => (
                      <Field key={name} label={label}>
                        <Controller
                          name={name}
                          control={control}
                          render={({ field }) => (
                            <Input
                              {...field}
                              onChange={(e) => field.onChange(e.target.value)}
                              placeholder={SOCIAL_HANDLE_PLACEHOLDERS[name] || ""}
                            />
                          )}
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
                    render={({ field }) => (
                      <TextArea
                        {...field}
                        placeholder="What makes this brand stand out? One or two short paragraphs."
                      />
                    )}
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
                      render={({ field }) => (
                        <Input
                          {...field}
                          onChange={(e) => field.onChange(e.target.value)}
                          placeholder="Describe the tone (e.g. playful, corporate, regional…)"
                        />
                      )}
                    />
                  </Field>
                ) : null}

                <div className="md:col-span-2">
                  <Label className="mb-2 block">Who is your target audience?</Label>
                  <p className="mb-2 text-xs text-muted-foreground">Select all age ranges that apply.</p>
                  <Controller
                    name="clientBrief.targetAudience"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-3">
                        {TARGET_AUDIENCE_OPTIONS.map((opt) => {
                          const set = new Set(field.value || []);
                          const checked = set.has(opt);
                          return (
                            <label key={opt} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(next) => {
                                  const s = new Set(field.value || []);
                                  if (next === true) s.add(opt);
                                  else s.delete(opt);
                                  field.onChange(Array.from(s));
                                }}
                              />
                              {opt}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-1">Key products / services</Label>
                  <Controller
                    name="clientBrief.keyProductsServices"
                    control={control}
                    render={({ field }) => (
                      <TextArea
                        {...field}
                        placeholder="List main SKUs, services, or collections we should feature."
                      />
                    )}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-1">Priority focus — what do you want to push?</Label>
                  <Controller
                    name="clientBrief.priorityFocus"
                    control={control}
                    render={({ field }) => (
                      <TextArea
                        {...field}
                        placeholder="e.g. New launch, clearance sale, app installs, store visits…"
                      />
                    )}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-1">Festivals to target aggressively</Label>
                  <Controller
                    name="clientBrief.festivalsToTarget"
                    control={control}
                    render={({ field }) => (
                      <TextArea
                        {...field}
                        placeholder="Diwali, Eid, Christmas, regional events — names and rough dates if known."
                      />
                    )}
                  />
                </div>

                <Field label="Language">
                  <Controller
                    name="clientBrief.language"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value || undefined} onValueChange={(v) => field.onChange(v)}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Primary content language" />
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
                      render={({ field }) => (
                        <Input
                          {...field}
                          onChange={(e) => field.onChange(e.target.value)}
                          placeholder="e.g. Tamil, Marathi, Hinglish…"
                        />
                      )}
                    />
                  </Field>
                ) : null}

                <div className="md:col-span-2">
                  <Label className="mb-1">Competitors</Label>
                  <Controller
                    name="clientBrief.competitors"
                    control={control}
                    render={({ field }) => (
                      <TextArea {...field} placeholder="Brands or accounts you compete with (names + links if helpful)." />
                    )}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-1">Accounts you like — and why</Label>
                  <Controller
                    name="clientBrief.accountsYouLikeReason"
                    control={control}
                    render={({ field }) => (
                      <TextArea
                        {...field}
                        placeholder="Reference accounts, reels, or styles the client wants to emulate — and why."
                      />
                    )}
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

                <Field label="Age group" error={errors.clientBrief?.ageGroup?.message}>
                  <Controller
                    name="clientBrief.ageGroup"
                    control={control}
                    render={({ field }) => (
                      <Select
                        value={field.value ? field.value : "__none__"}
                        onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select age group (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— None —</SelectItem>
                          {AGE_GROUP_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>

                <div className="md:col-span-2">
                  <Label className="mb-1">Locations we must focus on</Label>
                  <Controller
                    name="clientBrief.focusLocations"
                    control={control}
                    render={({ field }) => (
                      <TextArea
                        {...field}
                        placeholder="Cities, regions, or stores (e.g. Mumbai + Pune, or pan-India)."
                      />
                    )}
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

                <div className="md:col-span-2">
                  <Label className="mb-2 block">Preferred shoot days</Label>
                  <p className="mb-2 text-xs text-muted-foreground">Select weekdays that work for shoots (optional).</p>
                  <Controller
                    name="clientBrief.preferredShootDaysTiming"
                    control={control}
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-3">
                        {WEEKDAY_OPTIONS.map((day) => {
                          const set = new Set(field.value || []);
                          const checked = set.has(day);
                          return (
                            <label key={day} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(next) => {
                                  const s = new Set(field.value || []);
                                  if (next === true) s.add(day);
                                  else s.delete(day);
                                  field.onChange(Array.from(s));
                                }}
                              />
                              {day}
                            </label>
                          );
                        })}
                      </div>
                    )}
                  />
                </div>

                <div className="md:col-span-2">
                  <Label className="mb-2 block">Best posting time</Label>
                  <p className="mb-2 text-xs text-muted-foreground">Optional — choose a typical window for posting.</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="From" error={errors.clientBrief?.bestPostingTime?.from?.message}>
                      <Controller
                        name="clientBrief.bestPostingTime.from"
                        control={control}
                        render={({ field }) => (
                          <Select value={field.value || undefined} onValueChange={(v) => field.onChange(v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Start time" />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              {HALF_HOUR_TIME_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                    <Field label="To" error={errors.clientBrief?.bestPostingTime?.to?.message}>
                      <Controller
                        name="clientBrief.bestPostingTime.to"
                        control={control}
                        render={({ field }) => (
                          <Select value={field.value || undefined} onValueChange={(v) => field.onChange(v)}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="End time" />
                            </SelectTrigger>
                            <SelectContent className="max-h-60">
                              {HALF_HOUR_TIME_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>
                  </div>
                </div>

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
                    <div className="sm:col-span-2">
                      <BriefFilePicker
                        label="Agreement"
                        hint="Signed agreement or contract document (PDF, DOCX)"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        files={briefFiles.agreement}
                        onFilesAdded={(added) =>
                          setBriefFiles((prev) => ({ ...prev, agreement: [...prev.agreement, ...added] }))
                        }
                        validateFile={(f) => {
                          const name = (f.name || "").toLowerCase();
                          if (!/\.(pdf|doc|docx)$/.test(name)) {
                            return "Only PDF or Word documents (.pdf, .doc, .docx) are allowed";
                          }
                          return null;
                        }}
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
                      <Input
                        type="date"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        title="First month of the engagement (calendar uses the next working day from here)"
                      />
                    )}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">Pick the contract or campaign start — scheduling begins from the next working day.</p>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <PackageIcon className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-lg font-semibold">Package</h3>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-1" onClick={openCreatePackageModal}>
                  <Plus className="h-3.5 w-3.5" />
                  Create package
                </Button>
              </div>

              <Dialog open={createPackageOpen} onOpenChange={setCreatePackageOpen}>
                <DialogContent className="sm:max-w-md" showCloseButton>
                  <form onSubmit={submitCreatePackage}>
                    <DialogHeader>
                      <DialogTitle>Create package</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3 py-2">
                      {createPackageError ? (
                        <p className="text-sm text-destructive">{createPackageError}</p>
                      ) : null}
                      <Field label="Package name *" required>
                        <Input
                          value={newPkgForm.name}
                          onChange={(e) => setNewPkgForm((p) => ({ ...p, name: e.target.value }))}
                          placeholder="e.g. Growth"
                          autoComplete="off"
                        />
                      </Field>
                      <Field label="Reels per month *" required>
                        <Input
                          type="number"
                          min={0}
                          value={newPkgForm.noOfReels}
                          onChange={(e) =>
                            setNewPkgForm((p) => ({ ...p, noOfReels: e.target.valueAsNumber || Number(e.target.value) || 0 }))
                          }
                        />
                      </Field>
                      <Field label="Static posts per month *" required>
                        <Input
                          type="number"
                          min={0}
                          value={newPkgForm.noOfStaticPosts}
                          onChange={(e) =>
                            setNewPkgForm((p) => ({
                              ...p,
                              noOfStaticPosts: e.target.valueAsNumber || Number(e.target.value) || 0,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Carousels per month *" required>
                        <Input
                          type="number"
                          min={0}
                          value={newPkgForm.noOfCarousels}
                          onChange={(e) =>
                            setNewPkgForm((p) => ({
                              ...p,
                              noOfCarousels: e.target.valueAsNumber || Number(e.target.value) || 0,
                            }))
                          }
                        />
                      </Field>
                      <Field label="Google Reviews per month">
                        <Input
                          type="number"
                          min={0}
                          value={newPkgForm.noOfGoogleReviews}
                          onChange={(e) =>
                            setNewPkgForm((p) => ({
                              ...p,
                              noOfGoogleReviews: e.target.valueAsNumber || Number(e.target.value) || 0,
                            }))
                          }
                        />
                      </Field>
                      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                        <span className="text-sm">GMB Posting</span>
                        <Checkbox
                          checked={newPkgForm.gmbPosting}
                          onCheckedChange={(v) => setNewPkgForm((p) => ({ ...p, gmbPosting: v === true }))}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                        <span className="text-sm">Campaign Management</span>
                        <Checkbox
                          checked={newPkgForm.campaignManagement}
                          onCheckedChange={(v) => setNewPkgForm((p) => ({ ...p, campaignManagement: v === true }))}
                        />
                      </div>
                    </div>
                    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
                      <Button type="button" variant="outline" onClick={() => setCreatePackageOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={createPackageSubmitting}>
                        {createPackageSubmitting ? "Creating…" : "Create & select"}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>

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
                    const createdById =
                      pkg.createdBy && typeof pkg.createdBy === "object" && pkg.createdBy._id != null
                        ? String(pkg.createdBy._id)
                        : pkg.createdBy != null
                          ? String(pkg.createdBy)
                          : "";
                    const showMine =
                      Boolean(currentUserId && createdById && createdById === currentUserId && pkg.createdByRole === "manager");
                    const showGlobal = pkg.createdByRole === "admin" || !createdById;
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
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <CardTitle className="text-base">{pkg.name}</CardTitle>
                                  {showMine ? (
                                    <Badge className="shrink-0 border-purple-500/30 bg-purple-500/15 text-purple-800 dark:text-purple-200">
                                      Mine
                                    </Badge>
                                  ) : showGlobal ? (
                                    <Badge variant="secondary" className="shrink-0 text-muted-foreground">
                                      Global
                                    </Badge>
                                  ) : null}
                                </div>
                              </div>
                              {selected ? <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" /> : null}
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

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Content to schedule</CardTitle>
                  {selectedPackage ? (
                    <p className="text-xs font-normal text-muted-foreground">
                      Types below are included in the selected package. Team assignment on the next step follows these types.
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {!selectedPackage ? (
                    <p className="text-sm text-muted-foreground">Select a package above to see included content types.</p>
                  ) : (
                    <div className="space-y-2">
                      {(Number(selectedPackage.noOfReels) || 0) > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                          <span className="font-medium">Reels</span>
                          <Badge variant="secondary">{Number(selectedPackage.noOfReels) || 0} in package</Badge>
                        </div>
                      ) : null}
                      {(Number(selectedPackage.noOfPosts) || 0) + (Number(selectedPackage.noOfStaticPosts) || 0) > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                          <span className="font-medium">Static</span>
                          <Badge variant="secondary">
                            {(Number(selectedPackage.noOfPosts) || 0) + (Number(selectedPackage.noOfStaticPosts) || 0)} in package
                          </Badge>
                        </div>
                      ) : null}
                      {(Number(selectedPackage.noOfCarousels) || 0) > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                          <span className="font-medium">Carousels</span>
                          <Badge variant="secondary">{Number(selectedPackage.noOfCarousels) || 0} in package</Badge>
                        </div>
                      ) : null}
                      {(Number(selectedPackage.noOfGoogleReviews) || 0) > 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                          <span className="font-medium">Google Reviews</span>
                          <Badge variant="secondary">{Number(selectedPackage.noOfGoogleReviews) || 0} in package</Badge>
                        </div>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            {usersLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <Skeleton key={idx} className="h-20 w-full" />
                ))}
              </div>
            ) : (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Team assignment</CardTitle>
                  <p className="text-xs font-normal text-muted-foreground">
                    {assigningTypeLabels.length > 0
                      ? `Assigning team for: ${assigningTypeLabels.join(", ")}`
                      : "Select a package with reels, static, or carousel content."}
                  </p>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {TEAM_SELECT_CONFIG.map(({ field, label, needsKey, optionsKey }) => {
                    if (!roleNeeds[needsKey]) return null;
                    const opts = roleOptions[optionsKey] || [];
                    const err = errors.teamAssignment?.[field]?.message;
                    return (
                      <TeamSelect
                        key={field}
                        label={label}
                        name={`teamAssignment.${field}`}
                        control={control}
                        options={opts}
                        error={err}
                        placeholder={`Select ${label}`}
                        required
                      />
                    );
                  })}
                </CardContent>
              </Card>
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
                    : !teamAssignmentComplete
                      ? `Fill required team members to generate schedule preview.${
                          missingRoleLabelsForPreview.length
                            ? ` Missing: ${missingRoleLabelsForPreview.join(", ")}.`
                            : ""
                        }`
                      : assigningTypeLabels.length
                        ? "Fill required team members to generate schedule preview. If preview does not appear, change a selection or wait a moment."
                        : "Fill required team members to generate schedule preview."}
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

function Field({ label, children, error, required }) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

function TeamSelect({ label, name, control, options, error, placeholder, required }) {
  const ph = placeholder || `Select ${label}`;
  return (
    <div className="space-y-1.5" data-rhf-field={name}>
      <Label>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </Label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => {
          const v = field.value != null && field.value !== "" ? String(field.value) : undefined;
          const selected = (options || []).find((u) => String(u?._id) === v);
          return (
          <Select
            value={v}
            onValueChange={(value) => field.onChange(value != null ? String(value) : "")}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={ph}>
                {selected?.name || (v ? "Selected user" : "")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(options || []).map((u) => (
                <SelectItem key={String(u._id)} value={String(u._id)}>
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
