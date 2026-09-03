import { Request, Response } from "express";
import crypto from "crypto";
import https from "https";
import mongoose from "mongoose";
import Order from "../models/Order_model";
import User from "../models/User_model";
import Product from "../models/Product_model";

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
const SABPAISA_CLIENT_CODE = process.env.SABPAISA_CLIENT_CODE || "SQUA102";
const SABPAISA_TRANS_USER_NAME = process.env.SABPAISA_TRANS_USER_NAME || "";
const SABPAISA_TRANS_USER_PASSWORD = process.env.SABPAISA_TRANS_USER_PASSWORD || "";
const SABPAISA_AUTH_KEY = process.env.SABPAISA_AUTH_KEY || process.env.SABPAISA_API_KEY || "sp_itOrld7Rm0SGjkqg_VSEXBtZXqi8T26-pMPfpUCxUQo";
const SABPAISA_AUTH_IV = process.env.SABPAISA_AUTH_IV || process.env.SABPAISA_SECRET_KEY || "sec_lLao-1-yDLmV81YjExxgR00a8o7FgJ8-HLSJj9Od4hY";
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

    const originHeader = (req.body?.returnUrl as string) || (req.headers.origin as string) || (req.headers.referer as string) || "";
    let activeFrontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

    if (originHeader.includes("localhost:3000") || originHeader.includes("127.0.0.1:3000")) {
      activeFrontendUrl = "http://localhost:3000";
    } else if (originHeader.includes("localhost:3001") || originHeader.includes("127.0.0.1:3001")) {
      activeFrontendUrl = "http://localhost:3001";
    } else if (originHeader.includes("localhost:3002") || originHeader.includes("127.0.0.1:3002")) {
      activeFrontendUrl = "http://localhost:3002";
    } else if (originHeader.includes("artiory.com")) {
      activeFrontendUrl = "https://artiory.com";
    }

    order.returnUrl = activeFrontendUrl;
    await order.save();

    const activeCallbackUrl = `${activeFrontendUrl}/api/payment/sabpaisa/callback`;

    // Build query string dynamically (only include transUserName/Password if provided, maintaining exact order sequence)
    let queryString = `payerName=${payerName}` +
      `&payerEmail=${payerEmail}` +
      `&payerMobile=${payerMobile}` +
      `&clientTxnId=${clientTxnId}` +
      `&amount=${order.totalPrice.toFixed(2)}` +
      `&clientCode=${SABPAISA_CLIENT_CODE}`;

    if (cleanUsername) {
      queryString += `&transUserName=${cleanUsername}`;
    }
    if (cleanPassword) {
      queryString += `&transUserPassword=${cleanPassword}`;
    }

    queryString += `&callbackUrl=${activeCallbackUrl}&channelId=W`;

    console.log("SabPaisa Classic Query String:", queryString);

    // Try SabPaisa Live PG 3.0 API
    try {
      const configuredBase = process.env.SABPAISA_MERCHANT_API_URL || "https://merchant-api.sabpaisa.in";
      
      const endpointsToTry = [
        "https://merchant-api.sabpaisa.in/api/v2/payments",
        `${configuredBase}/api/v2/payments`,
        "https://staging-sb-merchant-api.sabpaisa.in/api/v2/payments"
      ];
      // Deduplicate
      const uniqueEndpoints = Array.from(new Set(endpointsToTry));

      const timestampVal = Math.floor(Date.now() / 1000);
      const amountInPaise = Math.round(order.totalPrice * 100);

      const checksumString = `${SABPAISA_CLIENT_CODE}|${clientTxnId}|${amountInPaise}|INR|${timestampVal}`;
      const checksum = crypto
        .createHmac("sha256", SABPAISA_AUTH_IV)
        .update(checksumString)
        .digest("hex");

      const pg3Payload = {
        merchantId: SABPAISA_CLIENT_CODE,
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

      for (const endpoint of uniqueEndpoints) {
        try {
          console.log("Attempting SabPaisa PG 3.0 on URL:", endpoint);
          const pg3Response = await pg3Request(endpoint, SABPAISA_AUTH_KEY, pg3Payload);
          console.log("SabPaisa PG 3.0 Response from", endpoint, ":", JSON.stringify(pg3Response));

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
          }
        } catch (subErr: any) {
          console.warn("Endpoint failed:", endpoint, subErr?.message);
        }
      }
    } catch (pg3Error) {
      console.error("SabPaisa PG 3.0 Initiation failed. Falling back to Classic AES:", pg3Error);
    }

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
 * SabPaisa calls this endpoint to post status updates and redirect the client (Supports both PG 3.0 and Classic)
 */
