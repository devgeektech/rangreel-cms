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

/**
 * Origins for browser requests. CLIENT_URL is comma-separated and merged with built-ins so
 * the Next app on http://localhost:5001 is always allowed (including when NODE_ENV=production).
 */
function parseCorsOrigins() {
  const raw = process.env.CLIENT_URL || "";
  const fromEnv = raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const alwaysAllow = [
    "http://localhost:5001",
    "http://127.0.0.1:5001",
    "http://localhost:3000",
    "http://122.180.29.167:5001",
  ];
  return [...new Set([...alwaysAllow, ...fromEnv])];
}

const allowedOrigins = parseCorsOrigins();

const corsOptions = {
  origin(origin, callback) {
    // Non-browser clients (curl, server-to-server) send no Origin
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Dev: allow any localhost / 127.0.0.1 origin (different Next port, etc.)
    if (process.env.NODE_ENV !== "production") {
      try {
        const { hostname } = new URL(origin);
        if (hostname === "localhost" || hostname === "127.0.0.1") {
          return callback(null, true);
        }
      } catch {
        /* ignore */
      }
    }
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
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
