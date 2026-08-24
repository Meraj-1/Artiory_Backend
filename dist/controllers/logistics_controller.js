"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShippingCharge = exports.checkPincodeServiceability = exports.trackiThinkShipment = exports.shipOrderWithiThink = void 0;
const https_1 = __importDefault(require("https"));
const Order_model_1 = __importDefault(require("../models/Order_model"));
const Product_model_1 = __importDefault(require("../models/Product_model"));
const mongoose_1 = __importDefault(require("mongoose"));
const ITHINK_ACCESS_TOKEN = process.env.ITHINK_ACCESS_TOKEN || "";
const ITHINK_SECRET_KEY = process.env.ITHINK_SECRET_KEY || "";
const ITHINK_PICKUP_ADDRESS_ID = process.env.ITHINK_PICKUP_ADDRESS_ID || "1";
/**
 * Generic helper to call iThink Logistics REST API endpoints
 */
const postToiThink = (endpointPath, payload) => {
    return new Promise((resolve, reject) => {
        let baseHost = "my.ithinklogistics.com";
        if (process.env.ITHINK_API_URL) {
            try {
                const urlObj = new URL(process.env.ITHINK_API_URL);
                baseHost = urlObj.hostname;
            }
            catch (e) {
                if (process.env.ITHINK_API_URL.includes("pre-alpha")) {
                    baseHost = "pre-alpha.ithinklogistics.com";
                }
                else {
                    baseHost = "my.ithinklogistics.com";
                }
            }
        }
        const fullPath = `/api_v3/${endpointPath}`;
        const postData = JSON.stringify(payload);
        const options = {
            hostname: baseHost,
            port: 443,
            path: fullPath,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(postData),
            },
        };
        const req = https_1.default.request(options, (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch (e) {
                    resolve(body);
                }
            });
        });
        req.on("error", (err) => reject(err));
        req.write(postData);
        req.end();
    });
};
/**
 * Helper to format date as YYYY-MM-DD HH:MM:SS
 */
const formatDateTime = (date) => {
    const pad = (n) => n.toString().padStart(2, "0");
    return (date.getFullYear() +
        "-" +
        pad(date.getMonth() + 1) +
        "-" +
        pad(date.getDate()) +
        " " +
        pad(date.getHours()) +
        ":" +
        pad(date.getMinutes()) +
        ":" +
        pad(date.getSeconds()));
};
/**
 * POST /api/logistics/orders/:orderId/ship
 * Books a shipment consignment on iThink Logistics and updates Order status
 */
