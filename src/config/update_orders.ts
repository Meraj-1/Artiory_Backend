import mongoose from "mongoose";
import dotenv from "dotenv";
import Order from "../models/Order_model";
import User from "../models/User_model";

dotenv.config();

const updateOrders = async () => {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is not defined");
    }
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to DB, registered models:", mongoose.modelNames());

    // Force evaluation of User model to register schema
    console.log("Evaluated User model:", User.modelName);

    const https = require("https");
    const crypto = require("crypto");

    const getByteBuf = (str: string, length: number): any => {
      const buf = Buffer.alloc(length, 0);
      const src = Buffer.from(str, "utf8");
      src.copy(buf, 0, 0, Math.min(src.length, length));
      return buf;
    };

    const encrypt = (plainText: string, key: string, iv: string): string => {
      const cipher = crypto.createCipheriv("aes-128-cbc", getByteBuf(key, 16), getByteBuf(iv, 16));
      let encrypted = cipher.update(plainText, "utf8", "hex");
      encrypted += cipher.final("hex");
      return encrypted;
    };

    const decrypt = (encryptedText: string, key: string, iv: string): string => {
      const decipher = crypto.createDecipheriv("aes-128-cbc", getByteBuf(key, 16), getByteBuf(iv, 16));
      let decrypted = decipher.update(encryptedText, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    };

    // Reset all orders to Pending
    await Order.updateMany(
      {},
      { $set: { status: "Pending" } }
    );
    console.log("Reset all orders to Pending.");

    // Fetch and list all orders in the database
    const allOrders = await Order.find().sort({ createdAt: -1 });
    console.log("All Database Orders:");
    allOrders.forEach((o) => {
      console.log({
        id: o._id.toString(),
        totalPrice: o.totalPrice,
        status: o.status,
        clientTxnId: o.clientTxnId || null,
        createdAt: o.createdAt
      });
    });
    process.exit(0);

    const testEnquiry = async (host: string) => {
      return new Promise((resolve) => {
        try {
          const clientTxnId = "6a884a70896d0d3ebf61e722-849999";
          const clientCode = process.env.SABPAISA_CLIENT_CODE || "";
          const key = process.env.SABPAISA_AUTH_KEY || "";
          const iv = process.env.SABPAISA_AUTH_IV || "";

          const plainTextQuery = `clientCode=${clientCode}&clientTxnId=${clientTxnId}`;
          const encryptedData = encrypt(plainTextQuery, key, iv);

          const postData = JSON.stringify({
            clientCode: clientCode,
            statusTransEncData: encryptedData,
          });

          const options = {
            hostname: host,
            port: 443,
            path: "/SPTxtnEnquiry/getTxnStatusByClientxnId",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData),
            },
          };

          const req = https.request(options, (res: any) => {
            let body = "";
            res.on("data", (chunk: string) => (body += chunk));
            res.on("end", () => {
              try {
                const json = JSON.parse(body);
                if (json && json.statusResponseData) {
                  const decryptedRes = decrypt(json.statusResponseData, key, iv);
                  resolve({ host, success: true, response: decryptedRes });
                } else {
                  resolve({ host, success: false, raw: body });
                }
              } catch (e: any) {
                resolve({ host, success: false, raw: body, error: e.message });
              }
            });
          });

          req.on("error", (err: any) => resolve({ host, success: false, error: err.message }));
          req.write(postData);
          req.end();
        } catch (err: any) {
          resolve({ host, success: false, error: err.message });
        }
      });
    };

    console.log("Querying Staging Enquiry API...");
    const stageRes = await testEnquiry("stage-txnenquiry.sabpaisa.in");
    console.log("Staging Result:", stageRes);

    console.log("Querying Production Enquiry API...");
    const prodRes = await testEnquiry("txnenquiry.sabpaisa.in");
    console.log("Production Result:", prodRes);

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

updateOrders();
