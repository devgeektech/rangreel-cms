const User = require("../models/User");
const { sendNotification } = require("./notification.service");
const { sendEmail } = require("./email.service");

const notifyUsers = async ({ userIds = [], title, message, type }) => {
  const uniqueIds = [...new Set((userIds || []).filter(Boolean).map((id) => String(id)))];
  if (!uniqueIds.length) return;

  const users = await User.find({ _id: { $in: uniqueIds }, isActive: { $ne: false } })
    .select("_id email name")
    .lean();

  for (const user of users) {
    const userId = String(user._id);
    await sendNotification({ userId, title, message, type });
    if (user.email) {
      try {
        await sendEmail({
          to: { email: user.email, name: user.name || "" },
          subject: title,
          html: `<p>${message}</p>`,
        });
      } catch (err) {
        // Email failures must not block workflow actions.
        console.warn("[notifyUsers] email send failed:", err?.message || err);
      }
    }
  }
};

module.exports = { notifyUsers };
