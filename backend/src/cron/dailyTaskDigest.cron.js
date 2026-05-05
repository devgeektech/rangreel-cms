const cron = require("node-cron");
const { runDailyTaskDigest } = require("../services/dailyTaskDigest.service");

/**
 * Once per day: one email to all active managers + strategists listing incomplete
 * workflow stages (any role) whose due date is the current UTC calendar day only
 * (older overdue stages are not included).
 *
 * Env:
 * - DAILY_TASK_DIGEST_ENABLED — set to "false" to disable (default: on)
 * - DAILY_TASK_DIGEST_CRON — cron pattern (default: "0 7 * * *" = 07:00 server local time)
 * - DAILY_TASK_DIGEST_SEND_WHEN_EMPTY — "true" to email even when there are zero rows
 */
const startDailyTaskDigestCron = () => {
  const disabled = String(process.env.DAILY_TASK_DIGEST_ENABLED || "")
    .trim()
    .toLowerCase();
  if (disabled === "false" || disabled === "0" || disabled === "off" || disabled === "no") {
    console.info("[daily-digest-cron] disabled (DAILY_TASK_DIGEST_ENABLED)");
    return;
  }

  const schedule = String(process.env.DAILY_TASK_DIGEST_CRON || "0 7 * * *").trim();
  cron.schedule(schedule, async () => {
    try {
      await runDailyTaskDigest();
    } catch (err) {
      console.error("[daily-digest-cron] failed:", err?.message || err);
    }
  });
  console.info(`[daily-digest-cron] scheduled pattern="${schedule}"`);
};

module.exports = { startDailyTaskDigestCron };
