const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");

/**
 * Local disk uploads for client onboarding assets (brand kit, credentials, etc.).
 * S3 variant: see README.md in this folder (commented example).
 */
const uploadsRoot = path.join(__dirname, "..", "..", "uploads");

const BRIEF_UPLOAD_FIELDS = [
  { field: "brandKit", arrayKey: "brandKitFiles", slug: "brand-kit" },
  {
    field: "socialCredentials",
    arrayKey: "socialCredentialsFiles",
    slug: "social-credentials",
  },
  { field: "other", arrayKey: "otherBriefFiles", slug: "other" },
];

const fieldToMeta = Object.fromEntries(BRIEF_UPLOAD_FIELDS.map((m) => [m.field, m]));

function clientBriefDestination(req, file, cb) {
  const clientId = req.params.id;
  if (!clientId || !/^[a-fA-F0-9]{24}$/.test(String(clientId))) {
    return cb(new Error("Invalid client id"));
  }
  const meta = fieldToMeta[file.fieldname];
  if (!meta) {
    return cb(new Error("Unexpected upload field"));
  }
  const dir = path.join(uploadsRoot, "clients", String(clientId), "brief", meta.slug);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return cb(e);
  }
  cb(null, dir);
}

function clientBriefFilename(req, file, cb) {
  const ext = path.extname(file.originalname || "");
  const safeExt = ext && ext.length <= 15 ? ext.toLowerCase() : "";
  const unique = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  cb(null, `${unique}${safeExt}`);
}

const storage = multer.diskStorage({
  destination: clientBriefDestination,
  filename: clientBriefFilename,
});

const briefAssetsUpload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

const uploadBriefFields = briefAssetsUpload.fields(
  BRIEF_UPLOAD_FIELDS.map(({ field }) => ({ name: field, maxCount: 15 }))
);

module.exports = {
  uploadsRoot,
  BRIEF_UPLOAD_FIELDS,
  uploadBriefFields,
};