const shipOrderWithiThink = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { weight, length, width, height } = req.body;
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        const order = await Order_model_1.default.findById(orderId).populate("user");
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        if (order.shipmentStatus === "Shipped") {
            return res.status(400).json({
                success: false,
                message: "Order has already been shipped with tracking AWB: " + order.awbNumber
            });
        }
        const user = order.user;
        const customerName = (user?.name || "Valued Customer").replace(/[^a-zA-Z ]/g, "").trim();
        const customerEmail = user?.email || "customer@artiory.com";
        // Dynamically retrieve user shipping address from addresses collection
        const db = mongoose_1.default.connection.db;
        let shippingAddress = "Default Shipping Address";
        let shippingPin = 400001;
        let customerPhone = user?.number || "9999999999";
        if (db) {
            const addressDoc = await db.collection("addresses").findOne({ userId: order.user });
            if (addressDoc) {
                shippingAddress = `${addressDoc.home}, ${addressDoc.street}, ${addressDoc.city}, ${addressDoc.state}, ${addressDoc.country}`.trim();
                shippingPin = Number(addressDoc.postalCode?.toString().replace(/\D/g, "")) || 400001;
                if (addressDoc.phone) {
                    customerPhone = addressDoc.phone;
                }
            }
        }
        let calculatedWeight = 0;
        let maxLength = 0;
        let maxWidth = 0;
        let totalHeight = 0;
        for (const item of order.orderItems) {
            const product = await Product_model_1.default.findById(item.productId);
            if (product) {
                const qty = Number(item.qty || 1);
                const pWeight = Number(product.weight || 0.1);
                calculatedWeight += pWeight * qty;
                const pLength = Number(product.dimensions?.length || 10);
                const pWidth = Number(product.dimensions?.width || 10);
                const pHeight = Number(product.dimensions?.height || 2);
                maxLength = Math.max(maxLength, pLength);
                maxWidth = Math.max(maxWidth, pWidth);
                totalHeight += pHeight * qty;
            }
        }
        if (calculatedWeight <= 0)
            calculatedWeight = 0.5;
        if (maxLength <= 0)
            maxLength = 10;
        if (maxWidth <= 0)
            maxWidth = 10;
        if (totalHeight <= 0)
            totalHeight = 10;
        const finalShipmentLength = Number(length) || maxLength;
        const finalShipmentWidth = Number(width) || maxWidth;
        const finalShipmentHeight = Number(height) || totalHeight;
        const finalShipmentWeight = Number(weight) || (Math.round(calculatedWeight * 100) / 100);
        const formattedDate = formatDateTime(new Date());
        // Construct iThink v3 payload
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                shipments: [
                    {
                        order: order._id.toString(),
                        order_date: formattedDate,
                        total_amount: order.totalPrice,
                        name: customerName,
                        add: shippingAddress,
                        pin: shippingPin,
                        phone: customerPhone,
                        billing_name: customerName,
                        billing_add: shippingAddress,
                        billing_pin: shippingPin,
                        billing_phone: customerPhone,
                        is_billing_same_as_shipping: "yes",
                        products: order.orderItems.map((item) => ({
                            product_name: item.name,
                            product_quantity: item.qty.toString(),
                            product_price: item.price.toString(),
                            product_sku: item.productId.toString().slice(-8),
                            product_tax_rate: "0",
                            product_discount: "0",
                            product_hsn_code: "6204"
                        })),
                        shipment_length: finalShipmentLength,
                        shipment_width: finalShipmentWidth,
                        shipment_height: finalShipmentHeight,
                        weight: finalShipmentWeight,
                        shipment_service_type: "Standard",
                        shipping_service_type: "Standard",
                        service_type: "Standard",
                        pickup_address_id: Number(ITHINK_PICKUP_ADDRESS_ID)
                    }
                ]
            }
        };
        if (process.env.ITHINK_BYPASS === "true") {
            console.log("ITHINK_BYPASS active. Simulating successful order booking.");
            const awbNumber = `ITL${Date.now().toString().slice(-8)}`;
            const courierName = "Delhivery (Mock)";
            const shippingLabelUrl = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
            order.awbNumber = awbNumber;
            order.courierName = courierName;
            order.shippingLabelUrl = shippingLabelUrl;
            order.shipmentStatus = "Shipped";
            await order.save();
            return res.status(200).json({
                success: true,
                message: "Shipment booked successfully (Mock)",
                awbNumber,
                courierName,
                shippingLabelUrl
            });
        }
        console.log("iThink Order Add Payload:", JSON.stringify(payload));
        const apiResponse = await postToiThink("order/add.json", payload);
        console.log("iThink Order Add Response:", JSON.stringify(apiResponse));
        if (apiResponse && apiResponse.status_code === 200 && apiResponse.data) {
            // Extract the shipment status mapping
            const keys = Object.keys(apiResponse.data);
            const firstShipmentKey = keys[0];
            const shipmentResult = firstShipmentKey ? apiResponse.data[firstShipmentKey] : null;
            if (shipmentResult && (shipmentResult.status === "success" || shipmentResult.status === "Success")) {
                const awbNumber = shipmentResult.awb_number || shipmentResult.refnum;
                const courierName = shipmentResult.courier_name || "iThink Logistics Partner";
                const logisticsOrderId = shipmentResult.order_id || "N/A";
                // Fetch Shipping Label
                let shippingLabelUrl = "";
                try {
                    const labelPayload = {
                        data: {
                            access_token: ITHINK_ACCESS_TOKEN,
                            secret_key: ITHINK_SECRET_KEY,
                            awb_numbers: awbNumber
                        }
                    };
                    const labelResponse = await postToiThink("shipping/label.json", labelPayload);
                    if (labelResponse && labelResponse.status_code === 200 && labelResponse.data) {
                        shippingLabelUrl = labelResponse.data.label_url || "";
                    }
                }
                catch (labelErr) {
                    console.error("Failed to fetch shipping label:", labelErr);
                }
                // Update local database order document
                order.awbNumber = awbNumber;
                order.courierName = courierName;
                order.logisticsOrderId = logisticsOrderId;
                order.shipmentStatus = "Shipped";
                if (shippingLabelUrl) {
                    order.shippingLabelUrl = shippingLabelUrl;
                }
                await order.save();
                return res.status(200).json({
                    success: true,
                    message: "Shipment booked successfully!",
                    awbNumber,
                    courierName,
                    shippingLabelUrl
                });
            }
            else {
                const errorMsg = shipmentResult?.remark || "Failed to process consignment on iThink Logistics";
                return res.status(400).json({ success: false, message: errorMsg });
            }
        }
        else {
            const errorMsg = apiResponse?.remark || apiResponse?.html_message || "Logistics booking failed";
            return res.status(400).json({ success: false, message: errorMsg });
        }
    }
    catch (err) {
        console.error("Ship Order Error:", err);
        return res.status(500).json({ success: false, message: err.message || "Internal server error" });
    }
};
exports.shipOrderWithiThink = shipOrderWithiThink;
/**
 * GET /api/logistics/shipments/:awbNumber/track
 * Retrieves live consignment tracking milestones from iThink Logistics
 */
