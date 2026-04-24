const cron = require("node-cron");
const ContentItem = require("../models/ContentItem");
const Client = require("../models/Client");
const User = require("../models/User");
const ReminderEmailLog = require("../models/ReminderEmailLog");
const { sendNotification } = require("../services/notification.service");
const { sendEmail } = require("../services/email.service");
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

const buildReminderEmailHtml = ({ userName, title, message, shareUrl }) => {
  const safeName = String(userName || "there");
  const safeTitle = String(title || "Reminder");
  const safeMessage = String(message || "");
  const safeShare = String(shareUrl || "").trim();
  return `
    <div style="background:#f6f8fb;padding:24px;font-family:Arial,sans-serif;color:#111827;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 20px;background:#111827;color:#ffffff;font-size:16px;font-weight:600;">
          Rangreel Reminder
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
          <p style="margin:0;font-size:12px;color:#6b7280;">Please login to Rangreel and take action.</p>
        </div>
      </div>
    </div>
  `;
};

const startReminderCron = () => {
  // Daily at 9 AM server time.
  cron.schedule("0 9 * * *", async () => {
    try {
      const today = new Date();
      const dayStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
      const dayKey = dayStart.toISOString().slice(0, 10);

      const emailedToday = new Set();

      const overdueItems = await ContentItem.find({
        workflowStages: {
          $elemMatch: {
            dueDate: { $lt: dayStart },
            status: { $nin: ["completed", "approved", "posted"] },
          },
        },
      })
        .select("title displayId taskType taskNumber contentType type client clientPostingDate workflowStages")
        .populate("client", "brandName clientName")
        .populate("workflowStages.assignedUser", "email name")
        .lean();

      for (const item of overdueItems || []) {
        const client = await Client.findById(item.client).select("manager team").lean();
        if (!client) continue;

        const overdueStages = (item.workflowStages || []).filter((stage) => {
          if (!stage?.dueDate) return false;
          const due = new Date(stage.dueDate);
          const status = String(stage.status || "").toLowerCase();
          return due < dayStart && !["completed", "approved", "posted"].includes(status);
        });

        for (const stage of overdueStages) {
          const assigneeId = stage?.assignedUser?._id ? String(stage.assignedUser._id) : "";
          const managerId = client?.manager ? String(client.manager) : "";
          const strategistIds = [
            client?.team?.reels?.strategist,
            client?.team?.posts?.strategist,
            client?.team?.carousel?.strategist,
          ]
            .filter(Boolean)
            .map((id) => String(id));
          const recipients = [...new Set([assigneeId, managerId, ...strategistIds].filter(Boolean))];
          const title = "Task Overdue";
          const taskLabel = resolveDisplayIdForRead(item);
          const message = taskLabel
            ? `${taskLabel} is overdue`
            : `${item.title} is overdue`;

          for (const userId of recipients) {
            await sendNotification({ userId, title, message, type: "reminder" });
          }

          for (const userId of recipients) {
            const emailKey = `${String(item._id)}::${String(stage._id)}::${String(userId)}::${dayStart.toISOString().slice(0, 10)}`;
            if (emailedToday.has(emailKey)) continue;
            const alreadySentToday = await ReminderEmailLog.exists({
              contentItem: item._id,
              stageId: String(stage._id),
              user: userId,
              dayKey,
            });
            if (alreadySentToday) continue;
            emailedToday.add(emailKey);
            const user = await User.findById(userId).select("email name").lean();
            if (!user?.email) {
              console.info(
                `[reminder-cron] email skipped (no email) userId=${String(userId)} contentId=${String(
                  item._id
                )} stageId=${String(stage._id)}`
              );
              continue;
            }
            const shareUrl = `${resolveAppBaseUrl()}/shared/content/${String(item._id)}`;
            try {
              await sendEmail({
                to: { email: user.email, name: user.name || "" },
                subject: title,
                html: buildReminderEmailHtml({
                  userName: user.name || "",
                  title,
                  message,
                  shareUrl,
                }),
              });
              console.info(
                `[reminder-cron] email success to=${user.email} userId=${String(
                  userId
                )} contentId=${String(item._id)} stageId=${String(stage._id)}`
              );
            } catch (emailErr) {
              console.warn(
                `[reminder-cron] email failed to=${user.email} userId=${String(
                  userId
                )} contentId=${String(item._id)} stageId=${String(stage._id)}:`,
                emailErr?.message || emailErr
              );
              continue;
            }
            await ReminderEmailLog.create({
              contentItem: item._id,
              stageId: String(stage._id),
              user: userId,
              dayKey,
            });
          }
        }
      }
    } catch (err) {
      console.error("[cron] reminder failed:", err?.message || err);
    }
  });
};

module.exports = { startReminderCron };
