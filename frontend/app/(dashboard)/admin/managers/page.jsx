"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  Copy,
  Eye,
  EyeOff,
  MoreVertical,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { TableSkeleton } from "@/components/shared/AdminSkeletons";

const passwordChecks = (password) => ({
  len: password.length >= 8,
  upper: /[A-Z]/.test(password),
  number: /\d/.test(password),
  special: /[!@#$%^&*]/.test(password),
});

function initials(name) {
  return (name || "RM")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function AdminManagersPage() {
  const [loading, setLoading] = useState(true);
  const [managers, setManagers] = useState([]);
  const [search, setSearch] = useState("");
  const [openForm, setOpenForm] = useState(false);
  const [openEditForm, setOpenEditForm] = useState(false);
  const [openResetForm, setOpenResetForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [editingManagerId, setEditingManagerId] = useState("");
  const [resetManagerId, setResetManagerId] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [editForm, setEditForm] = useState({ name: "", email: "", phone: "" });

  const loadManagers = async () => {
    try {
      setLoading(true);
      const response = await api.getManagers();
      setManagers(response?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load managers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadManagers();
  }, []);

  const filtered = useMemo(
    () =>
      managers.filter((manager) =>
        [manager.name, manager.email, manager.phone]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [managers, search]
  );

  const strength = useMemo(() => {
    const checks = passwordChecks(form.password);
    return Object.values(checks).filter(Boolean).length;
  }, [form.password]);

  const submitCreate = async (event) => {
    event.preventDefault();
    try {
      await api.createManager(form);
      setOpenForm(false);
      toast.success("Manager created", {
        description: "Save this initial password securely.",
        action: {
          label: "Copy",
          onClick: async () => navigator.clipboard.writeText(form.password),
        },
      });
      setForm({ name: "", email: "", phone: "", password: "" });
      await loadManagers();
    } catch (error) {
      toast.error(error.message || "Failed to create manager");
    }
  };

  const openEditManager = (manager) => {
    setEditingManagerId(manager._id);
    setEditForm({
      name: manager.name || "",
      email: manager.email || "",
      phone: manager.phone || "",
    });
    setOpenEditForm(true);
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    try {
      await api.updateManager(editingManagerId, editForm);
      toast.success("Manager updated");
      setOpenEditForm(false);
      setEditingManagerId("");
      await loadManagers();
    } catch (error) {
      toast.error(error.message || "Update failed");
    }
  };

  const openResetManager = (manager) => {
    setResetManagerId(manager._id);
    setResetPassword("Manager@123!");
    setShowResetPassword(false);
    setOpenResetForm(true);
  };

  const submitResetPassword = async (event) => {
    event.preventDefault();
    try {
      await api.resetManagerPassword(resetManagerId, { newPassword: resetPassword });
      toast.success("Manager password reset");
      setOpenResetForm(false);
      setResetManagerId("");
      setResetPassword("");
    } catch (error) {
      toast.error(error.message || "Reset failed");
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Managers</h2>
          <p className="text-sm text-muted-foreground">Manage account managers and access status.</p>
        </div>
        <Button onClick={() => setOpenForm(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add Manager
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search managers..."
          className="pl-9"
        />
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Manager</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="border-t">
                <td className="px-4 py-3" colSpan={5}>
                  <TableSkeleton rows={6} cols={5} />
                </td>
              </tr>
            ) : filtered.length ? (
              filtered.map((manager) => (
                  <tr key={manager._id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                          {initials(manager.name)}
                        </div>
                        <div>
                          <p className="font-medium">{manager.name}</p>
                          <p className="text-muted-foreground">{manager.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{manager.phone || "-"}</td>
                    <td className="px-4 py-3">
                      <Badge variant={manager.isActive ? "default" : "outline"}>
                        {manager.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(manager.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ActionMenu
                        onEdit={() => openEditManager(manager)}
                        onReset={() => openResetManager(manager)}
                        onToggleActive={async () => {
                          setPendingStatusChange(manager);
                        }}
                        isActive={manager.isActive}
                      />
                    </td>
                  </tr>
                ))
            ) : (
              <tr className="border-t">
                <td className="px-4 py-6" colSpan={5}>
                  <EmptyState
                    icon={FolderOpen}
                    title="No managers found"
                    description="Add a manager to start assigning responsibilities."
                    ctaLabel="Add Manager"
                    onCta={() => setOpenForm(true)}
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)
          : filtered.length
          ? filtered.map((manager) => (
              <div key={manager._id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {initials(manager.name)}
                    </div>
                    <div>
                      <p className="font-medium">{manager.name}</p>
                      <p className="text-xs text-muted-foreground">{manager.email}</p>
                    </div>
                  </div>
                  <ActionMenu
                    onEdit={() => openEditManager(manager)}
                    onReset={() => openResetManager(manager)}
                    onToggleActive={async () => {
                      setPendingStatusChange(manager);
                    }}
                    isActive={manager.isActive}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <Badge variant={manager.isActive ? "default" : "outline"}>
                    {manager.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <span className="text-muted-foreground">
                    {new Date(manager.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))
          : (
            <EmptyState
              icon={FolderOpen}
              title="No managers found"
              description="Add a manager to start assigning responsibilities."
              ctaLabel="Add Manager"
              onCta={() => setOpenForm(true)}
            />
            )}
      </div>

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Manager</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submitCreate}>
            <Field label="Name">
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </Field>
            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
              />
            </Field>
            <Field label="Initial Password">
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1">
                {[1, 2, 3, 4].map((step) => (
                  <span
                    key={step}
                    className={`h-1.5 rounded-full ${
                      step <= strength
                        ? ["bg-red-500", "bg-orange-500", "bg-yellow-400", "bg-green-500"][strength - 1]
                        : "bg-muted"
                    }`}
                  />
                ))}
              </div>
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setOpenForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Create Manager</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openEditForm}
        onOpenChange={(open) => {
          setOpenEditForm(open);
          if (!open) setEditingManagerId("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Manager</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submitEdit}>
            <Field label="Name">
              <Input
                value={editForm.name}
                onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))}
                required
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={editForm.email}
                onChange={(event) => setEditForm((prev) => ({ ...prev, email: event.target.value }))}
                required
              />
            </Field>
            <Field label="Phone">
              <Input
                value={editForm.phone}
                onChange={(event) => setEditForm((prev) => ({ ...prev, phone: event.target.value }))}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpenEditForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Save Changes</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openResetForm}
        onOpenChange={(open) => {
          setOpenResetForm(open);
          if (!open) {
            setResetManagerId("");
            setResetPassword("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Manager Password</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submitResetPassword}>
            <Field label="New Password">
              <div className="relative">
                <Input
                  type={showResetPassword ? "text" : "password"}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowResetPassword((prev) => !prev)}
                >
                  {showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpenResetForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Reset Password</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingStatusChange)}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
        title={pendingStatusChange?.isActive ? "Deactivate manager?" : "Activate manager?"}
        description={`${
          pendingStatusChange?.name || "This manager"
        } ${
          pendingStatusChange?.isActive
            ? "will lose active access until re-enabled."
            : "will regain active access."
        }`}
        confirmLabel={pendingStatusChange?.isActive ? "Deactivate" : "Activate"}
        destructive={Boolean(pendingStatusChange?.isActive)}
        onConfirm={async () => {
          if (!pendingStatusChange) return;
          try {
            await api.updateManager(pendingStatusChange._id, {
              isActive: !pendingStatusChange.isActive,
            });
            toast.success(
              pendingStatusChange.isActive ? "Manager deactivated" : "Manager activated"
            );
            setPendingStatusChange(null);
            await loadManagers();
          } catch (error) {
            toast.error(error.message || "Update failed");
          }
        }}
      />
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function ActionMenu({ onEdit, onReset, onToggleActive, isActive }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem onClick={onReset}>Reset Password</DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleActive}>
          {isActive ? "Deactivate" : "Activate"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
