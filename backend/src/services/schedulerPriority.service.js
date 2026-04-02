/**
 * PROMPT 68 — Global priority resolution (within one generation batch; capacity counts remain global across clients).
 *
 * Priority order:
 * 1. Urgent plan (reels 1–2)
 * 2. Earliest intended posting anchor (stagger date — proxy for earliest post)
 * 3. Normal plan (non-urgent), still ordered by earliest anchor
 *
 * Tie-break: reel → post → carousel when anchors match.
 */

const KIND_ORDER = { reel: 0, post: 1, carousel: 2 };

/**
 * Used by `generateClientReels`: anchors match reel/post/carousel stagger from `baseStartDate` (same as loop seeds).
 */
function buildSortedWorkUnitsClientGeneration(baseStartDate, reelsCount, postsCount, carouselsCount, addDaysUTC) {
  const units = [];

  for (let i = 1; i <= reelsCount; i++) {
    const isUrgent = i <= 2;
    const staggerOffset = isUrgent ? (i - 1) * 1 : (i - 1) * 2;
    units.push({
      kind: "reel",
      index: i,
      isUrgent,
      anchorDate: addDaysUTC(baseStartDate, staggerOffset),
    });
  }

  for (let i = 1; i <= postsCount; i++) {
    const staggerOffset = (i - 1) * 2;
    units.push({
      kind: "post",
      index: i,
      isUrgent: false,
      anchorDate: addDaysUTC(baseStartDate, staggerOffset),
    });
  }

  for (let i = 1; i <= carouselsCount; i++) {
    const staggerOffset = (i - 1) * 2;
    units.push({
      kind: "carousel",
      index: i,
      isUrgent: false,
      anchorDate: addDaysUTC(baseStartDate, staggerOffset),
    });
  }

  sortUnits(units);
  return units;
}

/**
 * Used by `generateCalendarDraft`: posting cursor uses per-type backward offset from posting day.
 */
function buildSortedWorkUnitsDraft(
  baseStartDate,
  reelsCount,
  postsCount,
  carouselsCount,
  reelsMaxOffset,
  postMaxOffset,
  addDaysUTC
) {
  const units = [];

  for (let i = 1; i <= reelsCount; i++) {
    const isUrgent = i <= 2;
    const staggerOffset = isUrgent ? (i - 1) * 1 : (i - 1) * 2;
    units.push({
      kind: "reel",
      index: i,
      isUrgent,
      sortDate: addDaysUTC(baseStartDate, reelsMaxOffset + staggerOffset),
    });
  }

  for (let i = 1; i <= postsCount; i++) {
    const staggerOffset = (i - 1) * 2;
    units.push({
      kind: "post",
      index: i,
      isUrgent: false,
      sortDate: addDaysUTC(baseStartDate, postMaxOffset + staggerOffset),
    });
  }

  for (let i = 1; i <= carouselsCount; i++) {
    const staggerOffset = (i - 1) * 2;
    units.push({
      kind: "carousel",
      index: i,
      isUrgent: false,
      sortDate: addDaysUTC(baseStartDate, postMaxOffset + staggerOffset),
    });
  }

  units.sort((a, b) => {
    if (Boolean(a.isUrgent) !== Boolean(b.isUrgent)) {
      return Number(b.isUrgent) - Number(a.isUrgent);
    }
    const ta = a.sortDate.getTime();
    const tb = b.sortDate.getTime();
    if (ta !== tb) return ta - tb;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });

  return units;
}

function sortUnits(units) {
  units.sort((a, b) => {
    if (Boolean(a.isUrgent) !== Boolean(b.isUrgent)) {
      return Number(b.isUrgent) - Number(a.isUrgent);
    }
    const ta = a.anchorDate.getTime();
    const tb = b.anchorDate.getTime();
    if (ta !== tb) return ta - tb;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
}

module.exports = {
  buildSortedWorkUnitsClientGeneration,
  buildSortedWorkUnitsDraft,
};
