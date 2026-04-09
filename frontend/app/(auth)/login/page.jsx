"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import ThemeToggle from "@/components/theme-toggle";
import AppLogo from "@/components/shared/AppLogo";
const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  const router = useRouter();
  const setUser = useAuthStore((state) => state.setUser);
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (values) => {
    setServerError("");
    try {
      const data = await api.login(values);
      setUser(data.user);
      router.push(data.user.dashboardRoute || "/");
    } catch (error) {
      setServerError(error.message || "Login failed");
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>

      <section className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        <div className="relative hidden lg:flex">
          <div className="absolute inset-0 bg-gradient-to-br from-[#6C3EBF] to-[#E84393]" />
          <div className="relative z-10 flex w-full flex-col justify-between p-12 text-white">
            <div>
              <AppLogo width={150} height={38} className="h-10 w-auto"/>
            </div>
            <div className="max-w-md">
              <h1 className="text-4xl font-semibold leading-tight">
                Shape content workflows that move faster.
              </h1>
              <p className="mt-4 text-white/85">
                Plan, produce, review, and publish from one workspace built for modern teams.
              </p>
            </div>
            <p className="text-sm text-white/80">
              Creative operations, simplified with role-based collaboration.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center p-4 sm:p-8">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card shadow-xl animate-in fade-in slide-in-from-bottom-6 duration-500">
            <div className="h-1.5 w-full bg-gradient-to-r from-[#6C3EBF] to-[#E84393] lg:hidden" />

            <div className="space-y-6 p-6 sm:p-8">
              <div className="flex justify-center lg:hidden">
                <AppLogo width={170} height={44} className="h-11 w-auto" />
              </div>
              <div className="space-y-2 text-center sm:text-left">
                <h2 className="text-2xl font-semibold">Welcome back</h2>
                <p className="text-sm text-muted-foreground">
                  Sign in to continue to your Rangreel dashboard.
                </p>
              </div>

              <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    className="w-full rounded-xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                    placeholder="you@rangreel.com"
                    {...register("email")}
                  />
                  {errors.email ? (
                    <p className="text-xs text-destructive">{errors.email.message}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label htmlFor="password" className="text-sm font-medium">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      className="w-full rounded-xl border border-border bg-background px-4 py-2.5 pr-12 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                      placeholder="Enter your password"
                      {...register("password")}
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted-foreground transition hover:text-foreground"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password ? (
                    <p className="text-xs text-destructive">{errors.password.message}</p>
                  ) : null}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {isSubmitting ? "Signing in..." : "Sign in"}
                </button>
              </form>

              {serverError ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {serverError}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
