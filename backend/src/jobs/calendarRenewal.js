const cron = require("node-cron");

const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");
const { generateNextMonth } = require("../services/calendarService");

const pad2 = (n) => String(n).padStart(2, "0");

const computeNextMonthString = (latestMonth, startDate) => {
  if (latestMonth) {
    const [y, m] = String(latestMonth).split("-");
    const year = Number(y);
    const monthIndex = Number(m) - 1; // 0-11
    const next = new Date(Date.UTC(year, monthIndex + 1, 1));
    return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}`;
  }

  const d = startDate || new Date();
  const year = d.getUTCFullYear();
  const monthIndex = d.getUTCMonth(); // 0-11
  const next = new Date(Date.UTC(year, monthIndex + 1, 1));
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}`;
};

const startCalendarRenewalCron = () => {
  cron.schedule("0 0 1 * *", async () => {
    try {
      const activeClients = await Client.find({ isActive: true }).select("_id startDate");

      for (const client of activeClients) {
        const latest = await ContentItem.findOne({ client: client._id }).sort({ month: -1 }).select("month");
        const nextMonth = computeNextMonthString(latest?.month, client.startDate);

        const exists = await ContentItem.exists({ client: client._id, month: nextMonth });
        if (!exists) {
          await generateNextMonth(client);
        }
      }
    } catch (error) {
      console.error("calendarRenewal cron failed:", error.message);
    }
  });
};

module.exports = {
  startCalendarRenewalCron,
};

