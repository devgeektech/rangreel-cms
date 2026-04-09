# Client asset uploads (Multer + optional S3)

This folder documents how to wire **Multer** for client onboarding assets (brand kit, social credentials exports, etc.).

Right now the app uses **local disk** storage for video uploads (`backend/src/routes/upload.routes.js`).  
When you are ready for **AWS S3**, uncomment and adapt the sample below (install `@aws-sdk/client-s3`, `multer-s3`, configure env vars, and replace the disk storage).

## Environment variables (S3)

```bash
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=
# S3_BUCKET_CLIENT_ASSETS=
```

## Example: Multer + S3 (commented — enable when bucket is ready)

```javascript
// const multer = require("multer");
// const multerS3 = require("multer-s3");
// const { S3Client } = require("@aws-sdk/client-s3");
// const path = require("path");

// const s3 = new S3Client({
//   region: process.env.AWS_REGION || "us-east-1",
//   // credentials: optional if using IAM role on EC2/ECS
// });

// const clientAssetsUpload = multer({
//   storage: multerS3({
//     s3,
//     bucket: process.env.S3_BUCKET_CLIENT_ASSETS,
//     contentType: multerS3.AUTO_CONTENT_TYPE,
//     key(req, file, cb) {
//       const clientId = req.params.clientId || "unscoped";
//       const safe = `${Date.now()}-${path.basename(file.originalname)}`.replace(/\s+/g, "-");
//       cb(null, `clients/${clientId}/onboarding/${safe}`);
//     },
//   }),
//   limits: { fileSize: 50 * 1024 * 1024 }, // 50MB example
// });

// module.exports = { clientAssetsUpload };
```

## Current flow (local disk)

1. **Create client** (JSON) as today.
2. **Upload onboarding files**: `POST /api/manager/clients/:id/brief-assets` with multipart fields `brandKit`, `socialCredentials`, and `other` (multiple files each, max 50MB per file). Files are stored under `backend/uploads/clients/<id>/brief/...` and metadata is appended to `clientBrief.brandKitFiles`, `socialCredentialsFiles`, `otherBriefFiles`.
3. **Download** (manager-only, cookie auth): `GET /api/manager/clients/:id/brief-assets/:fileId/download` where `fileId` is the Mongoose subdocument `_id` of the file entry.

Wireup lives in `clientBriefUpload.js`. **`temp/`** remains for large reel video uploads (`upload.routes.js`).

## Legacy Drive URLs

Older clients may still have `clientBrief.driveBrandKitUrl` (and related) URL strings; new onboarding uses file uploads instead.
