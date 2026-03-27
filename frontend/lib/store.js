import { create } from "zustand";

/**
 * @typedef {object} RoleRef
 * @property {string} [_id]
 * @property {string} [name]
 * @property {string} [slug]
 * @property {string} [dashboardRoute]
 */

/**
 * @typedef {object} UserState
 * @property {string} [name]
 * @property {string} [email]
 * @property {string} [roleType]
 * @property {RoleRef|null} [role]
 * @property {string} [dashboardRoute]
 */

export const useAuthStore = create((set) => ({
  user: /** @type {UserState|null} */ (null),

  setUser: (user) => set({ user: user || null }),

  clearUser: () => set({ user: null }),
}));
