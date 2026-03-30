/**
 * Smart scheduling helpers: derive workflow stage dates working backward from a locked posting day.
 * Uses UTC calendar days (aligned with ClientScheduleDraft / internal calendar).
 */

const addDaysUTC = (date, days) => {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() + days);
  return x;
};

const toYMDUTC = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function normalizePostingDate(postingDate) {
  if (!postingDate) return null;
  const d = postingDate instanceof Date ? postingDate : new Date(postingDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function normalizeContentType(type) {
  const t = String(type || "").toLowerCase();
  if (t === "reel") return "reel";
  if (t === "post" || t === "static_post") return "post";
  if (t === "carousel") return "carousel";
  return "post";
}

/**
 * Calendar-day offsets before posting day (Post = 0). Tuned to mirror typical spacing
 * from simpleCalendar forward generation without capacity snapping.
 */
const BACKWARD_OFFSETS = {
  reel: [
    { stageName: "Plan", role: "strategist", daysBeforePost: 12 },
    { stageName: "Shoot", role: "videographer", daysBeforePost: 8 },
    { stageName: "Edit", role: "videoEditor", daysBeforePost: 4 },
    { stageName: "Approval", role: "manager", daysBeforePost: 1 },
    { stageName: "Post", role: "postingExecutive", daysBeforePost: 0 },
  ],
  post: [
    { stageName: "Plan", role: "strategist", daysBeforePost: 6 },
    { stageName: "Design", role: "graphicDesigner", daysBeforePost: 3 },
    { stageName: "Approval", role: "manager", daysBeforePost: 1 },
    { stageName: "Post", role: "postingExecutive", daysBeforePost: 0 },
  ],
};

/**
 * @param {Date|string} postingDate - Posting day (UTC date)
 * @param {string} contentType - reel | post | carousel | static_post
 * @returns {{ postingDate: string, contentType: string, stages: Array<{ stageName: string, role: string, date: string }> }}
 */
function generateWorkflowStagesFromPostingDate(postingDate, contentType) {
  const post = normalizePostingDate(postingDate);
  if (!post) {
    throw new Error("Invalid postingDate");
  }
  const ctype = normalizeContentType(contentType);
  const seq = ctype === "reel" ? BACKWARD_OFFSETS.reel : BACKWARD_OFFSETS.post;

  const stages = seq.map((row) => {
    const due = addDaysUTC(post, -row.daysBeforePost);
    return {
      stageName: row.stageName,
      role: row.role,
      date: toYMDUTC(due),
    };
  });

  return {
    postingDate: toYMDUTC(post),
    contentType: ctype,
    stages,
  };
}

module.exports = {
  generateWorkflowStagesFromPostingDate,
  BACKWARD_OFFSETS,
  toYMDUTC,
  addDaysUTC,
};
