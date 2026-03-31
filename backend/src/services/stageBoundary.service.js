const { generateWorkflowStagesFromPostingDate } = require("./workflowFromPostingDate.service");

function normalizeUTCDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toYmd(date) {
  const d = normalizeUTCDate(date);
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function isAfterDate(a, b) {
  const da = normalizeUTCDate(a);
  const db = normalizeUTCDate(b);
  if (!da || !db) return false;
  return da.getTime() > db.getTime();
}

function normalizeDraftType(type) {
  const t = String(type || "").toLowerCase();
  if (t === "reel") return "reel";
  if (t === "carousel") return "carousel";
  return "post";
}

function validateStagesNotAfterPosting(stages, postingDate) {
  const post = normalizeUTCDate(postingDate);
  if (!post) return { ok: false, error: "Invalid posting date", violations: [] };
  const violations = [];
  for (const s of stages || []) {
    const due = normalizeUTCDate(s?.date || s?.dueDate);
    if (!due) continue;
    if (due.getTime() > post.getTime()) {
      violations.push({
        stageName: String(s?.name || s?.stageName || ""),
        stageDate: toYmd(due),
        postingDate: toYmd(post),
      });
    }
  }
  return { ok: violations.length === 0, violations };
}

function clampStagesToPosting(stages, postingDate) {
  const post = normalizeUTCDate(postingDate);
  if (!post) return { stages: stages || [], clamped: false };
  let clamped = false;
  const next = (stages || []).map((s) => {
    const key = String(s?.name || s?.stageName || "");
    const dateKey = Object.prototype.hasOwnProperty.call(s || {}, "date") ? "date" : "dueDate";
    const due = normalizeUTCDate(s?.[dateKey]);
    if (!due) return s;
    if (key === "Post") {
      if (due.getTime() !== post.getTime()) clamped = true;
      return { ...s, [dateKey]: post };
    }
    if (due.getTime() > post.getTime()) {
      clamped = true;
      return { ...s, [dateKey]: post };
    }
    return s;
  });
  return { stages: next, clamped };
}

function recalculateStagesFromPosting({ itemType, postingDate, existingStages }) {
  const post = normalizeUTCDate(postingDate);
  if (!post) throw new Error("Invalid posting date");
  const contentType = normalizeDraftType(itemType);
  const template = generateWorkflowStagesFromPostingDate(post, contentType);
  const byName = new Map(
    (existingStages || []).map((s) => [String(s?.name || s?.stageName || ""), s])
  );
  const stages = template.stages.map((row) => {
    const existing = byName.get(String(row.stageName)) || {};
    const hasDateField = Object.prototype.hasOwnProperty.call(existing, "date");
    return {
      ...existing,
      ...(hasDateField ? { date: row.date } : { dueDate: row.date }),
      name: existing?.name || row.stageName,
      stageName: existing?.stageName || row.stageName,
      role: existing?.role || row.role,
    };
  });
  return { stages, postingDate: toYmd(post) };
}

module.exports = {
  normalizeUTCDate,
  toYmd,
  isAfterDate,
  validateStagesNotAfterPosting,
  clampStagesToPosting,
  recalculateStagesFromPosting,
};
