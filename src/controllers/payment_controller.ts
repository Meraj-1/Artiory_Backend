import { Request, Response } from "express";
import crypto from "crypto";
import https from "https";
import mongoose from "mongoose";
import Order from "../models/Order_model";
import User from "../models/User_model";
import Product from "../models/Product_model";
import { bookShipmentForOrder } from "./logistics_controller";
import { sendOrderConfirmationEmails, handleSuccessfulPayment } from "../services/email_service";

/**
 * Helper to perform secure HTTPS POST requests to SabPaisa PG 3.0 REST API
 */
const pg3Request = (url: string, apiKey: string, bodyData: any): Promise<any> => {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const postData = JSON.stringify(bodyData);
    const options = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname,
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => {
        responseBody += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(responseBody));
        } catch (e) {
          resolve({ error: "Failed to parse JSON response", raw: responseBody });
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
};

// SabPaisa Credentials and Configurations
const SABPAISA_CLIENT_CODE = process.env.SABPAISA_CLIENT_CODE || "ATHE1";
const SABPAISA_TRANS_USER_NAME = process.env.SABPAISA_TRANS_USER_NAME || "";
const SABPAISA_TRANS_USER_PASSWORD = process.env.SABPAISA_TRANS_USER_PASSWORD || "";
const SABPAISA_AUTH_KEY = (process.env.SABPAISA_AUTH_KEY || process.env.SABPAISA_API_KEY || "").trim();
const SABPAISA_AUTH_IV = (process.env.SABPAISA_AUTH_IV || process.env.SABPAISA_SECRET_KEY || "").trim();
const SABPAISA_MERCHANT_API_URL = process.env.SABPAISA_MERCHANT_API_URL || "https://merchant-api.sabpaisa.in";
const SABPAISA_INIT_URL = process.env.SABPAISA_INIT_URL || "https://securepay.sabpaisa.in/SabPaisa/sabPaisaInit?v=1";
const SABPAISA_CALLBACK_URL = (process.env.SABPAISA_CALLBACK_URL || "https://artiory.com/api/payment/sabpaisa/callback").replace(/([^:]\/)\/+/g, "$1");
const FRONTEND_URL = process.env.FRONTEND_URL || "https://artiory.com";

/**
 * Helper to ensure a buffer matches the required byte length by padding or slicing
 */
const getByteBuf = (str: string, length: number): Buffer => {
  const buf = Buffer.alloc(length, 0);
  const src = Buffer.from(str, "utf8");
  src.copy(buf, 0, 0, Math.min(src.length, length));
  return buf;
};

/**
 * Encrypts a string using AES-128-CBC or AES-256-CBC dynamically based on key length
 */
const encrypt = (plainText: string, key: string, iv: string): string => {
  const keyLen = key.length;
  const algo = keyLen > 24 ? "aes-256-cbc" : "aes-128-cbc";
  const finalKeyLen = keyLen > 24 ? 32 : 16;

  const cipher = crypto.createCipheriv(algo, getByteBuf(key, finalKeyLen), getByteBuf(iv, 16));
  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  return encrypted;
};

/**
 * Decrypts a string using AES-128-CBC or AES-256-CBC dynamically based on key length
 */
