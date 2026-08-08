import { S3Client } from "@aws-sdk/client-s3";

if (
  !process.env.R2_ACCOUNT_ID ||
  !process.env.R2_ACCESS_KEY_ID ||
  !process.env.R2_SECRET_ACCESS_KEY ||
  !process.env.R2_BUCKET_NAME
) {
  console.warn("R2 credentials or bucket name are missing in the .env file.");
}

const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const bucketName = process.env.R2_BUCKET_NAME || "artiory";
const publicUrl = (process.env.R2_PUBLIC_URL || `${endpoint}/${bucketName}`).replace(/\/+$/, "");

export const r2Client = new S3Client({
  region: "auto",
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

export const R2_BUCKET_NAME = bucketName;
export const R2_PUBLIC_URL = publicUrl;
