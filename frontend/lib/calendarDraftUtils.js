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

/**
 * Apply a dragged stage date plus the same calendar-day delta to following editable stages
 * (stops at first non-editable stage, e.g. Design on static posts).
 *
 * @param {object} draft - `{ items: [...] }`
 */
export function applyDragWithChainShift(draft, contentId, stageName, newDateYmd) {
  const items = draft?.items || [];
  const item = items.find((it) => String(it.contentId) === String(contentId));
  if (!item) return draft;

  const stages = item.stages || [];
  const idx = stages.findIndex((s) => String(s.name) === String(stageName));
  if (idx === -1) return draft;

  const oldYmd = String(stages[idx].date || "").slice(0, 10);
  const deltaDays = daysDiffYmd(oldYmd, newDateYmd);

  const nextStages = [...stages];
  nextStages[idx] = { ...nextStages[idx], date: newDateYmd };
  for (let i = idx + 1; i < nextStages.length; i++) {
    if (!USER_EDITABLE_AFTER_DRAG.has(String(nextStages[i].name))) break;
    const cur = String(nextStages[i].date || "").slice(0, 10);
    nextStages[i] = { ...nextStages[i], date: addDaysToYmd(cur, deltaDays) };
  }

  return {
    ...draft,
    items: items.map((it) =>
      String(it.contentId) === String(contentId) ? { ...it, stages: nextStages } : it
    ),
  };
}

export { USER_EDITABLE_AFTER_DRAG };
