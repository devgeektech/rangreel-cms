const ContentItem = require("../models/ContentItem");
const User = require("../models/User");
const Role = require("../models/Role");
const { sendEmail } = require("./email.service");
const { resolveDisplayIdForRead } = require("../utils/taskDisplayId.util");

const TERMINAL_STAGE_STATUSES = new Set(["completed", "approved", "posted"]);

const resolveAppBaseUrl = () => {
  const raw =
    process.env.APP_URL ||
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    "http://localhost:5001";
  const first = String(raw)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)[0];
  return first.replace(/\/+$/, "");
};

function utcDayBounds(referenceDate = new Date()) {
  const d = referenceDate instanceof Date ? referenceDate : new Date(referenceDate);
  const dayStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  return { dayStart, dayEnd, dayKey: dayStart.toISOString().slice(0, 10) };
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ymdUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function isStageDueTodayAndOpen(stage, dayStart, dayEnd) {
  if (!stage?.dueDate) return false;
  const due = new Date(stage.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  if (due.getTime() < dayStart.getTime() || due.getTime() >= dayEnd.getTime()) return false;
  const status = String(stage.status || "").toLowerCase();
  return !TERMINAL_STAGE_STATUSES.has(status);
}

/**
 * Incomplete workflow stages whose due date falls on the current UTC calendar day only
 * ([dayStart, dayEnd)). Older overdue stages are excluded. One row per stage.
 */
async function collectDueStageRows(dayStart, dayEnd) {
  const items = await ContentItem.find({
    type: { $in: ["reel", "post", "carousel"] },
    workflowStages: {
      $elemMatch: {
        dueDate: { $gte: dayStart, $lt: dayEnd },
        status: { $nin: ["completed", "approved", "posted"] },
      },
    },
  })
    .select(
      "title displayId taskType taskNumber contentType type client clientPostingDate strategistAlias workflowStages"
    )
    .populate("client", "brandName clientName")
    .populate("workflowStages.assignedUser", "email name")
    .lean();

  const rows = [];
  for (const item of items || []) {
    const stages = Array.isArray(item.workflowStages) ? item.workflowStages : [];
    for (const stage of stages) {
      if (!isStageDueTodayAndOpen(stage, dayStart, dayEnd)) continue;
      const displayLabel = resolveDisplayIdForRead(item) || String(item.title || "").trim() || "—";
      const clientLabel =
        String(item.client?.brandName || item.client?.clientName || "").trim() || "—";
      const assignee =
        stage.assignedUser && typeof stage.assignedUser === "object"
          ? String(stage.assignedUser.name || "").trim() ||
            String(stage.assignedUser.email || "").trim() ||
            "—"
          : "—";
      const shareUrl = `${resolveAppBaseUrl()}/shared/content/${String(item._id)}`;
      rows.push({
        contentItemId: String(item._id),
        displayLabel,
        title: String(item.title || "").trim() || "—",
        clientLabel,
        stageName: String(stage.stageName || "").trim() || "—",
        role: String(stage.role || "").trim() || "—",
        dueYmd: ymdUtc(stage.dueDate),
        assignee,
        status: String(stage.status || "").trim() || "—",
        shareUrl,
      });
    }
  }

  rows.sort((a, b) => {
    const da = a.dueYmd || "";
    const db = b.dueYmd || "";
    if (da !== db) return da.localeCompare(db);
    if (a.clientLabel !== b.clientLabel) return a.clientLabel.localeCompare(b.clientLabel);
    return a.displayLabel.localeCompare(b.displayLabel);
  });
  return rows;
}

function buildDigestEmailHtml({ rows, dayKey }) {
  const baseUrl = resolveAppBaseUrl();
  if (!rows.length) {
    return `
    <div style="background:#f6f8fb;padding:24px;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
        <h1 style="margin:0 0 8px 0;font-size:18px;">Rangreel — Daily task digest</h1>
        <p style="margin:0;font-size:14px;color:#374151;">Report date (UTC): <strong>${escapeHtml(dayKey)}</strong></p>
        <p style="margin:16px 0 0 0;font-size:14px;color:#374151;">No incomplete stages with a due date of today (UTC).</p>
      </div>
    </div>`;
  }

  const tableRows = rows
    .map(
      (r) => `<tr>
        <td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;vertical-align:top;">${escapeHtml(r.clientLabel)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;vertical-align:top;">${escapeHtml(r.displayLabel)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;vertical-align:top;">${escapeHtml(r.stageName)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;vertical-align:top;">${escapeHtml(r.role)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;vertical-align:top;">${escapeHtml(r.assignee)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;vertical-align:top;">${escapeHtml(r.dueYmd)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;vertical-align:top;">${escapeHtml(r.status)}</td>
        <td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;vertical-align:top;"><a href="${escapeHtml(r.shareUrl)}">Open</a></td>
      </tr>`
    )
    .join("");

  return `
    <div style="background:#f6f8fb;padding:24px;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:960px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;">
        <h1 style="margin:0 0 8px 0;font-size:18px;">Rangreel — Daily task digest</h1>
        <p style="margin:0 0 4px 0;font-size:14px;color:#374151;">Report date (UTC): <strong>${escapeHtml(dayKey)}</strong></p>
        <p style="margin:0 0 16px 0;font-size:13px;color:#6b7280;">Incomplete stages (any role) with due date on this UTC calendar day only (not older overdue). App base: ${escapeHtml(baseUrl)}</p>
        <p style="margin:0 0 12px 0;font-size:14px;color:#111827;"><strong>${rows.length}</strong> stage row(s)</p>
        <div style="overflow-x:auto;">
          <table style="border-collapse:collapse;width:100%;min-width:720px;">
            <thead>
              <tr style="background:#f3f4f6;">
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Client</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Task ID</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Stage</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Role</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Assignee</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Due (UTC)</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Status</th>
                <th style="padding:8px;border:1px solid #e5e7eb;text-align:left;font-size:12px;">Link</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
}

async function resolveDigestRecipients() {
  const roles = await Role.find({ slug: { $in: ["manager", "strategist"] }, isActive: { $ne: false } })
    .select("_id slug")
    .lean();
  const roleIds = (roles || []).map((r) => r._id).filter(Boolean);
  if (!roleIds.length) return [];

  const users = await User.find({
    role: { $in: roleIds },
    isActive: true,
    email: { $exists: true, $nin: [null, ""] },
  })
    .select("email name")
    .lean();

  const seen = new Set();
  const out = [];
  for (const u of users || []) {
    const email = String(u.email || "")
      .trim()
      .toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: String(u.name || "").trim() || undefined });
  }
  return out;
}

/**
 * Sends one email to all active managers and strategists listing incomplete stages
 * whose due date is the current UTC calendar day only (excludes prior overdue days).
 */
async function runDailyTaskDigest() {
  const { dayStart, dayEnd, dayKey } = utcDayBounds();
  const rows = await collectDueStageRows(dayStart, dayEnd);
  const sendWhenEmpty =
    String(process.env.DAILY_TASK_DIGEST_SEND_WHEN_EMPTY || "").toLowerCase() === "true";

  if (!rows.length && !sendWhenEmpty) {
    console.info(`[daily-task-digest] no rows for UTC ${dayKey}; skip email (set DAILY_TASK_DIGEST_SEND_WHEN_EMPTY=true to send empty digest)`);
    return { sent: false, rowCount: 0, reason: "no_rows" };
  }

  const recipients = await resolveDigestRecipients();
  if (!recipients.length) {
    console.warn("[daily-task-digest] no recipients (no active manager/strategist users with email)");
    return { sent: false, rowCount: rows.length, reason: "no_recipients" };
  }

  const subject =
    rows.length === 0
      ? `Rangreel digest (UTC ${dayKey}): no stages due today`
      : `Rangreel digest (UTC ${dayKey}): ${rows.length} incomplete stage(s) due today`;

  const html = buildDigestEmailHtml({ rows, dayKey });

  await sendEmail({
    to: recipients,
    subject,
    html,
  });

  console.info(
    `[daily-task-digest] sent to ${recipients.length} recipient(s); rows=${rows.length} UTC_day=${dayKey}`
  );
  return { sent: true, rowCount: rows.length, recipientCount: recipients.length };
}

module.exports = {
  runDailyTaskDigest,
  collectDueStageRows,
  buildDigestEmailHtml,
  utcDayBounds,
};
