/**
 * Strategist (and any screen) that needs completed + active stages.
 * Use until `api.getMyTasks` in `lib/api.js` supports `{ includeCompleted: true }` (merge from repo when file is writable).
 */
import { apiFetch } from "@/lib/api";

async function parseBody(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  return null;
}

export async function getMyTasksIncludingCompleted(month) {
  const path = `/user/my-tasks?month=${encodeURIComponent(month)}&includeCompleted=true`;
  const res = await apiFetch(path, { method: "GET" });
  const data = await parseBody(res);
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || "Failed to load tasks";
    throw new Error(msg);
  }
  return data;
}
