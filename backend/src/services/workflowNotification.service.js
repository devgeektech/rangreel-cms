const User = require("../models/User");
const ContentItem = require("../models/ContentItem");
const { sendNotification } = require("./notification.service");
const { sendEmail } = require("./email.service");
const { resolveDisplayIdForRead } = require("../utils/taskDisplayId.util");

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

const buildNotificationEmailHtml = ({ userName, title, message, shareUrl }) => {
  const safeName = String(userName || "there");
  const safeTitle = String(title || "Notification");
  const safeMessage = String(message || "");
  const safeShare = String(shareUrl || "").trim();
  return `
    <div style="background:#f6f8fb;padding:24px;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 20px;background:#111827;color:#ffffff;font-size:16px;font-weight:600;">
          Rangreel Notification
        </div>
        <div style="padding:20px;">
          <p style="margin:0 0 12px 0;font-size:14px;color:#374151;">Hi ${safeName},</p>
          <h2 style="margin:0 0 12px 0;font-size:18px;color:#111827;">${safeTitle}</h2>
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#374151;">${safeMessage}</p>
          ${
            safeShare
              ? `<div style="margin:0 0 16px 0;">
                  <a href="${safeShare}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 14px;border-radius:8px;font-size:13px;font-weight:600;">
                    Open Task Details
                  </a>
                  <p style="margin:8px 0 0 0;font-size:12px;color:#6b7280;word-break:break-all;">${safeShare}</p>
                </div>`
              : ""
          }
          <p style="margin:0;font-size:12px;color:#6b7280;">Please login to Rangreel for details.</p>
        </div>
      </div>
    </div>
  `;
};

const notifyUsers = async ({ userIds = [], title, message, type, contentId }) => {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map((id) => String(id)))];
  if (!uniqueIds.length) return;
  const shareUrl =
    contentId && String(contentId).trim()
      ? `${resolveAppBaseUrl()}/shared/content/${String(contentId).trim()}`
      : "";
  let taskLabel = "";
  if (contentId) {
    const item = await ContentItem.findById(contentId)
      .select("displayId taskType taskNumber contentType type clientPostingDate workflowStages")
      .populate("client", "brandName clientName")
      .lean()
      .catch(() => null);
    taskLabel = resolveDisplayIdForRead(item);
  }
  const messageWithId = taskLabel
    ? `${String(message || "")} (${taskLabel})`
    : String(message || "");

  const users = await User.find({ _id: { $in: uniqueIds }, isActive: { $ne: false } })
    .select("_id email name")
    .lean();

  for (const user of users) {
    const userId = String(user._id);
    await sendNotification({ userId, title, message: messageWithId, type });
    if (user.email) {
      try {
        await sendEmail({
          to: { email: user.email, name: user.name || "" },
          subject: title,
          html: buildNotificationEmailHtml({
            userName: user.name || "",
            title,
            message: messageWithId,
            shareUrl,
          }),
        });
      } catch (err) {
        // Email failures must not block workflow actions.
        console.warn("[notifyUsers] email send failed:", err?.message || err);
      }
    }
  }
};

module.exports = { notifyUsers };