export const sabPaisaCallback = async (req: Request, res: Response): Promise<any> => {
  try {
    const encResponse = req.body?.encResponse || req.query?.encResponse;

    let clientTxnId = "";
    let sabpaisaTxnId = "N/A";
    let statusCode = "FAILED";
    let amount = "0.00";

    if (encResponse) {
      // Classic Decryption Flow
      let decryptedText = "";
      try {
        decryptedText = decrypt(encResponse, SABPAISA_AUTH_KEY, SABPAISA_AUTH_IV);
      } catch (decErr: any) {
        console.error("SabPaisa Decryption Error:", decErr);
        return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=DecryptionFailed`);
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

    // Extract Order ID (first segment of clientTxnId)
    const orderId = clientTxnId.split("-")[0];

    const order = await Order.findById(orderId);
    if (!order) {
      console.error(`SabPaisa Callback: Order not found: ${orderId}`);
      return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=OrderNotFound`);
    }

    const isSuccess =
      statusCode.toUpperCase() === "SUCCESS" ||
      statusCode.toUpperCase() === "TXN_SUCCESS" ||
      statusCode.toUpperCase() === "PAID";

    if (isSuccess) {
      order.status = "Paid";
      if (order.user) {
        await User.findByIdAndUpdate(order.user, {
          $set: { cart: [] }
        });
      }
      await order.save();
      console.log(`SabPaisa Callback Successful: Order ${orderId} status set to Paid`);
    } else {
      // Payment Failed, Cancelled, or Timed Out -> Restore product stock and completely DELETE unpaid order from database
      if (order.orderItems && order.orderItems.length > 0) {
        for (const item of order.orderItems) {
          await Product.findByIdAndUpdate(item.productId, {
            $inc: { stockQuantity: item.qty }
          });
        }
      }
      await Order.findByIdAndDelete(orderId);
      console.log(`SabPaisa Callback Cancelled/Failed: Unpaid order ${orderId} completely deleted from DB and stock restored.`);
    }

    let displayAmount = amount;
    if (Number(amount) > 1000 && !amount.toString().includes(".")) {
      displayAmount = (Number(amount) / 100).toFixed(2);
    }

    const originHeader = (req.headers.origin as string) || (req.headers.referer as string) || "";
    let activeFrontendUrl = (order as any)?.returnUrl || process.env.FRONTEND_URL || "http://localhost:3000";

    if (originHeader.includes("localhost:3000") || originHeader.includes("127.0.0.1:3000")) {
      activeFrontendUrl = "http://localhost:3000";
    } else if (originHeader.includes("localhost:3001") || originHeader.includes("127.0.0.1:3001")) {
      activeFrontendUrl = "http://localhost:3001";
    } else if (originHeader.includes("localhost:3002") || originHeader.includes("127.0.0.1:3002")) {
      activeFrontendUrl = "http://localhost:3002";
    } else if (originHeader.includes("artiory.com")) {
      activeFrontendUrl = "https://artiory.com";
    }

    // Redirect to profile orders if success, or back to checkout if failed/cancelled
    if (isSuccess) {
      return res.redirect(`${activeFrontendUrl}/profile?tab=orders&highlight=${orderId}`);
    } else {
      return res.redirect(`${activeFrontendUrl}/checkout?error=PaymentCancelledOrFailed`);
    }
  } catch (err: any) {
    console.error("SabPaisa Callback Error:", err);
    return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:3000"}/profile?tab=orders`);
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

    const status = enquiryResponse?.status || enquiryResponse?.statusCode || enquiryResponse?.data?.status || "PENDING";
    const isSuccess =
      status.toUpperCase() === "SUCCESS" ||
      status.toUpperCase() === "TXN_SUCCESS" ||
      status.toUpperCase() === "PAID";

    // Auto-update or clean up Order in DB
    const targetOrderId = txnIdToQuery.split("-")[0];
    if (mongoose.Types.ObjectId.isValid(targetOrderId)) {
      const order = await Order.findById(targetOrderId);
      if (order) {
        if (isSuccess && order.status !== "Paid") {
          order.status = "Paid";
          order.clientTxnId = txnIdToQuery;
          await order.save();
          if (order.user) {
            await User.findByIdAndUpdate(order.user, { $set: { cart: [] } });
          }
        } else if (!isSuccess && (status === "EXPIRED" || status === "FAILED" || status === "0300" || status === "0200")) {
          // Restore stock and delete unpaid order
          for (const item of order.orderItems) {
            await Product.findByIdAndUpdate(item.productId, {
              $inc: { stockQuantity: item.qty }
            });
          }
          await Order.findByIdAndDelete(order._id);
        }
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

      const status = json?.status || json?.statusCode || json?.data?.status || "FAILED";
      resolve(status);
    } catch (err) {
      console.error("SabPaisa Enquiry error:", err);
      resolve("FAILED");
    }
  });
};
