"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import ThemeToggle from "@/components/theme-toggle";
import AppLogo from "@/components/shared/AppLogo";

const passwordPolicy =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=[\]{};':"\\|,.<>/?]).{8,}$/;

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(1, "New password is required"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  })
  .refine((values) => passwordPolicy.test(values.newPassword), {
    path: ["newPassword"],
    message:
      "Password must include 8+ chars, uppercase, number, and special character",
  });

const ROLE_SLUG_DASHBOARD_ROUTE = {
  strategist: "/strategist",
  videographer: "/videographer",
  editor: "/editor",
  "video-editor": "/editor",
  videoeditor: "/editor",
  designer: "/designer",
  "graphic-designer": "/designer",
  graphicdesigner: "/designer",
  posting: "/posting",
  "posting-executive": "/posting",
  postingexecutive: "/posting",
  campaignmanager: "/campaign-manager",
  "campaign-manager": "/campaign-manager",
};

function resolveDashboardRoute(user) {
  if (user?.dashboardRoute) return user.dashboardRoute;
  if (user?.roleType === "admin") return "/admin";
  if (user?.roleType === "manager") return "/manager";
  const slug = String(user?.role?.slug || "").toLowerCase();
  if (slug && ROLE_SLUG_DASHBOARD_ROUTE[slug]) return ROLE_SLUG_DASHBOARD_ROUTE[slug];
  return "/";
}

function RequirementItem({ ok, label }) {
  return (
    <li className="flex items-center gap-2 text-xs sm:text-sm">
      <span
        className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${
          ok
            ? "bg-green-500/20 text-green-600 dark:text-green-400"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </span>
      <span className={ok ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

export default function ChangePasswordPage() {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const [serverError, setServerError] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  });

  const newPassword = watch("newPassword") || "";
  const confirmPassword = watch("confirmPassword") || "";

  const checks = useMemo(() => {
    const minLength = newPassword.length >= 8;
    const uppercase = /[A-Z]/.test(newPassword);
    const number = /\d/.test(newPassword);
    const special = /[!@#$%^&*]/.test(newPassword);
    const match = newPassword.length > 0 && newPassword === confirmPassword;

    return { minLength, uppercase, number, special, match };
  }, [newPassword, confirmPassword]);

  const strengthCount = [checks.minLength, checks.uppercase, checks.number, checks.special].filter(
    Boolean
  ).length;

  const strengthColor = [
    "bg-muted",
    "bg-red-500",
    "bg-orange-500",
    "bg-yellow-400",
    "bg-green-500",
  ][strengthCount];

  const onSubmit = async (values) => {
    setServerError("");
    try {
      const data = await api.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });

      setUser(data.user);
      const dashboardRoute = resolveDashboardRoute(data.user);
      router.replace(dashboardRoute);
    } catch (error) {
      setServerError(error.message || "Failed to update password");
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-4 py-8 sm:px-6">
        <div className="absolute right-4 top-4 z-10">
          <ThemeToggle />
        </div>

        <section className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
          <div className="mb-4 flex justify-center">
            <AppLogo width={180} height={46} className="h-11 w-auto" />
          </div>
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold sm:text-3xl">Set Your New Password</h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              Your account requires a password update before you can continue.
            </p>
          </div>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <label htmlFor="currentPassword" className="text-sm font-medium">
                Current Password
              </label>
              <div className="relative">
                <input
                  id="currentPassword"
                  type={showCurrent ? "text" : "password"}
                  autoComplete="current-password"
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 pr-12 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  {...register("currentPassword")}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent((prev) => !prev)}
                  className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
                  aria-label={showCurrent ? "Hide current password" : "Show current password"}
                >
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.currentPassword ? (
                <p className="text-xs text-destructive">{errors.currentPassword.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="newPassword" className="text-sm font-medium">
                New Password
              </label>
              <div className="relative">
                <input
                  id="newPassword"
                  type={showNew ? "text" : "password"}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 pr-12 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  {...register("newPassword")}
                />
                <button
                  type="button"
                  onClick={() => setShowNew((prev) => !prev)}
                  className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
                  aria-label={showNew ? "Hide new password" : "Show new password"}
                >
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((bar) => (
                  <span
                    key={bar}
                    className={`h-1.5 rounded-full ${
                      bar <= strengthCount ? strengthColor : "bg-muted"
                    }`}
                  />
                ))}
              </div>

              {errors.newPassword ? (
                <p className="text-xs text-destructive">{errors.newPassword.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label htmlFor="confirmPassword" className="text-sm font-medium">
                Confirm New Password
              </label>
              <div className="relative">
                <input
                  id="confirmPassword"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-border bg-background px-4 py-2.5 pr-12 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  {...register("confirmPassword")}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((prev) => !prev)}
                  className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
                  aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.confirmPassword ? (
                <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
              ) : null}
            </div>

            <ul className="space-y-1 rounded-xl border border-border bg-background/40 p-3">
              <RequirementItem ok={checks.minLength} label="Minimum 8 characters" />
              <RequirementItem ok={checks.uppercase} label="At least 1 uppercase letter" />
              <RequirementItem ok={checks.number} label="At least 1 number" />
              <RequirementItem ok={checks.special} label="At least 1 special character (!@#$%^&*)" />
              <RequirementItem ok={checks.match} label="Passwords match" />
            </ul>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? "Updating..." : "Update Password"}
            </button>
          </form>

          {serverError ? (
            <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
