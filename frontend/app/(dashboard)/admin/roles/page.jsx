"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FolderOpen,
  Edit,
  Lock,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import EmptyState from "@/components/shared/EmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { RoleCardsSkeleton } from "@/components/shared/AdminSkeletons";

const colorSwatches = [
  "#6C3EBF",
  "#E84393",
  "#0EA5E9",
  "#F59E0B",
  "#10B981",
  "#8B5CF6",
  "#EF4444",
];

const iconOptions = [
  "Shield",
  "Users",
  "Lightbulb",
  "Video",
  "Scissors",
  "Palette",
  "Send",
];

const permissionOptions = [
  "users.read",
  "users.write",
  "roles.read",
  "roles.write",
  "content.manage",
  "reports.view",
  "*",
];

const slugify = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");

const initialForm = {
  name: "",
  slug: "",
  description: "",
  color: "#6C3EBF",
  icon: "Shield",
  permissions: [],
  isActive: true,
};

const protectedSystemSlugs = new Set(["admin", "manager"]);
const nonEditableSlugs = new Set(["admin"]);

export default function AdminRolesPage() {
  const [loading, setLoading] = useState(true);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [openForm, setOpenForm] = useState(false);
  const [openDelete, setOpenDelete] = useState(false);
  const [editingRole, setEditingRole] = useState(null);
  const [deletingRole, setDeletingRole] = useState(null);
  const [form, setForm] = useState(initialForm);

  const loadData = async () => {
    try {
      setLoading(true);
      const [rolesRes, usersRes, managersRes] = await Promise.all([
        api.getRoles(),
        api.getUsers({ includeAdmins: true }),
        api.getManagers(),
      ]);
      setRoles(rolesRes?.data || []);
      setUsers([...(usersRes?.data || []), ...(managersRes?.data || [])]);
    } catch (error) {
      toast.error(error.message || "Failed to load roles");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const roleCounts = useMemo(() => {
    const map = new Map();
    users.forEach((user) => {
      if (!user?.isActive) return;
      const roleId = user.role?._id || user.role;
      if (!roleId) return;
      map.set(roleId, (map.get(roleId) || 0) + 1);
    });
    return map;
  }, [users]);

  const openCreateModal = () => {
    setEditingRole(null);
    setForm(initialForm);
    setOpenForm(true);
  };

  const openEditModal = (role) => {
    setEditingRole(role);
    setForm({
      name: role.name || "",
      slug: role.slug || "",
      description: role.description || "",
      color: role.color || "#6C3EBF",
      icon: role.icon || "Shield",
      permissions: Array.isArray(role.permissions) ? role.permissions : [],
      isActive: role.isActive ?? true,
    });
    setOpenForm(true);
  };

  const togglePermission = (permission) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permission)
        ? prev.permissions.filter((item) => item !== permission)
        : [...prev.permissions, permission],
    }));
  };

  const submitRole = async (event) => {
    event.preventDefault();
    try {
      if (editingRole && nonEditableSlugs.has(editingRole.slug)) {
        toast.error("Admin role cannot be edited");
        return;
      }

      const payload = editingRole
        ? {
            name: form.name,
            description: form.description,
            dashboardRoute: editingRole.dashboardRoute,
            permissions: form.permissions,
            isActive: form.isActive,
            color: form.color,
            icon: form.icon,
          }
        : {
            name: form.name,
            description: form.description,
            permissions: form.permissions,
            isActive: form.isActive,
            color: form.color,
            icon: form.icon,
          };
      if (editingRole) {
        await api.updateRole(editingRole._id, payload);
        toast.success("Role updated");
      } else {
        await api.createRole(payload);
        toast.success("Role created");
      }
      setOpenForm(false);
      await loadData();
    } catch (error) {
      toast.error(error.message || "Failed to save role");
    }
  };

  const confirmDelete = async () => {
    if (!deletingRole) return;
    if (protectedSystemSlugs.has(deletingRole.slug)) {
      toast.error("Admin and Manager roles cannot be deleted");
      return;
    }
    const count = roleCounts.get(deletingRole._id) || 0;
    if (count > 0) {
      toast.error("Cannot delete role with assigned users");
      return;
    }
    try {
      await api.deleteRole(deletingRole._id);
      toast.success("Role deleted");
      setOpenDelete(false);
      setDeletingRole(null);
      await loadData();
    } catch (error) {
      toast.error(error.message || "Failed to delete role");
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Roles</h2>
          <p className="text-sm text-muted-foreground">Configure access roles and permissions.</p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="mr-2 h-4 w-4" /> Add Role
        </Button>
      </div>

      {loading ? (
        <RoleCardsSkeleton />
      ) : roles.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No roles found"
          description="Create roles to define role-based access."
          ctaLabel="Add Role"
          onCta={openCreateModal}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => {
              const count = roleCounts.get(role._id) || 0;
              const cannotDelete = protectedSystemSlugs.has(role.slug);
              const cannotEdit = nonEditableSlugs.has(role.slug);
              return (
                <Card
                  key={role._id}
                  className="border-l-4"
                  style={{ borderLeftColor: role.color || "#6C3EBF" }}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          {role.name}
                          {role.isSystem ? <Lock className="h-4 w-4 text-muted-foreground" /> : null}
                        </CardTitle>
                        <Badge variant="outline" className="mt-2">
                          {role.slug}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        {!cannotEdit ? (
                          <Button variant="ghost" size="icon-sm" onClick={() => openEditModal(role)}>
                            <Edit className="h-4 w-4" />
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={cannotDelete}
                          title={cannotDelete ? "This system role cannot be deleted" : "Delete role"}
                          onClick={() => {
                            setDeletingRole(role);
                            setOpenDelete(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <p className="line-clamp-2 text-muted-foreground">
                      {role.description || "No description provided."}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Users className="h-4 w-4" /> {count} users
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Active</span>
                        <Switch
                          checked={role.isActive}
                          onCheckedChange={async (checked) => {
                            try {
                              await api.updateRole(role._id, { isActive: checked });
                              setRoles((prev) =>
                                prev.map((item) =>
                                  item._id === role._id ? { ...item, isActive: checked } : item
                                )
                              );
                            } catch (error) {
                              toast.error(error.message || "Failed to update role");
                            }
                          }}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}

      <Dialog open={openForm} onOpenChange={setOpenForm}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingRole ? "Edit Role" : "Add Role"}</DialogTitle>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitRole}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={form.name}
                  disabled={editingRole?.slug === "admin"}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                      slug: editingRole ? prev.slug : slugify(event.target.value),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Slug</Label>
                <Input
                  value={editingRole ? form.slug : slugify(form.name)}
                  disabled
                  placeholder="auto-generated"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2">
                {colorSwatches.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`h-7 w-7 rounded-full border-2 ${
                      form.color === color ? "border-foreground" : "border-transparent"
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setForm((prev) => ({ ...prev, color }))}
                    aria-label={`Select ${color}`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {iconOptions.map((icon) => (
                  <button
                    key={icon}
                    type="button"
                    className={`rounded-lg border px-2 py-1.5 text-xs transition-colors ${
                      form.icon === icon ? "border-primary bg-primary/10" : "border-border hover:bg-muted"
                    }`}
                    onClick={() => setForm((prev) => ({ ...prev, icon }))}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {permissionOptions.map((permission) => (
                  <label key={permission} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <Checkbox
                      checked={form.permissions.includes(permission)}
                      onCheckedChange={() => togglePermission(permission)}
                    />
                    <span>{permission}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setOpenForm(false)}>
                Cancel
              </Button>
              <Button type="submit">{editingRole ? "Save Changes" : "Create Role"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={openDelete}
        onOpenChange={setOpenDelete}
        title="Delete role?"
        description="This action cannot be undone. System roles or roles with assigned users cannot be deleted."
        confirmLabel="Confirm Delete"
        destructive
        onConfirm={confirmDelete}
      />
    </section>
  );
}