const trackiThinkShipment = async (req, res) => {
    try {
        const { awbNumber } = req.params;
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                awb_number_list: awbNumber
            }
        };
        const trackingResponse = await postToiThink("order/track.json", payload);
        console.log("iThink Tracking Response:", JSON.stringify(trackingResponse));
        if (trackingResponse && trackingResponse.status_code === 200 && trackingResponse.data) {
            return res.status(200).json({
                success: true,
                data: trackingResponse.data
            });
        }
        else {
            const errorMsg = trackingResponse?.remark || "Failed to retrieve tracking details";
            return res.status(400).json({ success: false, message: errorMsg });
        }
    }
    catch (err) {
        console.error("Track Shipment Error:", err);
        return res.status(500).json({ success: false, message: err.message || "Internal server error" });
    }
};
exports.trackiThinkShipment = trackiThinkShipment;
/**
 * POST /api/logistics/pincode-check
 * Checks if a specific destination pincode is serviceable by iThink Logistics
 */
const checkPincodeServiceability = async (req, res) => {
    try {
        const { pincode } = req.body;
        if (!pincode) {
            return res.status(400).json({ success: false, message: "Pincode is required" });
        }
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(200).json({
                success: true,
                serviceable: true,
                message: "Logistics credentials not configured. Defaulting to serviceable."
            });
        }
        const fromPincode = 400001; // Default warehouse pickup pincode
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                from_pincode: fromPincode,
                to_pincode: Number(pincode)
            }
        };
        console.log("iThink Pincode Check Payload:", JSON.stringify(payload));
        const response = await postToiThink("pincode/check.json", payload);
        console.log("iThink Pincode Check Response:", JSON.stringify(response));
        const isStaging = process.env.ITHINK_API_URL?.includes("pre-alpha") || false;
        if (isStaging) {
            // Staging/Sandbox mode: Allow order placement regardless of sandbox serviceability constraints
            return res.status(200).json({
                success: true,
                serviceable: true,
                cod: true,
                city: response?.city || "Staging City",
                state: response?.state || "Staging State",
                message: "Staging sandbox mode: Allowed for testing."
            });
        }
        if (response && response.status_code === 200 && response.data) {
            const dataKeys = Object.keys(response.data);
            let serviceable = false;
            let codAvailable = false;
            if (response.data.is_serviceable !== undefined) {
                serviceable = response.data.is_serviceable === "Yes" || response.data.is_serviceable === "yes" || response.data.is_serviceable === 1;
                codAvailable = response.data.cod === "Yes" || response.data.cod === "yes" || response.data.cod === 1;
            }
            else {
                for (const key of dataKeys) {
                    const courier = response.data[key];
                    if (courier && (courier.is_serviceable === "Yes" || courier.is_serviceable === "yes" || courier.status === "success")) {
                        serviceable = true;
                        if (courier.cod === "Yes" || courier.cod === "yes") {
                            codAvailable = true;
                        }
                    }
                }
            }
            return res.status(200).json({
                success: true,
                serviceable,
                cod: codAvailable,
                city: response.city || "",
                state: response.state || ""
            });
        }
        else {
            return res.status(200).json({
                success: true,
                serviceable: false,
                message: response?.remark || "Not serviceable"
            });
        }
    }
    catch (err) {
        console.error("Pincode Serviceability Check Error:", err);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};
exports.checkPincodeServiceability = checkPincodeServiceability;
/**
 * POST /api/logistics/shipping-charge
 * Calculates shipping charges for a checkout based on destination pincode and cart total
 */
