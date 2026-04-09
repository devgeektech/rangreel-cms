/**
 * Internal calendar draft helpers — mirror backend USER_EDITABLE_STAGES chain behaviour
 * (linear day delta for following editable stages).
 */

const USER_EDITABLE_AFTER_DRAG = new Set(["Plan", "Shoot", "Edit", "Approval"]);

const pad2 = (n) => String(n).padStart(2, "0");

export function addDaysToYmd(ymd, deltaDays) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function daysDiffYmd(fromYmd, toYmd) {
  const a = String(fromYmd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const b = String(toYmd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!a || !b) return 0;
  const d0 = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const d1 = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((d1 - d0) / 86400000);
}

function compareYmd(a, b) {
  const da = Date.parse(`${a}T00:00:00.000Z`);
  const db = Date.parse(`${b}T00:00:00.000Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return 0;
  if (da === db) return 0;
  return da < db ? -1 : 1;
}

function isWeekendYmd(ymd) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function nextWeekdayYmd(ymd) {
  let cur = String(ymd || "").slice(0, 10);
  for (let i = 0; i < 7; i += 1) {
    if (!isWeekendYmd(cur)) return cur;
    cur = addDaysToYmd(cur, 1);
  }
  return cur;
}

/**
 * Apply a dragged stage date plus the same calendar-day delta to following editable stages
 * (stops at first non-editable stage, e.g. Design on static posts).
 *
 * @param {object} draft - `{ items: [...] }`
 */
export function applyDragWithChainShift(draft, contentId, stageName, newDateYmd) {
  return applyDragWithChainShiftBounded(draft, contentId, stageName, newDateYmd).draft;
}

/**
 * Boundary-aware drag:
 * - Block if dragged stage is moved after posting date.
 * - Auto-shift following editable stages by same delta.
 * - Clamp any shifted stage that exceeds posting date.
 */
export function applyDragWithChainShiftBounded(draft, contentId, stageName, newDateYmd) {
  const items = draft?.items || [];
  const item = items.find((it) => String(it.contentId) === String(contentId));
  if (!item) return { draft, blocked: true, clamped: false, reason: "Content item not found" };

  const stages = item.stages || [];
  const idx = stages.findIndex((s) => String(s.name) === String(stageName));
  if (idx === -1) return { draft, blocked: true, clamped: false, reason: "Stage not found" };

  const oldYmd = String(stages[idx].date || "").slice(0, 10);
  const deltaDays = daysDiffYmd(oldYmd, newDateYmd);
  const postingYmd = String(item.postingDate || "").slice(0, 10);
  if (postingYmd && compareYmd(newDateYmd, postingYmd) > 0) {
    return {
      draft,
      blocked: true,
      clamped: false,
      reason: `Stage date cannot be after posting date (${postingYmd})`,
    };
  }

  const nextStages = [...stages];
  nextStages[idx] = { ...nextStages[idx], date: newDateYmd };
  let clamped = false;
  for (let i = idx + 1; i < nextStages.length; i++) {
    if (!USER_EDITABLE_AFTER_DRAG.has(String(nextStages[i].name))) break;
    const cur = String(nextStages[i].date || "").slice(0, 10);
    let shifted = addDaysToYmd(cur, deltaDays);
    if (postingYmd && compareYmd(shifted, postingYmd) > 0) {
      shifted = postingYmd;
      clamped = true;
    }
    nextStages[i] = { ...nextStages[i], date: shifted };
  }

  const nextDraft = {
    ...draft,
    items: items.map((it) =>
      String(it.contentId) === String(contentId) ? { ...it, stages: nextStages } : it
    ),
  };

  return {
    draft: nextDraft,
    blocked: false,
    clamped,
    reason: clamped ? `Some shifted stages were clamped to posting date (${postingYmd})` : "",
  };
}

export { USER_EDITABLE_AFTER_DRAG };

/**
 * Phase 12: pre-creation customization drag engine.
 *
 * Rules:
 * - Dragging Post shifts ALL stages by offsetDays.
 * - Middle phases (Shoot/Edit/Approval) can move only between prev/next and before Post.
 * - Nothing can cross Post. Stage order must remain Plan < Shoot < Edit < Approval < Post.
 * @param {{ minStageDateYmd?: string }} [options] - If set, every stage date must be on or after this day (YYYY-MM-DD).
 */
export function applyCustomizationDrag(draft, contentId, stageName, newDateYmd, options = {}) {
  const items = draft?.items || [];
  const item = items.find((it) => String(it.contentId) === String(contentId));
  if (!item) return { draft, blocked: true, reason: "Content item not found" };

  const stages = Array.isArray(item.stages) ? item.stages : [];
  const idx = stages.findIndex((s) => String(s.name) === String(stageName));
  if (idx === -1) return { draft, blocked: true, reason: "Stage not found" };

  const oldYmd = String(stages[idx].date || "").slice(0, 10);
  const offsetDays = daysDiffYmd(oldYmd, newDateYmd);
  if (offsetDays === 0) return { draft, blocked: false, reason: "" };

  const isPost = String(stageName) === "Post";
  const postStage = stages.find((s) => String(s.name) === "Post");
  const postDate = String(postStage?.date || item.postingDate || "").slice(0, 10);
  const nextStages = [...stages];
  const weekendEnabled = options?.weekendEnabled === true;

  if (isPost) {
    for (let i = 0; i < nextStages.length; i++) {
      const cur = String(nextStages[i]?.date || "").slice(0, 10);
      let shifted = addDaysToYmd(cur, offsetDays);
      if (!weekendEnabled) shifted = nextWeekdayYmd(shifted);
      nextStages[i] = { ...nextStages[i], date: shifted };
    }
  } else {
    const prevStageDate = idx > 0 ? String(nextStages[idx - 1]?.date || "").slice(0, 10) : "";
    const nextStageDate =
      idx < nextStages.length - 1 ? String(nextStages[idx + 1]?.date || "").slice(0, 10) : "";

    let normalizedNewDate = newDateYmd;
    if (!weekendEnabled) normalizedNewDate = nextWeekdayYmd(normalizedNewDate);

    if (postDate && compareYmd(normalizedNewDate, postDate) >= 0) {
      return {
        draft,
        blocked: true,
        reason: "Phase cannot reach or exceed posting date. Move Post instead.",
        code: "after_post",
      };
    }
    if (prevStageDate && compareYmd(normalizedNewDate, prevStageDate) <= 0) {
      return { draft, blocked: true, reason: "Cannot overlap previous phase", code: "prev_overlap" };
    }
    if (nextStageDate && compareYmd(normalizedNewDate, nextStageDate) >= 0) {
      return { draft, blocked: true, reason: "Cannot overlap next phase", code: "next_overlap" };
    }

    nextStages[idx] = { ...nextStages[idx], date: normalizedNewDate };
  }

  // Safety: ensure Post remains last phase by date.
  const postIdx = nextStages.findIndex((s) => String(s.name) === "Post");
  if (postIdx !== -1) {
    const pd = String(nextStages[postIdx]?.date || "").slice(0, 10);
    for (let i = 0; i < nextStages.length - 1; i++) {
      const d = String(nextStages[i]?.date || "").slice(0, 10);
      if (pd && d && compareYmd(d, pd) >= 0) {
        return {
          draft,
          blocked: true,
          reason: "Phase cannot reach or exceed posting date. Move Post instead.",
          code: "after_post",
        };
      }
    }
  }

  const minY = options?.minStageDateYmd ? String(options.minStageDateYmd).slice(0, 10) : "";
  if (minY && /^\d{4}-\d{2}-\d{2}$/.test(minY)) {
    for (const s of nextStages) {
      const d = String(s?.date || "").slice(0, 10);
      if (d && compareYmd(d, minY) < 0) {
        return {
          draft,
          blocked: true,
          reason: "Schedule cannot start before the client start date",
          code: "before_start_date",
        };
      }
    }
  }

  const postIdxForItem = nextStages.findIndex((s) => String(s.name) === "Post");
  const postingFromPost =
    postIdxForItem !== -1 ? String(nextStages[postIdxForItem]?.date || "").slice(0, 10) : "";

  const nextDraft = {
    ...draft,
    items: items.map((it) =>
      String(it.contentId) === String(contentId)
        ? {
            ...it,
            stages: nextStages,
            ...(postingFromPost ? { postingDate: postingFromPost } : {}),
          }
        : it
    ),
  };

  return { draft: nextDraft, blocked: false, reason: "" };
}

/**
 * Post-creation manager edit rules:
 * - Post is locked (cannot move).
 * - Any other phase can move only within strict prev/next boundaries and before Post.
 * - No full-pipeline shift.
 */
export function applyManagerEditDrag(draft, contentId, stageName, newDateYmd) {
  const items = draft?.items || [];
  const item = items.find((it) => String(it.contentId) === String(contentId));
  if (!item) return { draft, blocked: true, reason: "Content item not found" };

  const stages = Array.isArray(item.stages) ? item.stages : [];
  const idx = stages.findIndex((s) => String(s.name) === String(stageName));
  if (idx === -1) return { draft, blocked: true, reason: "Stage not found" };
  if (String(stageName) === "Post") {
    return { draft, blocked: true, reason: "Post phase cannot be edited after creation" };
  }

  const postStage = stages.find((s) => String(s.name) === "Post");
  const postDate = String(postStage?.date || item.postingDate || "").slice(0, 10);
  const prevStageDate = idx > 0 ? String(stages[idx - 1]?.date || "").slice(0, 10) : "";
  const nextStageDate = idx < stages.length - 1 ? String(stages[idx + 1]?.date || "").slice(0, 10) : "";

  if (postDate && compareYmd(newDateYmd, postDate) >= 0) {
    return { draft, blocked: true, reason: "Cannot move beyond posting date" };
  }
  if (prevStageDate && compareYmd(newDateYmd, prevStageDate) <= 0) {
    return { draft, blocked: true, reason: "Cannot overlap previous phase" };
  }
  if (nextStageDate && compareYmd(newDateYmd, nextStageDate) >= 0) {
    return { draft, blocked: true, reason: "Cannot overlap next phase" };
  }

  const nextStages = [...stages];
  nextStages[idx] = { ...nextStages[idx], date: newDateYmd };

  const nextDraft = {
    ...draft,
    items: items.map((it) =>
      String(it.contentId) === String(contentId) ? { ...it, stages: nextStages } : it
    ),
  };

  return { draft: nextDraft, blocked: false, reason: "" };
}
