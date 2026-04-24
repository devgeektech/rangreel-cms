/**
 * Custom "month" anchored to client startDate (UTC), matching backend
 * `customMonthRange.service.js`. Example: 9 Apr → cycle 9 Apr–8 May.
 */

export function normalizeUtcMidnight(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * @param {Date|string} startDate
 * @param {number} monthOffset - 0 = first cycle from startDate
 * @returns {{ start: Date, end: Date }}
 */
export function getCustomMonthRange(startDate, monthOffset = 0) {
  const base = normalizeUtcMidnight(startDate);
  if (!base) {
    throw new Error("Invalid startDate for getCustomMonthRange");
  }
  const off = Number(monthOffset) || 0;
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + off, base.getUTCDate()));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()));
  end.setUTCDate(end.getUTCDate() - 1);
  return { start, end };
}

export function toYmdUtc(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

/** Posting date falls in [start, end] inclusive (UTC days). */
export function postingInCustomRange(postingDate, start, end) {
  const p = toYmdUtc(postingDate);
  const s = toYmdUtc(start);
  const e = toYmdUtc(end);
  if (!p || !s || !e) return true;
  return p >= s && p <= e;
}

export function prettyDateUtc(ymdOrDate) {
  const ymd =
    typeof ymdOrDate === "string" && ymdOrDate.length >= 10
      ? ymdOrDate.slice(0, 10)
      : toYmdUtc(ymdOrDate);
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/** Merge DnD output (subset of items) back into the full preview draft. */
export function mergeScheduleDraft(prevFull, partialFromDnd) {
  if (!prevFull) return partialFromDnd;
  if (!partialFromDnd?.items) return prevFull;
  const updatedIds = new Set(partialFromDnd.items.map((it) => String(it.contentId)));
  const kept = (prevFull.items || []).filter((it) => !updatedIds.has(String(it.contentId)));
  return {
    ...prevFull,
    ...partialFromDnd,
    items: [...kept, ...partialFromDnd.items],
  };
}
