import { Request, Response } from "express";
import crypto from "crypto";
import Order from "../models/Order_model";

// SabPaisa Credentials and Configurations
const SABPAISA_CLIENT_CODE = process.env.SABPAISA_CLIENT_CODE || "YOUR_CLIENT_CODE";
const SABPAISA_TRANS_USER_NAME = process.env.SABPAISA_TRANS_USER_NAME || "YOUR_USERNAME";
const SABPAISA_TRANS_USER_PASSWORD = process.env.SABPAISA_TRANS_USER_PASSWORD || "YOUR_PASSWORD";
const SABPAISA_AUTH_KEY = process.env.SABPAISA_AUTH_KEY || "YOUR_16_BYTE_KEY"; // Must be exactly 16 bytes
const SABPAISA_AUTH_IV = process.env.SABPAISA_AUTH_IV || "YOUR_16_BYTE_IV";   // Must be exactly 16 bytes
const SABPAISA_INIT_URL = process.env.SABPAISA_INIT_URL || "https://stage-securepay.sabpaisa.in/SabPaisa/sabPaisaInit?v=1";
const SABPAISA_CALLBACK_URL = process.env.SABPAISA_CALLBACK_URL || "https://api.artiory.com/api/payment/sabpaisa/callback";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://staging.artiory.com";

/**
 * Helper to ensure a buffer is exactly 16 bytes by padding or slicing
 */
const get16ByteBuf = (str: string): Buffer => {
  const buf = Buffer.alloc(16, 0);
  const src = Buffer.from(str, "utf8");
  src.copy(buf, 0, 0, Math.min(src.length, 16));
  return buf;
};

/**
 * Encrypts a string using AES-128-CBC
 */
const encrypt = (plainText: string, key: string, iv: string): string => {
  const cipher = crypto.createCipheriv("aes-128-cbc", get16ByteBuf(key), get16ByteBuf(iv));
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};

/**
 * Decrypts a string using AES-128-CBC
 */
const decrypt = (encryptedText: string, key: string, iv: string): string => {
  const decipher = crypto.createDecipheriv("aes-128-cbc", get16ByteBuf(key), get16ByteBuf(iv));
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

/**
 * POST /api/payment/sabpaisa/initiate
 * Initializes a SabPaisa payment checkout session
 */
export const initiateSabPaisaPayment = async (req: Request, res: Response): Promise<any> => {
  try {
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({ success: false, message: "Order ID is required" });
    }

    const order = await Order.findById(orderId).populate("user");
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const user = order.user as any;
    const payerName = (user?.name || "Valued Customer").replace(/[^a-zA-Z ]/g, "").trim();
    const payerEmail = user?.email || "customer@artiory.com";
    const payerMobile = user?.number || "9999999999";

    // Generate unique transaction ID to prevent "Duplicate ID" gateway errors
    const clientTxnId = `${order._id}-${Date.now().toString().slice(-6)}`;

    // Build standard SabPaisa query string parameters list
    const queryString = `payerName=${encodeURIComponent(payerName)}` +
      `&payerEmail=${encodeURIComponent(payerEmail)}` +
      `&payerMobile=${encodeURIComponent(payerMobile)}` +
      `&clientTxnId=${encodeURIComponent(clientTxnId)}` +
      `&amount=${order.totalPrice.toFixed(2)}` +
      `&clientCode=${encodeURIComponent(SABPAISA_CLIENT_CODE)}` +
      `&transUserName=${encodeURIComponent(SABPAISA_TRANS_USER_NAME)}` +
      `&transUserPassword=${encodeURIComponent(SABPAISA_TRANS_USER_PASSWORD)}` +
      `&callbackUrl=${encodeURIComponent(SABPAISA_CALLBACK_URL)}` +
      `&channelId=W`;

    console.log("SabPaisa Query String:", queryString);

    let encData = "";
    try {
      encData = encrypt(queryString, SABPAISA_AUTH_KEY, SABPAISA_AUTH_IV);
    } catch (encErr: any) {
      console.error("SabPaisa Encryption Error:", encErr);
      return res.status(500).json({ success: false, message: "Failed to encrypt payment data" });
    }

    return res.status(200).json({
      success: true,
      encData,
      clientCode: SABPAISA_CLIENT_CODE,
      sabpaisaUrl: SABPAISA_INIT_URL
    });
  } catch (err: any) {
    console.error("Initiate Payment Error:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

/**
 * POST /api/payment/sabpaisa/callback
 * SabPaisa calls this endpoint to post status updates and redirect the client
 */
export const sabPaisaCallback = async (req: Request, res: Response): Promise<any> => {
  try {
    const { encResponse } = req.body;

    if (!encResponse) {
      console.error("SabPaisa Callback: Missing encResponse in request body");
      return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=MissingResponse`);
    }

    let decryptedText = "";
    try {
      decryptedText = decrypt(encResponse, SABPAISA_AUTH_KEY, SABPAISA_AUTH_IV);
    } catch (decErr: any) {
      console.error("SabPaisa Decryption Error:", decErr);
      return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=DecryptionFailed`);
    }

    console.log("SabPaisa Decrypted Response:", decryptedText);

    // Parse the query string params
    const params = new URLSearchParams(decryptedText);
    const clientTxnId = params.get("clientTxnId");
    const sabpaisaTxnId = params.get("sabpaisaTxnId") || params.get("spTxnId") || "N/A";
    const statusCode = params.get("statusCode") || params.get("status") || "FAILED";
    const amount = params.get("amount") || "0.00";

    if (!clientTxnId) {
      console.error("SabPaisa Callback: Missing clientTxnId");
      return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=MissingTxnId`);
    }

    // Extract Order ID (first segment of clientTxnId)
    const orderId = clientTxnId.split("-")[0];

    const order = await Order.findById(orderId);
    if (!order) {
      console.error(`SabPaisa Callback: Order not found: ${orderId}`);
      return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=OrderNotFound`);
    }

    // Verify payment outcome
    const isSuccess = statusCode.toUpperCase() === "SUCCESS" || statusCode.toUpperCase() === "TXN_SUCCESS";
    if (isSuccess) {
      order.status = "Paid";
    } else {
      order.status = "Failed";
    }

    await order.save();

    console.log(`SabPaisa Callback Successful: Order ${orderId} status set to ${order.status}`);

    // Redirect client back to the frontend checkout status page
    return res.redirect(`${FRONTEND_URL}/checkout/status?status=${order.status.toLowerCase()}&orderId=${orderId}&txnId=${sabpaisaTxnId}&amount=${amount}`);
  } catch (err: any) {
    console.error("SabPaisa Callback Error:", err);
    return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=ServerError`);
  }
};
