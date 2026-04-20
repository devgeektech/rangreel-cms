/**
 * Centralised API client for the Rangreel backend.
 * Base URL: NEXT_PUBLIC_API_URL (e.g. http://localhost:5000/api).
 * All requests use credentials: 'include' for httpOnly cookie auth.
 */

function getBaseUrl() {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }
  return base.replace(/\/$/, "");
}

/**
 * @param {string} path - Path relative to API root (e.g. '/auth/login' or 'auth/login')
 * @param {RequestInit} [options] - fetch options; credentials and JSON body are handled for you
 * @returns {Promise<Response>}
 */
export async function apiFetch(path, options = {}) {
  const base = getBaseUrl();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${base}${normalizedPath}`;

  const headers = new Headers(options.headers);

  let body = options.body;
  if (
    body &&
    typeof body === "object" &&
    !(body instanceof FormData) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer)
  ) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    body = JSON.stringify(body);
  }

  return fetch(url, {
    ...options,
    credentials: "include",
    headers,
    body,
  });
}

/**
 * Parse JSON if Content-Type is JSON; otherwise return text or null.
 * @param {Response} res
 */
async function parseResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  return text || null;
}

/**
 * @param {string} path
 * @param {RequestInit} [options]
 */
export async function apiRequest(path, options = {}) {
  const res = await apiFetch(path, options);
  const data = await parseResponse(res);
  return { res, data };
}

async function requestJson(path, options = {}) {
  const { res, data } = await apiRequest(path, options);
  if (!res.ok) {
    const errorMessage =
      (data && (data.error || data.message)) || "Request failed";
    const error = new Error(errorMessage);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const api = {
  get: (path, options = {}) => apiFetch(path, { ...options, method: "GET" }),

  post: (path, body, options = {}) =>
    apiFetch(path, { ...options, method: "POST", body }),

  put: (path, body, options = {}) =>
    apiFetch(path, { ...options, method: "PUT", body }),

  patch: (path, body, options = {}) =>
    apiFetch(path, { ...options, method: "PATCH", body }),

  delete: (path, options = {}) =>
    apiFetch(path, { ...options, method: "DELETE" }),

  login: (payload) =>
    requestJson("/auth/login", {
      method: "POST",
      body: payload,
    }),

  changePassword: (payload) =>
    requestJson("/auth/change-password", {
      method: "POST",
      body: payload,
    }),

  logout: () =>
    requestJson("/auth/logout", {
      method: "POST",
    }),

  getMe: () => requestJson("/user/me", { method: "GET" }),
  getMyNotifications: () => requestJson("/user/notifications", { method: "GET" }),
  markNotificationRead: (notificationId) =>
    requestJson(`/user/notifications/${encodeURIComponent(notificationId)}/read`, {
      method: "PATCH",
    }),

  getRoles: () => requestJson("/admin/roles", { method: "GET" }),
  createRole: (payload) =>
    requestJson("/admin/roles", {
      method: "POST",
      body: payload,
    }),
  updateRole: (id, payload) =>
    requestJson(`/admin/roles/${id}`, {
      method: "PUT",
      body: payload,
    }),
  deleteRole: (id) =>
    requestJson(`/admin/roles/${id}`, {
      method: "DELETE",
    }),

  getManagers: () => requestJson("/admin/managers", { method: "GET" }),
  createManager: (payload) =>
    requestJson("/admin/managers", {
      method: "POST",
      body: payload,
    }),
  updateManager: (id, payload) =>
    requestJson(`/admin/managers/${id}`, {
      method: "PUT",
      body: payload,
    }),
  resetManagerPassword: (id, payload) =>
    requestJson(`/admin/managers/${id}/reset-password`, {
      method: "PUT",
      body: payload,
    }),

  getUsers: ({ role, search, includeAdmins } = {}) => {
    const params = new URLSearchParams();
    if (role) params.set("role", role);
    if (search) params.set("search", search);
    if (includeAdmins) params.set("includeAdmins", "true");
    const query = params.toString();
    return requestJson(`/admin/users${query ? `?${query}` : ""}`, { method: "GET" });
  },
  createUser: (payload) =>
    requestJson("/admin/users", {
      method: "POST",
      body: payload,
    }),
  updateUser: (id, payload) =>
    requestJson(`/admin/users/${id}`, {
      method: "PUT",
      body: payload,
    }),
  resetUserPassword: (id, payload) =>
    requestJson(`/admin/users/${id}/reset-password`, {
      method: "PUT",
      body: payload,
    }),

  getPackages: () => requestJson("/packages", { method: "GET" }),
  createPackage: (body) =>
    requestJson("/packages", {
      method: "POST",
      body,
    }),
  updatePackage: (id, body) =>
    requestJson(`/packages/${id}`, {
      method: "PATCH",
      body,
    }),
  deletePackage: (id) =>
    requestJson(`/packages/${id}`, {
      method: "DELETE",
    }),

  // -------------------------------------------------------------------------
  // Admin — public holidays
  // -------------------------------------------------------------------------
  getHolidays: () => requestJson("/admin/holidays", { method: "GET" }),
  createHoliday: (body) =>
    requestJson("/admin/holidays", {
      method: "POST",
      body,
    }),
  deleteHoliday: (id) =>
    requestJson(`/admin/holidays/${id}`, {
      method: "DELETE",
    }),

  // -------------------------------------------------------------------------
  // Admin — global calendar & clients (read-only calendar)
  // -------------------------------------------------------------------------
  getAdminCalendar: (month) =>
    requestJson(`/admin/calendar?month=${encodeURIComponent(month)}`, {
      method: "GET",
    }),
  getAdminClients: () => requestJson("/admin/clients", { method: "GET" }),

  /** Prompt 46/50: global per-role daily caps (TeamCapacity) */
  getTeamCapacity: () => requestJson("/admin/team-capacity", { method: "GET" }),
  patchTeamCapacity: (role, body) =>
    requestJson(`/admin/team-capacity/${encodeURIComponent(role)}`, {
      method: "PATCH",
      body,
    }),
  getUserCapacity: (id) =>
    requestJson(`/admin/users/${encodeURIComponent(id)}/capacity`, { method: "GET" }),
  patchUserCapacity: (id, body) =>
    requestJson(`/admin/users/${encodeURIComponent(id)}/capacity`, {
      method: "PATCH",
      body,
    }),
  getCapacityOverview: () => requestJson("/admin/capacity-overview", { method: "GET" }),

  // Manager clients
  getMyClients: () => requestJson("/manager/clients", { method: "GET" }),
  createClient: (body) =>
    requestJson("/manager/clients", {
      method: "POST",
      body,
    }),

  uploadClientBriefAssets: async (clientId, formData) => {
    const { res, data } = await apiRequest(
      `/manager/clients/${encodeURIComponent(clientId)}/brief-assets`,
      {
        method: "POST",
        body: formData,
      }
    );
    if (!res.ok) {
      const errorMessage = (data && (data.error || data.message)) || "Upload failed";
      const err = new Error(errorMessage);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },
  getClient: (id) => requestJson(`/manager/clients/${id}`, { method: "GET" }),
  updateClient: (id, body) =>
    requestJson(`/manager/clients/${id}`, {
      method: "PATCH",
      body,
    }),
  updateClientGoogleReviews: (id, body) =>
    requestJson(`/manager/clients/${id}/google-reviews`, {
      method: "PATCH",
      body,
    }),

  // Manager calendars
  getManagerGlobalCalendar: (month) =>
    requestJson(`/manager/global-calendar?month=${encodeURIComponent(month)}`, {
      method: "GET",
    }),

  /** PROMPT 72 — Final manager view (multi-day tasks + leave highlights). */
  getManagerGlobalCalendarFinal: (month) =>
    requestJson(`/manager/global-calendar?month=${encodeURIComponent(month)}`, {
      method: "GET",
    }),

  // Manager reads (packages/users for client creation)
  getManagerPackages: () => requestJson("/manager/packages", { method: "GET" }),
  createManagerPackage: (body) =>
    requestJson("/manager/packages", {
      method: "POST",
      body,
    }),
  getTeamUsers: () => requestJson("/manager/team-users", { method: "GET" }),
  getManagerTeamCapacity: () => requestJson("/manager/team-capacity", { method: "GET" }),
  getStrategistGlobalCalendar: (month) =>
    requestJson(`/user/strategist/global-calendar?month=${encodeURIComponent(month)}`, {
      method: "GET",
    }),
  getStrategistTeamUsers: () => requestJson("/user/strategist/team-users", { method: "GET" }),
  getStrategistTeamCapacity: () =>
    requestJson("/user/strategist/team-capacity", { method: "GET" }),
  getStrategistLeave: (userId) =>
    requestJson(
      `/user/strategist/leave${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
      { method: "GET" }
    ),
  addStrategistLeave: (body) =>
    requestJson("/user/strategist/leave", {
      method: "POST",
      body,
    }),
  deleteStrategistLeave: (leaveId) =>
    requestJson(`/user/strategist/leave/${encodeURIComponent(leaveId)}`, {
      method: "DELETE",
    }),
  strategistDragTask: (body) =>
    requestJson("/user/strategist/drag-task", {
      method: "PATCH",
      body,
    }),

  /** PROMPT 67 — Manager drag with full scheduler (replacement, buffer, duration, weekend). */
  managerDragTask: (body) =>
    requestJson("/manager/drag-task", {
      method: "PATCH",
      body,
    }),

  /** PROMPT 74 — Manager add leave with scheduling-conflict simulation. */
  addManagerLeave: (body) =>
    requestJson("/manager/leave", {
      method: "POST",
      body,
    }),

  /** PROMPT 75 — Get leave for UI/calendar display (optional ?userId=). */
  getManagerLeave: (userId) =>
    requestJson(
      `/manager/leave${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
      { method: "GET" }
    ),

  /** PROMPT 95 — Public holidays for calendar shading. */
  getHoliday: () => requestJson("/holiday", { method: "GET" }),

  /** PROMPT 76 — Delete leave entry. */
  deleteManagerLeave: (leaveId) =>
    requestJson(`/manager/leave/${encodeURIComponent(leaveId)}`, {
      method: "DELETE",
    }),

  // Manager stage actions
  reshuffleStage: (itemId, stageId, body) =>
    requestJson(`/manager/content/${itemId}/stage/${stageId}`, {
      method: "PATCH",
      body,
    }),
  updateStageStatus: (itemId, stageId, body) =>
    requestJson(`/manager/content/${itemId}/stage/${stageId}/status`, {
      method: "PATCH",
      body,
    }),

  // Internal calendar (Prompt 69/70)
  getInternalCalendar: (clientId) =>
    requestJson(`/internal-calendar/${encodeURIComponent(clientId)}`, {
      method: "GET",
    }),

  /** Custom month cycles (startDate-anchored); includes canCreateNextMonth when totalMonths >= 3 */
  getClientSchedules: (clientId) =>
    requestJson(`/manager/schedule/${encodeURIComponent(clientId)}`, {
      method: "GET",
    }),

  createNextScheduleMonth: (clientId) =>
    requestJson("/manager/schedule/create-next-month", {
      method: "POST",
      body: { clientId },
    }),

  extendClientSchedules: (clientId, numberOfCycles, options = {}) =>
    requestJson("/manager/schedule/extend", {
      method: "POST",
      body: { clientId, numberOfCycles, startMonthIndex: options.startMonthIndex },
    }),

  saveClientSchedules: (clientId, schedules) =>
    requestJson("/manager/schedule/save", {
      method: "POST",
      body: { clientId, schedules },
    }),

  previewExtendClientSchedules: (clientId, numberOfCycles, options = {}) =>
    requestJson("/manager/schedule/preview-extend", {
      method: "POST",
      body: { clientId, numberOfCycles, startMonthIndex: options.startMonthIndex },
    }),

  /** Smart scheduling: capacity warnings only (does not block saves). */
  checkCalendarConflicts: (body) =>
    requestJson("/calendar/check-conflicts", {
      method: "POST",
      body,
    }),

  /** Preview-only conflict checks for a "new client" (no clientId subtraction). */
  checkCalendarConflictsNew: (body) =>
    requestJson("/calendar/check-conflicts-new", {
      method: "POST",
      body,
    }),

  /** Generate an in-memory auto draft calendar (no DB writes). */
  generateCalendarDraft: (body) =>
    requestJson("/calendar/generate-draft", {
      method: "POST",
      body,
    }),

  /** Backward workflow template from posting date (manager/admin). */
  previewStagesFromPosting: (body) =>
    requestJson("/calendar/preview-stages-from-posting", {
      method: "POST",
      body,
    }),

  // Content detail (Prompt 25)
  getContent: (id) => requestJson(`/content/${encodeURIComponent(id)}`, { method: "GET" }),
  moveContentStage: (itemId, stageId, body) =>
    requestJson(`/content/${encodeURIComponent(itemId)}/stage/${encodeURIComponent(stageId)}/move`, {
      method: "PATCH",
      body,
    }),

  uploadVideo: async (file) => {
    const form = new FormData();
    form.append("file", file);
    const { res, data } = await apiRequest("/uploads/video", {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const errorMessage = (data && (data.error || data.message)) || "Upload failed";
      const err = new Error(errorMessage);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  },

  // My tasks
  getMyTasks: (month) =>
    requestJson(`/user/my-tasks?month=${encodeURIComponent(month)}`, {
      method: "GET",
    }),
  getStrategistGlobalCalendar: (month) =>
    requestJson(`/user/global-calendar?month=${encodeURIComponent(month)}`, {
      method: "GET",
    }),
  getStrategistTeamUsers: () => requestJson("/user/team-users", { method: "GET" }),
  getStrategistTeamCapacity: () => requestJson("/user/team-capacity", { method: "GET" }),
  getStrategistLeave: (userId) =>
    requestJson(
      `/user/leave${userId ? `?userId=${encodeURIComponent(userId)}` : ""}`,
      { method: "GET" }
    ),
  strategistDragTask: (body) =>
    requestJson("/user/drag-task", {
      method: "PATCH",
      body,
    }),
  getTeamClient: (id) =>
    requestJson(`/user/clients/${encodeURIComponent(id)}`, {
      method: "GET",
    }),
  updateMyTaskStatus: (itemId, stageId, body) =>
    requestJson(`/user/my-tasks/${itemId}/${stageId}`, {
      method: "PATCH",
      body,
    }),
};

export { getBaseUrl };
