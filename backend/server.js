require("dotenv").config();

const http = require("http");
const { Server } = require("socket.io");
const app = require("./src/app");
const connectDB = require("./src/config/db");
const { startCalendarRenewalCron } = require("./src/jobs/calendarRenewal");
const { startReminderCron } = require("./src/cron/reminder.cron");

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  const server = http.createServer(app);
  const rawOrigins = String(process.env.CLIENT_URL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const io = new Server(server, {
    cors: {
      origin: rawOrigins.length ? rawOrigins : true,
      credentials: true,
    },
  });

  global.io = io;
  io.on("connection", (socket) => {
    socket.on("join", (userId) => {
      if (!userId) return;
      socket.join(String(userId));
    });
  });

  startCalendarRenewalCron();
  startReminderCron();

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

startServer();
