"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.R2_PUBLIC_URL = exports.R2_BUCKET_NAME = exports.r2Client = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
if (!process.env.R2_ACCOUNT_ID ||
    !process.env.R2_ACCESS_KEY_ID ||
    !process.env.R2_SECRET_ACCESS_KEY ||
    !process.env.R2_BUCKET_NAME) {
    console.warn("R2 credentials or bucket name are missing in the .env file.");
}
const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const bucketName = process.env.R2_BUCKET_NAME || "artiory";
const publicUrl = (process.env.R2_PUBLIC_URL || `${endpoint}/${bucketName}`).replace(/\/+$/, "");
exports.r2Client = new client_s3_1.S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
});
exports.R2_BUCKET_NAME = bucketName;
exports.R2_PUBLIC_URL = publicUrl;