const decrypt = (encryptedText: string, key: string, iv: string): string => {
  const keyLen = key.length;
  const algo = keyLen > 24 ? "aes-256-cbc" : "aes-128-cbc";
  const finalKeyLen = keyLen > 24 ? 32 : 16;

  const decipher = crypto.createDecipheriv(algo, getByteBuf(key, finalKeyLen), getByteBuf(iv, 16));
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

    // Extract customer details from order shipping address or user profile
    const payerName = (order.shippingAddress?.name || user?.name || "Valued Customer").replace(/[^a-zA-Z ]/g, "").trim() || "Customer";
    const payerEmail = (order.shippingAddress?.email || user?.email || "customer@artiory.com").trim();
    let rawMobile = (order.shippingAddress?.phone || user?.number || "9876543210").toString().replace(/\D/g, "");
    if (rawMobile.length > 10) rawMobile = rawMobile.slice(-10);
    if (rawMobile.length < 10) rawMobile = "9876543210";
    const payerMobile = rawMobile;

    // Generate unique transaction ID to prevent "Duplicate ID" gateway errors
    const clientTxnId = `${order._id}-${Date.now().toString().slice(-6)}`;

    // Store transaction ID for status query lookup
    order.clientTxnId = clientTxnId;
    await order.save();

    const isDummyUser = (val: string | undefined): boolean => {
      if (!val) return true;
      const lower = val.toLowerCase();
      return (
        lower === "your_username" ||
        lower === "your_transaction_username" ||
        lower === "your_password" ||
        lower === "your_transaction_password"
      );
    };

    const cleanUsername = isDummyUser(process.env.SABPAISA_TRANS_USER_NAME) ? "" : (process.env.SABPAISA_TRANS_USER_NAME || "");
    const cleanPassword = isDummyUser(process.env.SABPAISA_TRANS_USER_PASSWORD) ? "" : (process.env.SABPAISA_TRANS_USER_PASSWORD || "");

    // Always use the fixed production callback URL from env — never derive from request origin
    // SabPaisa requires a public HTTPS URL, localhost will never receive callbacks
    const activeCallbackUrl = (process.env.SABPAISA_CALLBACK_URL || "https://artiory.com/api/payment/sabpaisa/callback").trim();
    const activeFrontendUrl = (process.env.FRONTEND_URL || "https://artiory.com").trim();

    order.returnUrl = activeFrontendUrl;
    await order.save();

    // Direct Payment Bypass for Testing Mode
    const isPaymentBypass = process.env.PAYMENT_BYPASS === "true" || req.body?.bypass === true;
    if (isPaymentBypass) {
      order.status = "Paid";
      order.shipmentStatus = "Unshipped";
      order.sabpaisaTxnId = `BYPASS-${Date.now().toString().slice(-6)}`;
      await order.save();
      if (order.user) {
        await User.findByIdAndUpdate(order.user, { $set: { cart: [] } }).catch(() => {});
      }

      // Auto-trigger iThink Logistics shipment booking & notifications immediately
      bookShipmentForOrder(order._id).catch((e) => console.error("Auto-shipment trigger error:", e));

      // Trigger Resend transactional email notification to Customer & Admin
      sendOrderConfirmationEmails(order._id).catch((e) => console.error("Resend confirmation email error:", e));

      return res.status(200).json({
        success: true,
        isBypass: true,
        checkoutUrl: `${activeFrontendUrl}/profile?tab=orders&highlight=${order._id}`,
        message: "Payment Bypassed for Testing - Order Successfully Created and Marked Paid!"
      });
    }

    const currentClientCode = (process.env.SABPAISA_CLIENT_CODE || "ATHE1").trim();
    const currentAuthKey = SABPAISA_AUTH_KEY;
    const currentAuthIv = SABPAISA_AUTH_IV;
    const currentInitUrl = (process.env.SABPAISA_INIT_URL || "https://securepay.sabpaisa.in/SabPaisa/sabPaisaInit?v=1").trim();

    if (!currentAuthKey || !currentAuthIv) {
      return res.status(500).json({
        success: false,
        message: "Payment gateway credentials not configured on server"
      });
    }

    // Build query string dynamically (only include transUserName/Password if provided, maintaining exact order sequence)
    let queryString = `payerName=${payerName}` +
      `&payerEmail=${payerEmail}` +
      `&payerMobile=${payerMobile}` +
      `&clientTxnId=${clientTxnId}` +
      `&amount=${order.totalPrice.toFixed(2)}` +
      `&clientCode=${currentClientCode}`;

    if (cleanUsername) {
      queryString += `&transUserName=${cleanUsername}`;
    }
    if (cleanPassword) {
      queryString += `&transUserPassword=${cleanPassword}`;
    }

    queryString += `&callbackUrl=${activeCallbackUrl}&channelId=W`;

    console.log("SabPaisa Classic Query String:", queryString);

    // Try SabPaisa PG 3.0 Live REST API (Returns instant checkoutUrl)
    try {
      const pg3BaseUrl = (process.env.SABPAISA_MERCHANT_API_URL || "https://merchant-api.sabpaisa.in").trim();
      const pg3Endpoint = `${pg3BaseUrl}/api/v2/payments`;

      const timestampVal = Math.floor(Date.now() / 1000);
      const amountInPaise = Math.round(order.totalPrice * 100);

      // Checksum format: merchantId|merchantTxnId|amount|currency|timestamp
      const checksumString = `${currentClientCode}|${clientTxnId}|${amountInPaise}|INR|${timestampVal}`;
      const checksum = crypto
        .createHmac("sha256", currentAuthIv)
        .update(checksumString)
        .digest("hex");

      const pg3Payload = {
        merchantId: currentClientCode,
        merchantTxnId: clientTxnId,
        amount: amountInPaise,
        currency: "INR",
        customerName: payerName,
        customerEmail: payerEmail,
        customerPhone: payerMobile,
        returnUrl: activeCallbackUrl,
        checksum: checksum,
        timestamp: timestampVal
      };

      console.log("Attempting SabPaisa PG 3.0 Live on URL:", pg3Endpoint);
      console.log("PG 3.0 Return/Callback URL:", activeCallbackUrl);

      const pg3Response = await pg3Request(pg3Endpoint, currentAuthKey, pg3Payload);
      console.log("SabPaisa PG 3.0 Response:", JSON.stringify(pg3Response));

      const checkoutUrl =
        pg3Response?.checkoutUrl ||
        pg3Response?.paymentUrl ||
        pg3Response?.payment_url ||
        pg3Response?.data?.checkoutUrl ||
        pg3Response?.data?.paymentUrl ||
        pg3Response?.data?.payment_url;
      const clientSecret = pg3Response?.clientSecret || pg3Response?.data?.clientSecret;

      if (checkoutUrl) {
        const finalUrl = clientSecret && !checkoutUrl.includes("clientSecret")
          ? `${checkoutUrl}${checkoutUrl.includes("?") ? "&" : "?"}clientSecret=${clientSecret}`
          : checkoutUrl;
        return res.status(200).json({
          success: true,
          checkoutUrl: finalUrl
        });
      } else {
        console.error("SabPaisa PG 3.0 did not return checkoutUrl:", pg3Response);
        return res.status(400).json({
          success: false,
          message: pg3Response?.errorMessage || pg3Response?.message || "Failed to initialize payment gateway",
          details: pg3Response
        });
      }
    } catch (pg3Error: any) {
      console.error("SabPaisa PG 3.0 Initiation error:", pg3Error);
      return res.status(500).json({
        success: false,
        message: pg3Error.message || "Failed to communicate with SabPaisa payment gateway"
      });
    }
  } catch (err: any) {
    console.error("Initiate Payment Error:", err);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

/**
 * POST /api/payment/sabpaisa/callback
 * SabPaisa calls this endpoint to post status updates and redirect the client (Supports both PG 3.0 and Classic)
 */
export const sabPaisaCallback = async (req: Request, res: Response): Promise<any> => {
  try {
    // LOG EVERYTHING - to see exact format SabPaisa sends
    console.log("=== SABPAISA CALLBACK RECEIVED ===");
    console.log("Method:", req.method);
    console.log("Headers:", JSON.stringify(req.headers));
    console.log("Body:", JSON.stringify(req.body));
    console.log("Query:", JSON.stringify(req.query));
    console.log("=================================");

    const encResponse = req.body?.encResponse || req.query?.encResponse;

    let clientTxnId = "";
    let sabpaisaTxnId = "N/A";
    let statusCode = "PENDING";
    let amount = "0.00";

    const currentAuthKey = SABPAISA_AUTH_KEY;
    const currentAuthIv = SABPAISA_AUTH_IV;

    if (encResponse) {
      // Classic Decryption Flow
      let decryptedText = "";
      try {
        decryptedText = decrypt(encResponse, currentAuthKey, currentAuthIv);
      } catch (decErr: any) {
        console.error("SabPaisa Decryption Error:", decErr);
        return res.redirect(`${FRONTEND_URL}/checkout?error=DecryptionFailed`);
      }

      console.log("SabPaisa Decrypted Response (Classic):", decryptedText);

      // Parse the query string params
      const params = new URLSearchParams(decryptedText);
      clientTxnId = params.get("clientTxnId") || params.get("merchantTxnId") || "";
      sabpaisaTxnId = params.get("sabpaisaTxnId") || params.get("spTxnId") || "N/A";
      statusCode = params.get("statusCode") || params.get("status") || "FAILED";
      amount = params.get("amount") || "0.00";
    } else {
      // PG 3.0 Redirection / Webhook Flow (Plain Params in req.body or req.query)
      console.log("SabPaisa Callback (PG 3.0 format):", { body: req.body, query: req.query });
      clientTxnId =
        req.body?.merchantTxnId ||
        req.query?.merchantTxnId ||
        req.query?.merchant_txn_id ||
        req.body?.clientTxnId ||
        req.query?.clientTxnId ||
        req.body?.orderId ||
        req.query?.orderId ||
        "";
      sabpaisaTxnId =
        req.body?.transaction_id ||
        req.query?.transaction_id ||
        req.body?.sabpaisaTxnId ||
        req.query?.sabpaisaTxnId ||
        req.body?.spTxnId ||
        req.query?.spTxnId ||
        "N/A";
      statusCode =
        req.body?.status ||
        req.query?.status ||
        req.body?.statusCode ||
        req.query?.statusCode ||
        req.body?.status_code ||
        req.query?.status_code ||
        "FAILED";
      amount =
        req.body?.paid_amount ||
        req.query?.paid_amount ||
        req.body?.amount ||
        req.query?.amount ||
        "0.00";
    }

    if (!clientTxnId) {
      console.error("SabPaisa Callback: Missing clientTxnId / merchantTxnId");
      return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=MissingTxnId`);
    }

    // Extract Order ID from clientTxnId (format: "<24charObjectId>-<timestamp6>")
    // Try full clientTxnId as ObjectId first, then extract prefix, then fallback to DB lookup
    let order = null;
    const rawOrderId = clientTxnId.length === 24 && mongoose.Types.ObjectId.isValid(clientTxnId)
      ? clientTxnId
      : clientTxnId.substring(0, 24);

    if (mongoose.Types.ObjectId.isValid(rawOrderId)) {
      order = await Order.findById(rawOrderId);
    }
    if (!order) {
      order = await Order.findOne({ clientTxnId });
    }

    if (!order) {
      console.error(`SabPaisa Callback: Order not found for clientTxnId: ${clientTxnId}, rawOrderId: ${rawOrderId}`);
      if (req.headers.accept?.includes("application/json") || req.headers["x-forwarded-by"] === "nextjs" || req.is("application/json")) {
        return res.status(404).json({ success: false, message: "Order not found", clientTxnId });
      }
      return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=OrderNotFound`);
    }

    // Official SabPaisa status codes:
    // 0000 = SUCCESS, 0100 = INITIATED/PENDING, 0200 = ABORTED, 0300 = FAILED, 0999 = UNKNOWN
    const normalizedStatus = String(statusCode ?? "").trim().toUpperCase();
    const normalizedStatusCode = String(statusCode ?? "").trim();

    const isSuccess =
      (normalizedStatus === "SUCCESS" && normalizedStatusCode === "0000") ||
      normalizedStatus === "SUCCESS" ||
      normalizedStatusCode === "0000";

    const isFailed = normalizedStatusCode === "0300" || normalizedStatus === "FAILED";
    const isAborted = normalizedStatusCode === "0200" || normalizedStatus === "ABORTED";
    const isPending = normalizedStatusCode === "0100" || normalizedStatus === "INITIATED";

    console.log(`SabPaisa status parsed: code=${normalizedStatusCode} status=${normalizedStatus} isSuccess=${isSuccess} isFailed=${isFailed} isAborted=${isAborted}`);

    if (isSuccess) {
      // Only update if not already Paid (prevent duplicate processing)
      if (order.status !== "Paid") {
        order.status = "Paid";
        if (sabpaisaTxnId && sabpaisaTxnId !== "N/A") {
          order.sabpaisaTxnId = sabpaisaTxnId;
        }
        if (clientTxnId) {
          order.clientTxnId = clientTxnId;
        }

        // Decrement product inventory on verified successful payment
        for (const item of order.orderItems) {
          if (item.productId) {
            await Product.findByIdAndUpdate(item.productId, {
              $inc: { stockQuantity: -item.qty }
            }).catch(() => {});
          }
        }

        if (order.user) {
          await User.findByIdAndUpdate(order.user, {
            $set: { cart: [] }
          }).catch(() => {});
        }
        await order.save();
        console.log(`SabPaisa Callback Successful: Order ${order._id} status set to Paid (Txn: ${sabpaisaTxnId})`);

        // Auto-trigger iThink Logistics shipment booking & notifications immediately
        bookShipmentForOrder(order._id).catch((e) => console.error("Auto-shipment trigger error:", e));

        // Trigger Resend transactional email notification to Customer & Admin
        sendOrderConfirmationEmails(order._id).catch((e) => console.error("Resend confirmation email error:", e));
      } else {
        console.log(`SabPaisa Callback: Order ${order._id} already Paid, skipping duplicate processing.`);
      }
    } else {
      if (clientTxnId) order.clientTxnId = clientTxnId;
      await order.save();
      if (isFailed) {
        console.log(`SabPaisa Callback: Order ${order._id} payment FAILED (0300) — keeping Pending for manual review.`);
      } else if (isAborted) {
        console.log(`SabPaisa Callback: Order ${order._id} payment ABORTED by user (0200) — keeping Pending.`);
      } else {
        console.log(`SabPaisa Callback: Order ${order._id} status not confirmed (${statusCode}) — keeping Pending.`);
      }
    }

    const isGuest = Boolean((order as any)?.isGuest);
    const redirectBase = (process.env.FRONTEND_URL || "https://artiory.com").trim();
    const successRedirectUrl = isGuest
      ? `${redirectBase}/track-order?orderId=${order._id}&payment=success`
      : `${redirectBase}/profile?tab=orders&highlight=${order._id}`;

    // JSON response for API clients
    if (req.headers.accept?.includes("application/json") || req.headers["x-forwarded-by"] === "nextjs" || req.is("application/json")) {
      return res.status(200).json({
        success: true,
        isSuccess,
        isGuest,
        orderId: order._id.toString(),
        clientTxnId,
        sabpaisaTxnId,
        status: order.status,
        redirectUrl: isSuccess ? successRedirectUrl : `${redirectBase}/checkout?error=PaymentFailed`
      });
    }

    // Browser redirect
    return res.redirect(isSuccess ? successRedirectUrl : `${redirectBase}/checkout?error=PaymentCancelledOrFailed`);
  } catch (err: any) {
    console.error("SabPaisa Callback Error:", err);
    if (req.headers.accept?.includes("application/json") || req.headers["x-forwarded-by"] === "nextjs" || req.is("application/json")) {
      return res.status(500).json({ success: false, message: "Callback processing error", error: err.message });
    }
    return res.redirect(`${process.env.FRONTEND_URL || "https://artiory.com"}/profile?tab=orders`);
  }
};

