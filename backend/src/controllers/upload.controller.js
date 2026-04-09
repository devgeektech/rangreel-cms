const path = require("path");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const uploadVideo = async (req, res) => {
  try {
    if (!req.file) {
      return failure(res, "file is required", 400);
    }

    // Served by app.js static mount: /temp -> backend/temp
    const publicUrl = `/temp/videos/${req.file.filename}`;

    // --- S3 scaffold (commented for now) ---
    // const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
    // const fs = require("fs");
    //
    // const s3 = new S3Client({
    //   region: process.env.AWS_REGION,
    //   credentials: {
    //     accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    //     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    //   },
    // });
    //
    // const bucket = process.env.AWS_S3_BUCKET;
    // const key = `rangreel/videos/${req.file.filename}`;
    // await s3.send(
    //   new PutObjectCommand({
    //     Bucket: bucket,
    //     Key: key,
    //     Body: fs.createReadStream(req.file.path),
    //     ContentType: req.file.mimetype,
    //   })
    // );
    // const publicUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;

    return success(res, {
      videoUrl: publicUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
  } catch (err) {
    return failure(res, err.message || "Upload failed", 500);
  }
};

module.exports = {
  uploadVideo,
};

