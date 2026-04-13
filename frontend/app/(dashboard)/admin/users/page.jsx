"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderOpen, MoreVertical, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { TableSkeleton } from "@/components/shared/AdminSkeletons";

function initials(name) {
  return (name || "RU")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [openForm, setOpenForm] = useState(false);
  const [openEditForm, setOpenEditForm] = useState(false);
  const [openResetForm, setOpenResetForm] = useState(false);
  const [openCapacityForm, setOpenCapacityForm] = useState(false);
  const [editingUserId, setEditingUserId] = useState("");
  const [resetUserId, setResetUserId] = useState("");
  const [capacityUserId, setCapacityUserId] = useState("");
  const [capacityRoleSlug, setCapacityRoleSlug] = useState("");
  const [resetUserRoleType, setResetUserRoleType] = useState("user");
  const [resetPassword, setResetPassword] = useState("User@123!");
  const [capacityForm, setCapacityForm] = useState({
    reelCapacity: "0",
    postCapacity: "0",
    carouselCapacity: "0",
  });
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    roleId: "",
  });
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    roleId: "",
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [rolesRes, usersRes, managersRes] = await Promise.all([
        api.getRoles(),
        api.getUsers(),
        api.getManagers(),
      ]);
      const normalizedUsers = (usersRes?.data || []).map((user) => ({
        ...user,
        roleType: user.roleType || "user",
      }));
      const normalizedManagers = (managersRes?.data || []).map((manager) => ({
        ...manager,
        roleType: "manager",
      }));
      setRoles(rolesRes?.data || []);
      setUsers(
        [...normalizedManagers, ...normalizedUsers].sort(
          (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
        )
      );
    } catch (error) {
      toast.error(error.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const assignableRoles = useMemo(
    () => roles.filter((role) => role.slug !== "admin" && role.slug !== "customer"),
    [roles]
  );

  const visibleUsers = useMemo(
    () => users.filter((user) => user.role?.slug !== "customer"),
    [users]
  );

  const filtered = useMemo(
    () =>
      visibleUsers.filter((user) => {
        const passSearch = [user.name, user.email, user.phone]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
        const passRole = roleFilter === "all" ? true : user.role?.slug === roleFilter;
        return passSearch && passRole;
      }),
    [visibleUsers, search, roleFilter]
  );

  const createUser = async (event) => {
    event.preventDefault();
    try {
      const selectedRole = roles.find((role) => role._id === form.roleId);
      if (selectedRole?.slug === "manager") {
        await api.createManager({
          name: form.name,
          email: form.email,
          phone: form.phone,
          password: form.password,
        });
        toast.success("Manager created");
      } else {
        await api.createUser(form);
        toast.success("User created");
      }
      setOpenForm(false);
      setForm({ name: "", email: "", phone: "", password: "", roleId: "" });
      await loadData();
    } catch (error) {
      toast.error(error.message || "Failed to create user");
    }
  };

  const openEditUser = (user) => {
    setEditingUserId(user._id);
    setEditForm({
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      roleId: user.role?._id || "",
    });
    setOpenEditForm(true);
  };

  const submitEdit = async (event) => {
    event.preventDefault();
    try {
      const editingUser = users.find((item) => item._id === editingUserId);
      if (editingUser?.roleType === "manager") {
        await api.updateManager(editingUserId, {
          name: editForm.name,
          email: editForm.email,
          phone: editForm.phone,
        });
        toast.success("Manager updated");
      } else {
        await api.updateUser(editingUserId, editForm);
        toast.success("User updated");
      }
      setOpenEditForm(false);
      setEditingUserId("");
      await loadData();
    } catch (error) {
      toast.error(error.message || "Update failed");
    }
  };

  const openCapacityEditor = async (user) => {
    try {
      setCapacityUserId(user._id);
      setCapacityRoleSlug(user.role?.slug || "");
      const res = await api.getUserCapacity(user._id);
      const c = res?.data || res || {};
      setCapacityForm({
        reelCapacity: String(c.reelCapacity ?? 0),
        postCapacity: String(c.postCapacity ?? 0),
        carouselCapacity: String(c.carouselCapacity ?? 0),
      });
      setOpenCapacityForm(true);
    } catch (error) {
      toast.error(error.message || "Failed to load user capacity");
    }
  };

  const submitCapacity = async (event) => {
    event.preventDefault();
    try {
      const payload = {
        reelCapacity: Number(capacityForm.reelCapacity),
        postCapacity: Number(capacityForm.postCapacity),
        carouselCapacity: Number(capacityForm.carouselCapacity),
      };
      if (Object.values(payload).some((n) => Number.isNaN(n) || n < 0)) {
        toast.error("Capacity values must be non-negative");
        return;
      }
      await api.patchUserCapacity(capacityUserId, payload);
      toast.success("User capacity saved");
      setOpenCapacityForm(false);
    } catch (error) {
      toast.error(error.message || "Failed to save user capacity");
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">
            Manage users, managers, role assignments, and access.
          </p>
        </div>
        <Button onClick={() => setOpenForm(true)}>
          <Plus className="mr-2 h-4 w-4" /> Add User / Manager
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search users..."
            className="pl-9"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder="Filter by role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {assignableRoles.map((role) => (
              <SelectItem key={role._id} value={role.slug}>
                {role.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Role</th>
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
              filtered.map((user) => (
                  <tr key={user._id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                          {initials(user.name)}
                        </div>
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant="outline"
                        style={{
                          borderColor: user.role?.color || "var(--border)",
                          color: user.role?.color || "inherit",
                        }}
                      >
                        {user.role?.name || "Unassigned"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={user.isActive ? "default" : "outline"}>
                        {user.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ActionMenu
                        onEdit={() => openEditUser(user)}
                        onReset={() => {
                          setResetUserId(user._id);
                          setResetUserRoleType(user.roleType || "user");
                          setResetPassword(user.roleType === "manager" ? "Manager@123!" : "User@123!");
                          setOpenResetForm(true);
                        }}
                        onCapacity={() => openCapacityEditor(user)}
                        onToggleActive={async () => {
                          setPendingStatusChange(user);
                        }}
                        isActive={user.isActive}
                      />
                    </td>
                  </tr>
                ))
            ) : (
              <tr className="border-t">
                <td className="px-4 py-6" colSpan={5}>
                  <EmptyState
                    icon={FolderOpen}
                    title="No users found"
                    description="Add your first user and assign a non-system role."
                    ctaLabel="Add User"
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
          ? filtered.map((user) => (
              <div key={user._id} className="rounded-xl border border-border p-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                      {initials(user.name)}
                    </div>
                    <div>
                      <p className="font-medium">{user.name}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                  </div>
                  <ActionMenu
                    onEdit={() => openEditUser(user)}
                    onReset={() => {
                      setResetUserId(user._id);
                      setResetUserRoleType(user.roleType || "user");
                      setResetPassword(user.roleType === "manager" ? "Manager@123!" : "User@123!");
                      setOpenResetForm(true);
                    }}
                    onCapacity={() => openCapacityEditor(user)}
                    onToggleActive={async () => {
                      setPendingStatusChange(user);
                    }}
                    isActive={user.isActive}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <Badge
                    variant="outline"
                    style={{
                      borderColor: user.role?.color || "var(--border)",
                      color: user.role?.color || "inherit",
                    }}
                  >
                    {user.role?.name || "Unassigned"}
                  </Badge>
                  <Badge variant={user.isActive ? "default" : "outline"}>
                    {user.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </div>
            ))
          : (
            <EmptyState
              icon={FolderOpen}
              title="No users found"
              description="Add your first user and assign a non-system role."
              ctaLabel="Add User"
              onCta={() => setOpenForm(true)}
            />
            )}
      </div>

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={createUser}>
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
            <Field label="Role">
              <Select value={form.roleId} onValueChange={(roleId) => setForm((prev) => ({ ...prev, roleId }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((role) => (
                    <SelectItem key={role._id} value={role._id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Initial Password">
              <Input
                type="password"
                value={form.password}
                onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                required
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpenForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Create User</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openEditForm}
        onOpenChange={(open) => {
          setOpenEditForm(open);
          if (!open) setEditingUserId("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
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
            <Field label="Role">
              <Select
                value={editForm.roleId}
                onValueChange={(roleId) => setEditForm((prev) => ({ ...prev, roleId }))}
                disabled={users.find((item) => item._id === editingUserId)?.roleType === "manager"}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((role) => (
                    <SelectItem key={role._id} value={role._id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        open={openCapacityForm}
        onOpenChange={(open) => {
          setOpenCapacityForm(open);
          if (!open) {
            setCapacityUserId("");
            setCapacityRoleSlug("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>User Capacity Override</DialogTitle>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submitCapacity}>
            {capacityRoleSlug !== "designer" ? (
              <Field label="Reel Capacity">
                <Input
                  type="number"
                  min={0}
                  value={capacityForm.reelCapacity}
                  onChange={(event) =>
                    setCapacityForm((prev) => ({ ...prev, reelCapacity: event.target.value }))
                  }
                />
              </Field>
            ) : null}
            <Field label="Post Capacity">
              <Input
                type="number"
                min={0}
                value={capacityForm.postCapacity}
                onChange={(event) =>
                  setCapacityForm((prev) => ({ ...prev, postCapacity: event.target.value }))
                }
              />
            </Field>
            <Field label="Carousel Capacity">
              <Input
                type="number"
                min={0}
                value={capacityForm.carouselCapacity}
                onChange={(event) =>
                  setCapacityForm((prev) => ({ ...prev, carouselCapacity: event.target.value }))
                }
              />
            </Field>
            <p className="text-xs text-muted-foreground">0 = Use Global Capacity</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpenCapacityForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={openResetForm}
        onOpenChange={(open) => {
          setOpenResetForm(open);
          if (!open) {
            setResetUserId("");
            setResetUserRoleType("user");
            setResetPassword("User@123!");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Password</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                if (resetUserRoleType === "manager") {
                  await api.resetManagerPassword(resetUserId, { newPassword: resetPassword });
                } else {
                  await api.resetUserPassword(resetUserId, { newPassword: resetPassword });
                }
                toast.success("Password updated");
                setOpenResetForm(false);
              } catch (error) {
                toast.error(error.message || "Reset failed");
              }
            }}
          >
            <Field label="New Password">
              <Input
                type="password"
                value={resetPassword}
                onChange={(event) => setResetPassword(event.target.value)}
                required
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpenResetForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Update Password</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(pendingStatusChange)}
        onOpenChange={(open) => {
          if (!open) setPendingStatusChange(null);
        }}
        title={pendingStatusChange?.isActive ? "Deactivate user?" : "Activate user?"}
        description={`${
          pendingStatusChange?.name || "This user"
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
            if (pendingStatusChange.roleType === "manager") {
              await api.updateManager(pendingStatusChange._id, {
                isActive: !pendingStatusChange.isActive,
              });
            } else {
              await api.updateUser(pendingStatusChange._id, {
                isActive: !pendingStatusChange.isActive,
              });
            }
            toast.success(
              pendingStatusChange.isActive ? "User deactivated" : "User activated"
            );
            setPendingStatusChange(null);
            await loadData();
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

function ActionMenu({ onEdit, onReset, onCapacity, onToggleActive, isActive }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
        <DropdownMenuItem onClick={onReset}>Update Password</DropdownMenuItem>
        <DropdownMenuItem onClick={onCapacity}>Capacity</DropdownMenuItem>
        <DropdownMenuItem onClick={onToggleActive}>
          {isActive ? "Deactivate" : "Activate"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
