const Notification = require("../models/Notification");

const sendNotification = async ({ userId, title, message, type }) => {
  if (!userId || !title || !message || !type) return null;

  const notification = await Notification.create({
    user: userId,
    title,
    message,
    type,
  });

  try {
    if (global.io) {
      global.io.to(String(userId)).emit("notification", {
        title,
        message,
        type,
      });
    }
  } catch (err) {
    console.error("[notification] socket emit failed:", err?.message || err);
  }

  return notification;
};

module.exports = {
  sendNotification,
};