/**
 * POST /api/payment/sabpaisa/enquiry or POST /api/payment/sabpaisa/status
 * Queries transaction status with SabPaisa PG 3.0 API v2
 * curl -X POST 'https://staging-sb-merchant-api.sabpaisa.in/api/v2/payments/enquiry' \
 *   -H 'X-Api-Key: sk_test_your_api_key_here' \
 *   -H 'Content-Type: application/json' \
 *   -d '{ "clientCode": "SQUA102", "merchantTxnId": "TESTING..." }'
 */
export const enquireSabPaisaPayment = async (req: Request, res: Response): Promise<any> => {
  try {
    const { merchantTxnId, clientTxnId, orderId, clientCode } = req.body || {};
    const txnIdToQuery = merchantTxnId || clientTxnId || orderId;

    if (!txnIdToQuery) {
      return res.status(400).json({
        success: false,
        message: "merchantTxnId or orderId is required for transaction enquiry"
      });
    }

    const payload = {
      clientCode: clientCode || SABPAISA_CLIENT_CODE,
      merchantTxnId: txnIdToQuery.toString()
    };

    const isStaging = SABPAISA_INIT_URL.includes("stage") || SABPAISA_INIT_URL.includes("staging");
    const pg3BaseUrl = process.env.SABPAISA_MERCHANT_API_URL || (isStaging ? "https://staging-sb-merchant-api.sabpaisa.in" : "https://merchant-api.sabpaisa.in");
    const endpoint = `${pg3BaseUrl}/api/v2/payments/enquiry`;

    console.log("Attempting SabPaisa PG 3.0 Enquiry on URL:", endpoint);
    console.log("Enquiry Headers: X-Api-Key:", SABPAISA_AUTH_KEY.slice(0, 8) + "...");
    console.log("Enquiry Payload:", JSON.stringify(payload));

    const enquiryResponse = await pg3Request(endpoint, SABPAISA_AUTH_KEY, payload);
    console.log("SabPaisa PG 3.0 Enquiry Response:", JSON.stringify(enquiryResponse));

    const rawStatus = enquiryResponse?.status || enquiryResponse?.statusCode || enquiryResponse?.data?.status || "PENDING";
    const status = rawStatus;
    const normalizedEnquiryStatus = String(rawStatus ?? "").trim().toUpperCase();
    const normalizedEnquiryCode = String(rawStatus ?? "").trim();

    const isSuccess =
      (normalizedEnquiryStatus === "SUCCESS" && normalizedEnquiryCode === "0000") ||
      normalizedEnquiryStatus === "SUCCESS" ||
      normalizedEnquiryCode === "0000";

    // Auto-update Order in DB
    const rawTxnId = txnIdToQuery.toString();
    const rawTargetId = rawTxnId.length >= 24 ? rawTxnId.substring(0, 24) : rawTxnId;
    let order = null;
    if (mongoose.Types.ObjectId.isValid(rawTargetId)) {
      order = await Order.findById(rawTargetId);
    }
    if (!order) {
      order = await Order.findOne({ clientTxnId: rawTxnId });
    }

    if (order) {
      if (isSuccess && order.status !== "Paid") {
        order.status = "Paid";
        order.clientTxnId = txnIdToQuery;
        for (const item of order.orderItems) {
          if (item.productId) {
            await Product.findByIdAndUpdate(item.productId, {
              $inc: { stockQuantity: -item.qty }
            }).catch(() => {});
          }
        }
        await order.save();
        if (order.user) {
          await User.findByIdAndUpdate(order.user, { $set: { cart: [] } }).catch(() => {});
        }
      } else if (!isSuccess && (normalizedEnquiryStatus === "EXPIRED" || normalizedEnquiryStatus === "FAILED" || normalizedEnquiryCode === "0300")) {
        // Do NOT auto-mark as Failed — keep Pending for admin manual reconciliation
        console.log(`SabPaisa Enquiry: Order ${order._id} status ${normalizedEnquiryStatus} — keeping as Pending`);
      }
    }

    return res.status(200).json({
      success: true,
      status,
      isPaid: isSuccess,
      data: enquiryResponse
    });
  } catch (err: any) {
    console.error("SabPaisa Enquiry Error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to query SabPaisa transaction status"
    });
  }
};

