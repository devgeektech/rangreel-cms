/**
 * Custom "month" = anchored to client startDate (same day next month, end = day before).
 * Example: start 9 Apr → cycle 9 Apr → 8 May (UTC calendar days).
 * Uses UTC to match ContentItem / internal calendar storage.
 */

function normalizeUtcMidnight(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * @param {Date|string} startDate - Client contract start (any time on that UTC day)
 * @param {number} monthOffset - 0 = first cycle from startDate, 1 = next cycle, …
 * @returns {{ start: Date, end: Date }}
 */
function getCustomMonthRange(startDate, monthOffset = 0) {
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

module.exports = {
  getCustomMonthRange,
  normalizeUtcMidnight,
};
