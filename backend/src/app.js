const express = require("express");
const path = require("path");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const morgan = require("morgan");
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const adminRoutes = require("./routes/admin.routes");
const packageRoutes = require("./routes/package.routes");
const holidayRoutes = require("./routes/holiday.routes");
const holidayReadRoutes = require("./routes/holidayRead.routes");
const clientRoutes = require("./routes/client.routes");
const contentRoutes = require("./routes/content.routes");
const contentReadRoutes = require("./routes/contentRead.routes");
const uploadRoutes = require("./routes/upload.routes");
const managerReadRoutes = require("./routes/managerRead.routes");
const internalCalendarRoutes = require("./routes/internalCalendar.routes");
const calendarRoutes = require("./routes/calendar.routes");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(morgan("dev"));
app.use(express.json());
app.use(cookieParser());

// Local temp uploads (Prompt 27). Later can be replaced by S3/Cloudinary.
app.use("/temp", express.static(path.join(__dirname, "..", "temp")));

app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRoutes);
app.use("/api/user", userRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/packages", packageRoutes);
app.use("/api/admin/holidays", holidayRoutes);
app.use("/api/holiday", holidayReadRoutes);
app.use("/api/manager/clients", clientRoutes);
app.use("/api/manager/content", contentRoutes);
app.use("/api/content-items", contentRoutes);
app.use("/api/content", contentReadRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/manager", managerReadRoutes);
app.use("/api/internal-calendar", internalCalendarRoutes);
app.use("/api/calendar", calendarRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

app.use((err, req, res, next) => {
  if (err?.name === "MulterError") {
    const msg =
      err.code === "LIMIT_FILE_SIZE" ? "File exceeds size limit (max 50MB per file)" : err.message;
    return res.status(400).json({ success: false, error: msg });
  }
  console.error(err.stack);
  res.status(500).json({ success: false, error: err.message });
});

module.exports = app;