const getShippingCharge = async (req, res) => {
    try {
        const { pincode, totalPrice, orderItems } = req.body;
        if (!pincode) {
            return res.status(400).json({ success: false, message: "Pincode is required" });
        }
        const defaultShippingCharge = 40.0; // Fallback shipping charge
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(200).json({
                success: true,
                shippingCharge: defaultShippingCharge,
                message: "Logistics credentials not configured. Using default flat rate."
            });
        }
        let calculatedWeight = 0;
        let maxLength = 0;
        let maxWidth = 0;
        let totalHeight = 0;
        if (Array.isArray(orderItems) && orderItems.length > 0) {
            for (const item of orderItems) {
                const product = await Product_model_1.default.findById(item.productId);
                if (product) {
                    const qty = Number(item.qty || 1);
                    const pWeight = Number(product.weight || 0.1);
                    calculatedWeight += pWeight * qty;
                    const pLength = Number(product.dimensions?.length || 10);
                    const pWidth = Number(product.dimensions?.width || 10);
                    const pHeight = Number(product.dimensions?.height || 2);
                    maxLength = Math.max(maxLength, pLength);
                    maxWidth = Math.max(maxWidth, pWidth);
                    totalHeight += pHeight * qty;
                }
            }
        }
        if (calculatedWeight <= 0)
            calculatedWeight = 0.5;
        if (maxLength <= 0)
            maxLength = 10;
        if (maxWidth <= 0)
            maxWidth = 10;
        if (totalHeight <= 0)
            totalHeight = 10;
        const finalWeight = Math.round(calculatedWeight * 100) / 100;
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                from_pincode: 400001,
                to_pincode: Number(pincode),
                shipping_length_cms: maxLength,
                shipping_width_cms: maxWidth,
                shipping_height_cms: totalHeight,
                shipping_weight_kg: finalWeight,
                shipping_weight: finalWeight,
                payment_method: "Prepaid",
                order_type: "Forward",
                product_mrp: Number(totalPrice || 100)
            }
        };
        console.log("iThink Rate Check Payload:", JSON.stringify(payload));
        const response = await postToiThink("rate/check.json", payload);
        console.log("iThink Rate Check Response:", JSON.stringify(response));
        if (response && response.status_code === 200 && response.data) {
            const couriers = Object.keys(response.data);
            let minimumRate = Infinity;
            // Extract destination zone if provided by the API
            const detectedZone = response.zone || response.logistics_zone || response.data?.zone || response.data?.logistics_zone || "";
            for (const name of couriers) {
                const courierData = response.data[name];
                if (courierData) {
                    // 1. Try direct rate first
                    let rateVal = parseFloat(courierData.rate || courierData.total_rate || courierData.charge || courierData.price || "");
                    // 2. Fallback to specific destination zone rate if direct rate is missing
                    if (isNaN(rateVal) && detectedZone) {
                        rateVal = parseFloat(courierData[detectedZone]);
                    }
                    // 3. General fallback to first available zone rate
                    if (isNaN(rateVal)) {
                        const zones = ["A", "B", "C", "D", "E", "F"];
                        for (const zone of zones) {
                            const zoneVal = parseFloat(courierData[zone]);
                            if (!isNaN(zoneVal)) {
                                rateVal = zoneVal;
                                break;
                            }
                        }
                    }
                    if (!isNaN(rateVal) && rateVal > 0 && rateVal < minimumRate) {
                        minimumRate = rateVal;
                    }
                }
            }
            if (minimumRate !== Infinity) {
                const shippingCharge = Math.ceil(minimumRate);
                return res.status(200).json({
                    success: true,
                    shippingCharge,
                    message: "Shipping charge calculated successfully"
                });
            }
        }
        const isStaging = process.env.ITHINK_API_URL?.includes("pre-alpha") || false;
        if (isStaging) {
            return res.status(200).json({
                success: true,
                shippingCharge: 40.0,
                message: "Staging sandbox: Pincode not serviceable but allowed for testing."
            });
        }
        return res.status(400).json({
            success: false,
            message: "Delivery is not available to this pincode."
        });
    }
    catch (err) {
        console.error("Calculate Shipping Charge Error:", err);
        const isStaging = process.env.ITHINK_API_URL?.includes("pre-alpha") || false;
        if (isStaging) {
            return res.status(200).json({
                success: true,
                shippingCharge: 40.0,
                message: "Staging sandbox error: Allowed for testing."
            });
        }
        return res.status(400).json({
            success: false,
            message: "Delivery is not available to this pincode."
        });
    }
};
exports.getShippingCharge = getShippingCharge;
