const cron = require("node-cron");
const ContentItem = require("../models/ContentItem");
const Client = require("../models/Client");
const User = require("../models/User");
const ReminderEmailLog = require("../models/ReminderEmailLog");
const { sendNotification } = require("../services/notification.service");
const { sendEmail } = require("../services/email.service");

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
        .select("title client workflowStages")
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
          const message = `${item.title} is overdue`;

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
            if (!user?.email) continue;
            await sendEmail({
              to: { email: user.email, name: user.name || "" },
              subject: title,
              html: `<p>${message}</p>`,
            });
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