/**
 * Dynamic Transaction Inquiry to check payment status directly with SabPaisa (PG 3.0 REST API)
 */
export const querySabPaisaStatus = (clientTxnId: string): Promise<string> => {
  return new Promise(async (resolve) => {
    try {
      const isStaging = SABPAISA_INIT_URL.includes("stage") || SABPAISA_INIT_URL.includes("staging");
      const pg3BaseUrl = process.env.SABPAISA_MERCHANT_API_URL || (isStaging ? "https://staging-sb-merchant-api.sabpaisa.in" : "https://merchant-api.sabpaisa.in");
      const endpoint = `${pg3BaseUrl}/api/v2/payments/enquiry`;

      const payload = {
        clientCode: SABPAISA_CLIENT_CODE,
        merchantTxnId: clientTxnId
      };

      console.log("Querying SabPaisa PG 3.0 Enquiry on Endpoint:", endpoint, "with payload:", JSON.stringify(payload));
      const json = await pg3Request(endpoint, SABPAISA_AUTH_KEY, payload);
      console.log(`SabPaisa PG 3.0 Enquiry Response for ${clientTxnId}:`, JSON.stringify(json));

      const rawStatus = json?.status || json?.statusCode || json?.data?.status || "PENDING";
      console.log(`SabPaisa querySabPaisaStatus raw response for ${clientTxnId}:`, JSON.stringify(json));
      resolve(rawStatus);
    } catch (err) {
      console.error("SabPaisa Enquiry error:", err);
      resolve("PENDING");
    }
  });
};
