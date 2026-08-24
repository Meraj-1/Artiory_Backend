"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.querySabPaisaStatus = exports.sabPaisaCallback = exports.initiateSabPaisaPayment = void 0;
const crypto_1 = __importDefault(require("crypto"));
const https_1 = __importDefault(require("https"));
const Order_model_1 = __importDefault(require("../models/Order_model"));
const User_model_1 = __importDefault(require("../models/User_model"));
/**
 * Helper to perform secure HTTPS POST requests to SabPaisa PG 3.0 REST API
 */
const pg3Request = (url, apiKey, bodyData) => {
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
        const req = https_1.default.request(options, (res) => {
            let responseBody = "";
            res.on("data", (chunk) => {
                responseBody += chunk;
            });
            res.on("end", () => {
                try {
                    resolve(JSON.parse(responseBody));
                }
                catch (e) {
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
const SABPAISA_CLIENT_CODE = process.env.SABPAISA_CLIENT_CODE || "YOUR_CLIENT_CODE";
const SABPAISA_TRANS_USER_NAME = process.env.SABPAISA_TRANS_USER_NAME || "YOUR_USERNAME";
const SABPAISA_TRANS_USER_PASSWORD = process.env.SABPAISA_TRANS_USER_PASSWORD || "YOUR_PASSWORD";
const SABPAISA_AUTH_KEY = process.env.SABPAISA_AUTH_KEY || process.env.SABPAISA_API_KEY || "YOUR_16_BYTE_KEY"; // Must be exactly 16 bytes
const SABPAISA_AUTH_IV = process.env.SABPAISA_AUTH_IV || process.env.SABPAISA_SECRET_KEY || "YOUR_16_BYTE_IV"; // Must be exactly 16 bytes
const SABPAISA_INIT_URL = process.env.SABPAISA_INIT_URL || "https://stage-securepay.sabpaisa.in/SabPaisa/sabPaisaInit?v=1";
const SABPAISA_CALLBACK_URL = (process.env.SABPAISA_CALLBACK_URL || "https://api.artiory.com/api/payment/sabpaisa/callback").replace(/([^:]\/)\/+/g, "$1");
const FRONTEND_URL = process.env.FRONTEND_URL || "https://staging.artiory.com";
/**
 * Helper to ensure a buffer matches the required byte length by padding or slicing
 */
const getByteBuf = (str, length) => {
    const buf = Buffer.alloc(length, 0);
    const src = Buffer.from(str, "utf8");
    src.copy(buf, 0, 0, Math.min(src.length, length));
    return buf;
};
/**
 * Encrypts a string using AES-128-CBC or AES-256-CBC dynamically based on key length
 */
const encrypt = (plainText, key, iv) => {
    const keyLen = key.length;
    const algo = keyLen > 24 ? "aes-256-cbc" : "aes-128-cbc";
    const finalKeyLen = keyLen > 24 ? 32 : 16;
    const cipher = crypto_1.default.createCipheriv(algo, getByteBuf(key, finalKeyLen), getByteBuf(iv, 16));
    let encrypted = cipher.update(plainText, "utf8", "hex");
    encrypted += cipher.final("hex");
    return encrypted;
};
/**
 * Decrypts a string using AES-128-CBC or AES-256-CBC dynamically based on key length
 */
const decrypt = (encryptedText, key, iv) => {
    const keyLen = key.length;
    const algo = keyLen > 24 ? "aes-256-cbc" : "aes-128-cbc";
    const finalKeyLen = keyLen > 24 ? 32 : 16;
    const decipher = crypto_1.default.createDecipheriv(algo, getByteBuf(key, finalKeyLen), getByteBuf(iv, 16));
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
};
/**
 * POST /api/payment/sabpaisa/initiate
 * Initializes a SabPaisa payment checkout session
 */
const initiateSabPaisaPayment = async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ success: false, message: "Order ID is required" });
        }
        const order = await Order_model_1.default.findById(orderId).populate("user");
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        const user = order.user;
        if (process.env.PAYMENT_BYPASS === "true") {
            console.log("PAYMENT_BYPASS active. Direct redirecting with Paid status.");
            order.status = "Paid";
            await order.save();
            const redirectUrl = `${FRONTEND_URL}/checkout/status?status=paid&orderId=${order._id}`;
            return res.status(200).json({ success: true, checkoutUrl: redirectUrl });
        }
        const payerName = (user?.name || "Valued Customer").replace(/[^a-zA-Z ]/g, "").trim();
        const payerEmail = user?.email || "customer@artiory.com";
        const payerMobile = user?.number || "9999999999";
        // Generate unique transaction ID to prevent "Duplicate ID" gateway errors
        const clientTxnId = `${order._id}-${Date.now().toString().slice(-6)}`;
        // Store transaction ID for status query lookup
        order.clientTxnId = clientTxnId;
        await order.save();
        const isDummyUser = (val) => {
            if (!val)
                return true;
            const lower = val.toLowerCase();
            return (lower === "your_username" ||
                lower === "your_transaction_username" ||
                lower === "your_password" ||
                lower === "your_transaction_password");
        };
        const cleanUsername = isDummyUser(process.env.SABPAISA_TRANS_USER_NAME) ? "" : (process.env.SABPAISA_TRANS_USER_NAME || "");
        const cleanPassword = isDummyUser(process.env.SABPAISA_TRANS_USER_PASSWORD) ? "" : (process.env.SABPAISA_TRANS_USER_PASSWORD || "");
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
        queryString += `&callbackUrl=${SABPAISA_CALLBACK_URL}&channelId=W`;
        console.log("SabPaisa Query String:", queryString);
        // Try SabPaisa PG 3.0 API first
        try {
            const isStaging = SABPAISA_INIT_URL.includes("stage") || SABPAISA_INIT_URL.includes("staging");
            const pg3BaseUrl = isStaging
                ? "https://staging-sb-merchant-api.sabpaisa.in"
                : "https://merchant-api.sabpaisa.in";
            const pg3Endpoint = `${pg3BaseUrl}/api/v2/payments`;
            const timestampVal = Math.floor(Date.now() / 1000);
            const amountInPaise = Math.round(order.totalPrice * 100);
            // Checksum format: merchantId|merchantTxnId|amount|currency|timestamp
            const checksumString = `${SABPAISA_CLIENT_CODE}|${clientTxnId}|${amountInPaise}|INR|${timestampVal}`;
            const checksum = crypto_1.default
                .createHmac("sha256", SABPAISA_AUTH_IV) // SABPAISA_AUTH_IV maps to SABPAISA_SECRET_KEY
                .update(checksumString)
                .digest("hex");
            const pg3Payload = {
                merchantId: SABPAISA_CLIENT_CODE,
                merchantTxnId: clientTxnId,
                amount: amountInPaise,
                currency: "INR",
                returnUrl: SABPAISA_CALLBACK_URL,
                customerName: payerName,
                customerEmail: payerEmail,
                customerPhone: payerMobile,
                timestamp: timestampVal,
                checksum: checksum
            };
            console.log("Attempting SabPaisa PG 3.0 Initiation on URL:", pg3Endpoint);
            console.log("PG 3.0 Payload:", pg3Payload);
            const pg3Response = await pg3Request(pg3Endpoint, SABPAISA_AUTH_KEY, pg3Payload);
            console.log("SabPaisa PG 3.0 Response:", pg3Response);
            const checkoutUrl = pg3Response?.checkoutUrl || pg3Response?.paymentUrl || pg3Response?.data?.checkoutUrl || pg3Response?.data?.paymentUrl;
            const clientSecret = pg3Response?.clientSecret || pg3Response?.data?.clientSecret;
            if (checkoutUrl) {
                // SabPaisa checkoutUrl requires clientSecret parameter to avoid "Missing client secret" browser crashes
                const finalUrl = clientSecret ? `${checkoutUrl}?clientSecret=${clientSecret}` : checkoutUrl;
                return res.status(200).json({
                    success: true,
                    checkoutUrl: finalUrl
                });
            }
            else {
                console.warn("SabPaisa PG 3.0 did not return checkoutUrl. Falling back to Classic AES...", pg3Response);
            }
        }
        catch (pg3Error) {
            console.error("SabPaisa PG 3.0 Initiation failed. Falling back to Classic AES:", pg3Error);
        }
        let encData = "";
        try {
            encData = encrypt(queryString, SABPAISA_AUTH_KEY, SABPAISA_AUTH_IV);
        }
        catch (encErr) {
            console.error("SabPaisa Encryption Error:", encErr);
            return res.status(500).json({ success: false, message: "Failed to encrypt payment data" });
        }
        return res.status(200).json({
            success: true,
            encData,
            clientCode: SABPAISA_CLIENT_CODE,
            sabpaisaUrl: SABPAISA_INIT_URL
        });
    }
    catch (err) {
        console.error("Initiate Payment Error:", err);
        return res.status(500).json({ success: false, message: "Server Error" });
    }
};
exports.initiateSabPaisaPayment = initiateSabPaisaPayment;
/**
 * POST /api/payment/sabpaisa/callback
 * SabPaisa calls this endpoint to post status updates and redirect the client (Supports both PG 3.0 and Classic)
 */
const sabPaisaCallback = async (req, res) => {
    try {
        const encResponse = req.body.encResponse;
        let clientTxnId = "";
        let sabpaisaTxnId = "N/A";
        let statusCode = "FAILED";
        let amount = "0.00";
        if (encResponse) {
            // Classic Decryption Flow
            let decryptedText = "";
            try {
                decryptedText = decrypt(encResponse, SABPAISA_AUTH_KEY, SABPAISA_AUTH_IV);
            }
            catch (decErr) {
                console.error("SabPaisa Decryption Error:", decErr);
                return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=DecryptionFailed`);
            }
            console.log("SabPaisa Decrypted Response (Classic):", decryptedText);
            // Parse the query string params
            const params = new URLSearchParams(decryptedText);
            clientTxnId = params.get("clientTxnId") || "";
            sabpaisaTxnId = params.get("sabpaisaTxnId") || params.get("spTxnId") || "N/A";
            statusCode = params.get("statusCode") || params.get("status") || "FAILED";
            amount = params.get("amount") || "0.00";
        }
        else {
            // PG 3.0 Redirection / Webhook Flow (Plain Params in req.body or req.query)
            console.log("SabPaisa Callback (PG 3.0 format):", { body: req.body, query: req.query });
            clientTxnId = req.body.merchantTxnId || req.query.merchant_txn_id || req.body.clientTxnId || req.query.clientTxnId || "";
            sabpaisaTxnId = req.body.transaction_id || req.query.transaction_id || req.body.sabpaisaTxnId || req.query.sabpaisaTxnId || "N/A";
            statusCode = req.body.status || req.query.status || req.body.statusCode || req.query.statusCode || "FAILED";
            amount = req.body.amount || req.query.amount || "0.00";
        }
        if (!clientTxnId) {
            console.error("SabPaisa Callback: Missing clientTxnId / merchantTxnId");
            return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=MissingTxnId`);
        }
        // Extract Order ID (first segment of clientTxnId)
        const orderId = clientTxnId.split("-")[0];
        const order = await Order_model_1.default.findById(orderId);
        if (!order) {
            console.error(`SabPaisa Callback: Order not found: ${orderId}`);
            return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=OrderNotFound`);
        }
        const isSuccess = statusCode.toUpperCase() === "SUCCESS" || statusCode.toUpperCase() === "TXN_SUCCESS";
        if (isSuccess) {
            order.status = "Paid";
            if (order.user) {
                await User_model_1.default.findByIdAndUpdate(order.user, {
                    $set: { cart: [] }
                });
            }
        }
        else {
            order.status = "Failed";
        }
        await order.save();
        console.log(`SabPaisa Callback Successful: Order ${orderId} status set to ${order.status}`);
        // Redirect client back to the frontend checkout status page
        return res.redirect(`${FRONTEND_URL}/checkout/status?status=${order.status.toLowerCase()}&orderId=${orderId}&txnId=${sabpaisaTxnId}&amount=${amount}`);
    }
    catch (err) {
        console.error("SabPaisa Callback Error:", err);
        return res.redirect(`${FRONTEND_URL}/checkout/status?status=error&message=ServerError`);
    }
};
exports.sabPaisaCallback = sabPaisaCallback;
/**
 * Dynamic Transaction Inquiry to check payment status directly with SabPaisa (PG 3.0 REST API)
 */
const querySabPaisaStatus = (clientTxnId, amountRupee) => {
    return new Promise((resolve) => {
        try {
            const isStaging = SABPAISA_INIT_URL.includes("stage") || SABPAISA_INIT_URL.includes("staging");
            const host = isStaging ? "staging-sb-merchant-api.sabpaisa.in" : "merchant-api.sabpaisa.in";
            const path = "/api/v2/payments/enquiry";
            const timestampVal = Math.floor(Date.now() / 1000);
            const amountInPaise = Math.round(amountRupee * 100);
            // Checksum format: merchantId|merchantTxnId|amount|currency|timestamp
            const checksumString = `${SABPAISA_CLIENT_CODE}|${clientTxnId}|${amountInPaise}|INR|${timestampVal}`;
            const checksum = crypto_1.default
                .createHmac("sha256", SABPAISA_AUTH_IV) // SABPAISA_AUTH_IV maps to SABPAISA_SECRET_KEY
                .update(checksumString)
                .digest("hex");
            const postData = JSON.stringify({
                clientCode: SABPAISA_CLIENT_CODE,
                merchantId: SABPAISA_CLIENT_CODE,
                merchantTxnId: clientTxnId,
                amount: amountInPaise,
                currency: "INR",
                timestamp: timestampVal,
                checksum: checksum
            });
            console.log("Attempting SabPaisa PG 3.0 Enquiry on Host:", host, "with payload:", postData);
            const options = {
                hostname: host,
                port: 443,
                path: path,
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Api-Key": SABPAISA_AUTH_KEY, // SABPAISA_AUTH_KEY is the API Key
                    "X-Merchant-Id": SABPAISA_CLIENT_CODE, // X-Merchant-Id header is required
                    "Content-Length": Buffer.byteLength(postData),
                },
            };
            const req = https_1.default.request(options, (res) => {
                let body = "";
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => {
                    try {
                        const json = JSON.parse(body);
                        console.log(`SabPaisa PG 3.0 Enquiry Response for ${clientTxnId}:`, json);
                        const status = json.status || json.statusCode || "FAILED";
                        resolve(status);
                    }
                    catch (e) {
                        resolve("FAILED");
                    }
                });
            });
            req.on("error", (err) => {
                console.error("SabPaisa Enquiry request error:", err);
                resolve("FAILED");
            });
            req.write(postData);
            req.end();
        }
        catch (err) {
            console.error("SabPaisa Enquiry try error:", err);
            resolve("FAILED");
        }
    });
};
exports.querySabPaisaStatus = querySabPaisaStatus;
