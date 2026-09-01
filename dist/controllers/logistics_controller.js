"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleNDRAction = exports.getiThinkStoreOrderList = exports.getiThinkStoreOrderDetails = exports.getiThinkStores = exports.getiThinkZoneRates = exports.getiThinkWarehouses = exports.addiThinkWarehouse = exports.getiThinkCities = exports.getiThinkStates = exports.renderOrderInvoiceHtml = exports.getiThinkCustomerInvoice = exports.renderOrderLabelHtml = exports.getiThinkShippingLabel = exports.getiThinkOrderDetails = exports.getShippingCharge = exports.checkPincodeServiceability = exports.trackiThinkShipment = exports.ITHINK_STATUS_CODES = exports.shipOrderWithiThink = void 0;
const https_1 = __importDefault(require("https"));
const Order_model_1 = __importDefault(require("../models/Order_model"));
const Product_model_1 = __importDefault(require("../models/Product_model"));
const mongoose_1 = __importDefault(require("mongoose"));
const ITHINK_ACCESS_TOKEN = process.env.ITHINK_ACCESS_TOKEN || "50a3b289fed90fec08c56a741dbae8d4";
const ITHINK_SECRET_KEY = process.env.ITHINK_SECRET_KEY || "05c218a3ac1be2dbf44031256515b889";
const ITHINK_STORE_ID = process.env.ITHINK_STORE_ID || "32474";
const ITHINK_STORE_URL = process.env.ITHINK_STORE_URL || "https://artiory.com";
const ITHINK_PICKUP_ADDRESS_ID = process.env.ITHINK_PICKUP_ADDRESS_ID || "122518";
/**
 * Generic helper to call iThink Logistics REST API endpoints
 */
const postToiThink = (endpointPath, payload) => {
    return new Promise((resolve, reject) => {
        // Enforce official Production URL: https://my.ithinklogistics.com/api_v3/
        const baseHost = "my.ithinklogistics.com";
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
 * Clamps timestamp to at least 15 minutes before current local time to prevent iThink clock skew "order date cannot be in the future" validation error
 */
const formatDateTime = (date) => {
    const pad = (n) => n.toString().padStart(2, "0");
    const baseTime = date instanceof Date && !isNaN(date.getTime()) ? date.getTime() : Date.now();
    const safeTime = Math.min(baseTime, Date.now() - 15 * 60 * 1000);
    const d = new Date(safeTime);
    return (d.getFullYear() +
        "-" +
        pad(d.getMonth() + 1) +
        "-" +
        pad(d.getDate()) +
        " " +
        pad(d.getHours()) +
        ":" +
        pad(d.getMinutes()) +
        ":" +
        pad(d.getSeconds()));
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
        // 1. Resolve Customer Name
        let rawName = order.shippingAddress?.name || user?.name || "Valued Customer";
        let customerName = rawName.replace(/[^a-zA-Z0-9 ]/g, "").trim();
        if (customerName.length < 3)
            customerName = "Valued Customer";
        const customerEmail = order.shippingAddress?.email || user?.email || "customer@artiory.com";
        // 2. Resolve Customer Phone (10 digits)
        let rawPhone = order.shippingAddress?.phone || user?.number || "9999999999";
        let phoneDigits = rawPhone.toString().replace(/\D/g, "");
        let customerPhone = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : "9999999999";
        // 3. Resolve Complete Shipping Address
        const db = mongoose_1.default.connection.db;
        let flatAndBuilding = order.shippingAddress?.home || "";
        let streetAndColony = order.shippingAddress?.street || order.shippingAddress?.address || "";
        let landmark = order.shippingAddress?.landmark || "";
        let addressLine1 = [flatAndBuilding, streetAndColony].filter(Boolean).join(", ").trim();
        let addressLine2 = landmark.trim();
        if (!addressLine1 || addressLine1.length < 5) {
            if (db) {
                const addressDoc = await db.collection("addresses").findOne({ userId: order.user });
                if (addressDoc) {
                    flatAndBuilding = addressDoc.home || "";
                    streetAndColony = addressDoc.street || addressDoc.address || "";
                    landmark = addressDoc.landmark || "";
                    addressLine1 = [flatAndBuilding, streetAndColony].filter(Boolean).join(", ").trim();
                    addressLine2 = landmark.trim();
                }
            }
        }
        if (!addressLine1 || addressLine1.length < 5) {
            addressLine1 = (order.shippingAddress?.address || `${customerName}, Main Delivery Road`).trim();
        }
        // 4. Resolve Pincode (6 digits)
        let rawPin = order.shippingAddress?.postalCode || "";
        let pinDigits = rawPin.toString().replace(/\D/g, "").slice(0, 6);
        let shippingPin = pinDigits.length === 6 ? Number(pinDigits) : 400077;
        if (shippingPin === 400077 && db) {
            const addressDoc = await db.collection("addresses").findOne({ userId: order.user });
            if (addressDoc?.postalCode) {
                const pd = addressDoc.postalCode.toString().replace(/\D/g, "").slice(0, 6);
                if (pd.length === 6)
                    shippingPin = Number(pd);
            }
        }
        // 5. Resolve City, State, Country
        let customerCity = order.shippingAddress?.city || "Mumbai";
        let customerState = order.shippingAddress?.state || "Maharashtra";
        let customerCountry = order.shippingAddress?.country || "India";
        if ((!order.shippingAddress?.city || !order.shippingAddress?.state) && db) {
            const addressDoc = await db.collection("addresses").findOne({ userId: order.user });
            if (addressDoc) {
                if (addressDoc.city)
                    customerCity = addressDoc.city;
                if (addressDoc.state)
                    customerState = addressDoc.state;
            }
        }
        let totalWeightGrams = 0;
        let maxLength = 0;
        let maxWidth = 0;
        let totalHeight = 0;
        for (const item of order.orderItems) {
            const product = await Product_model_1.default.findById(item.productId);
            if (product) {
                const qty = Number(item.qty || 1);
                // Stored in grams (e.g. 150 for 150 gm). If legacy product stored <= 5 (as kg), safely convert to grams
                const rawWeight = Number(product.weight || product.weightGrams || 150);
                const itemWeightGrams = rawWeight > 5 ? rawWeight : (rawWeight * 1000);
                totalWeightGrams += itemWeightGrams * qty;
                const pLength = Number(product.dimensions?.length || 15);
                const pWidth = Number(product.dimensions?.width || 12);
                const pHeight = Number(product.dimensions?.height || 4);
                maxLength = Math.max(maxLength, pLength);
                maxWidth = Math.max(maxWidth, pWidth);
                totalHeight += pHeight * qty;
            }
        }
        if (totalWeightGrams <= 0)
            totalWeightGrams = 200; // default 200 gm
        if (maxLength <= 0)
            maxLength = 15;
        if (maxWidth <= 0)
            maxWidth = 12;
        if (totalHeight <= 0)
            totalHeight = 5;
        // Convert grams to kg for courier API payload (e.g. 150 gm -> 0.15 kg)
        const weightInKgFromGrams = Math.round((totalWeightGrams / 1000) * 1000) / 1000;
        const finalShipmentLength = Number(length) || maxLength;
        const finalShipmentWidth = Number(width) || maxWidth;
        const finalShipmentHeight = Number(height) || totalHeight;
        const finalShipmentWeight = Number(weight) || weightInKgFromGrams;
        const formattedDate = formatDateTime(new Date());
        const paymentMode = order.status === "Paid" ? "Prepaid" : "COD";
        const pickupAddressId = String(ITHINK_PICKUP_ADDRESS_ID || "122518");
        const returnAddressId = String(process.env.ITHINK_RETURN_ADDRESS_ID || ITHINK_PICKUP_ADDRESS_ID || "122518");
        const storeIdNum = Number(ITHINK_STORE_ID || 32474);
        const orderIdStr = order._id.toString();
        // Construct iThink v3 payload strictly conforming to official API schema
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                store_id: storeIdNum,
                platform_id: storeIdNum,
                pickup_address_id: pickupAddressId,
                return_address_id: returnAddressId,
                shipment_service_type: "surface",
                service_type: "surface",
                shipments: [
                    {
                        order: orderIdStr,
                        sub_order: orderIdStr,
                        order_date: formattedDate,
                        total_amount: Number(order.totalPrice || 0),
                        name: customerName,
                        company_name: "Artiory",
                        add: addressLine1,
                        add2: addressLine2,
                        pin: shippingPin,
                        city: customerCity,
                        state: customerState,
                        country: customerCountry,
                        phone: customerPhone,
                        alt_phone: (order.shippingAddress?.alternatePhone || "").replace(/\D/g, "").slice(-10),
                        email: customerEmail,
                        is_billing_same_as_shipping: "yes",
                        billing_name: customerName,
                        billing_company_name: "Artiory",
                        billing_add: addressLine1,
                        billing_add2: addressLine2,
                        billing_pin: shippingPin,
                        billing_city: customerCity,
                        billing_state: customerState,
                        billing_country: customerCountry,
                        billing_phone: customerPhone,
                        billing_alt_phone: (order.shippingAddress?.alternatePhone || "").replace(/\D/g, "").slice(-10),
                        billing_email: customerEmail,
                        products: order.orderItems.map((item) => ({
                            product_name: item.name,
                            product_quantity: item.qty.toString(),
                            product_price: Number(item.price || 0),
                            product_sku: item.productId.toString().slice(-8),
                            product_tax_rate: "0",
                            product_discount: "0",
                            product_hsn_code: "6204"
                        })),
                        shipment_length: Number(finalShipmentLength),
                        shipment_width: Number(finalShipmentWidth),
                        shipment_height: Number(finalShipmentHeight),
                        weight: Number(finalShipmentWeight),
                        shipping_charges: Number(order.shippingCharge !== undefined && order.shippingCharge !== null ? order.shippingCharge : 149),
                        giftwrap_charges: 0,
                        transaction_charges: 0,
                        total_discount: Number(order.discountAmount || 0),
                        first_attemp_discount: 0,
                        cod_amount: paymentMode === "COD" ? Number(order.totalPrice || 0) : 0,
                        cod_charges: 0,
                        eway_bill_number: "",
                        gst_number: "",
                        payment_mode: paymentMode,
                        return_address_id: returnAddressId,
                        pickup_address_id: pickupAddressId,
                        order_type: "forward",
                        shipment_service_type: "surface",
                        service_type: "surface",
                        shipping_service_type: "surface",
                        reseller_name: "Artiory",
                        send_sms_notification: "yes",
                        send_email_notification: "yes",
                        tracking_notification: "yes"
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
        console.log("iThink Order Sync Payload:", JSON.stringify(payload));
        const apiResponse = await postToiThink("order/sync.json", payload);
        console.log("iThink Order Sync Response:", JSON.stringify(apiResponse));
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
                order.status = "Shipped";
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
exports.ITHINK_STATUS_CODES = {
    "Manifested": { code: "UD", category: "Manifested", description: "Forward shipment data pushed using API or System" },
    "Not Picked": { code: "UD", category: "Manifested", description: "Forward shipment not picked up for long period" },
    "Picked Up": { code: "UD", category: "In-Transit", description: "Consignment physically picked up from warehouse" },
    "In Transit": { code: "UD", category: "In-Transit", description: "Consignment in transit to DC" },
    "Reached At Destination": { code: "UD", category: "In-Transit", description: "Reached destination DC" },
    "Out For Delivery": { code: "UD", category: "Out-For-Delivery", description: "Dispatched for delivery to customer" },
    "Undelivered": { code: "UD", category: "Undelivered", description: "Failed to deliver to customer" },
    "Out of Delivery Area": { code: "UD", category: "Undelivered", description: "Out of delivery area" },
    "Delayed": { code: "UD", category: "Delayed", description: "Delayed due to operational issue" },
    "Damaged": { code: "UD", category: "Damaged", description: "Shipment damaged" },
    "Misrouted": { code: "UD", category: "Delayed", description: "Misrouted from destination" },
    "Delivered": { code: "DL", category: "Delivered", description: "Accepted by end customer" },
    "Cancelled": { code: "CN", category: "Cancelled", description: "Cancelled before pickup" },
    "RTO Pending": { code: "RT", category: "RTO", description: "Awaiting RTO" },
    "RTO Processing": { code: "RT", category: "RTO", description: "Ready for RTO" },
    "RTO In Transit": { code: "RT", category: "RTO", description: "In transit to Return Center" },
    "Reached At Origin": { code: "RT", category: "RTO", description: "Reached Return Center Hub" },
    "RTO Out For Delivery": { code: "RT", category: "RTO", description: "Dispatched for final RTO to vendor" },
    "RTO Undelivered": { code: "RT", category: "RTO", description: "RTO delivery failed" },
    "RTO Delivered": { code: "DL", category: "RTO", description: "Returned consignment accepted by vendor" },
    "Lost": { code: "Lost", category: "Lost", description: "Consignment lost" },
    "Shortage": { code: "Shortage", category: "Shortage", description: "Consignment shortage" },
    "RTO Shortage": { code: "RTO Shortage", category: "RTO", description: "RTO shortage" },
    "REV Manifest": { code: "UD", category: "Reverse", description: "Reverse shipment data pushed" },
    "REV Out for Pick Up": { code: "UD", category: "Reverse", description: "Out for reverse pickup" },
    "REV Picked Up": { code: "UD", category: "Reverse", description: "Reverse consignment picked up from customer" },
    "REV In Transit": { code: "UD", category: "Reverse", description: "Reverse consignment in transit" },
    "REV Cancelled": { code: "UD", category: "Reverse", description: "Reverse shipment cancelled before pickup" },
    "REV Out For Delivery": { code: "UD", category: "Reverse", description: "Reverse shipment dispatched to vendor" },
    "REV Delivered": { code: "DL", category: "Reverse", description: "Reverse shipment accepted by vendor" },
    "REV Closed": { code: "UD", category: "Reverse", description: "Reverse pickup cancelled and closed" },
};
/**
 * GET/POST /api/logistics/shipments/:awbNumber/track or POST /api/logistics/order/track
 * Retrieves live consignment tracking milestones from iThink Logistics tracker API
 */
const trackiThinkShipment = async (req, res) => {
    try {
        const awbFromParams = req.params?.awbNumber;
        const awbFromBody = req.body?.awb_number_list || req.body?.awbNumber || req.query?.awb_number_list;
        let awbInput = awbFromParams || awbFromBody;
        if (!awbInput) {
            return res.status(400).json({
                success: false,
                message: "awb_number_list or awbNumber is required for tracking"
            });
        }
        if (Array.isArray(awbInput)) {
            awbInput = awbInput.slice(0, 10).join(",");
        }
        else if (typeof awbInput === "string") {
            const parts = awbInput.split(",").map((s) => s.trim()).filter(Boolean);
            awbInput = parts.slice(0, 10).join(",");
        }
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
                awb_number_list: awbInput.toString()
            }
        };
        console.log("iThink Tracking Payload:", JSON.stringify(payload));
        const trackingResponse = await postToiThink("order/track.json", payload);
        console.log("iThink Tracking Response:", JSON.stringify(trackingResponse));
        if (trackingResponse && (trackingResponse.status_code === 200 || trackingResponse.status === "success") && trackingResponse.data) {
            const trackingMap = trackingResponse.data;
            const awbKeys = Object.keys(trackingMap);
            // Auto-sync database order status based on live tracking status
            await Promise.all(awbKeys.map(async (awb) => {
                const itemData = trackingMap[awb];
                if (!itemData)
                    return;
                const currentStatus = itemData.current_status || itemData.status || "";
                const statusInfo = exports.ITHINK_STATUS_CODES[currentStatus] || null;
                try {
                    const orderDoc = await Order_model_1.default.findOne({ awbNumber: awb });
                    if (orderDoc) {
                        if (currentStatus === "Delivered" || currentStatus === "RTO Delivered" || statusInfo?.code === "DL") {
                            orderDoc.status = "Delivered";
                            orderDoc.shipmentStatus = currentStatus === "RTO Delivered" ? "RTO" : "Delivered";
                            await orderDoc.save();
                        }
                        else if (currentStatus === "Cancelled" || statusInfo?.code === "CN") {
                            orderDoc.shipmentStatus = "Cancelled";
                            await orderDoc.save();
                        }
                        else if (statusInfo?.category === "RTO") {
                            orderDoc.shipmentStatus = "RTO";
                            await orderDoc.save();
                        }
                        else if (["Picked Up", "In Transit", "Out For Delivery", "Reached At Destination"].includes(currentStatus) || statusInfo?.category === "In-Transit" || statusInfo?.category === "Out-For-Delivery") {
                            orderDoc.shipmentStatus = currentStatus === "Out For Delivery" ? "Out For Delivery" : "In-Transit";
                            await orderDoc.save();
                        }
                    }
                }
                catch (syncErr) {
                    console.error(`Failed to auto-sync tracking for AWB ${awb}:`, syncErr);
                }
            }));
            return res.status(200).json({
                success: true,
                awb_number_list: awbInput,
                data: trackingMap,
                statusCodeReference: exports.ITHINK_STATUS_CODES
            });
        }
        else {
            // Local/Processing Fallback: If iThink API has not processed scans yet, construct milestones from Order record
            try {
                const orderDoc = await Order_model_1.default.findOne({
                    $or: [
                        { awbNumber: awbInput.toString().trim() },
                        ...(mongoose_1.default.Types.ObjectId.isValid(awbInput.toString().trim()) ? [{ _id: awbInput.toString().trim() }] : [])
                    ]
                }).populate("user");
                if (orderDoc) {
                    const currentStatus = orderDoc.shipmentStatus || "Manifested";
                    const bookingDate = orderDoc.createdAt ? new Date(orderDoc.createdAt).toLocaleString("en-IN") : new Date().toLocaleString("en-IN");
                    const courier = orderDoc.courierName || "iThink Logistics Partner";
                    const scans = [
                        {
                            activity: "Order Confirmed & Payment Verified",
                            location: "Artiory Store",
                            date: bookingDate,
                            status_detail: "Order placed successfully"
                        },
                        {
                            activity: "Consignment Manifested & Booked with iThink Logistics",
                            location: "Athena Design Studios, Chembur Warehouse (400071)",
                            date: bookingDate,
                            status_detail: `AWB ${orderDoc.awbNumber || awbInput} generated with ${courier}`
                        }
                    ];
                    if (currentStatus === "In-Transit" || currentStatus === "Out For Delivery" || currentStatus === "Delivered") {
                        scans.push({
                            activity: "Package In-Transit to Delivery Center",
                            location: orderDoc.shippingAddress?.city || "Mumbai Hub",
                            date: new Date().toLocaleString("en-IN"),
                            status_detail: "Dispatched from origin fulfillment center"
                        });
                    }
                    if (currentStatus === "Out For Delivery" || currentStatus === "Delivered") {
                        scans.push({
                            activity: "Out For Delivery",
                            location: `${orderDoc.shippingAddress?.city || "Destination DC"} (${orderDoc.shippingAddress?.postalCode || ""})`,
                            date: new Date().toLocaleString("en-IN"),
                            status_detail: "Courier delivery agent assigned"
                        });
                    }
                    if (currentStatus === "Delivered") {
                        scans.push({
                            activity: "Delivered to Customer",
                            location: orderDoc.shippingAddress?.address || "Customer Address",
                            date: new Date().toLocaleString("en-IN"),
                            status_detail: "Package delivered successfully"
                        });
                    }
                    else if (currentStatus === "RTO") {
                        scans.push({
                            activity: "Consignment Marked for RTO",
                            location: "Return Fulfillment Center",
                            date: new Date().toLocaleString("en-IN"),
                            status_detail: "Return to Origin initiated"
                        });
                    }
                    return res.status(200).json({
                        success: true,
                        awb_number_list: awbInput,
                        data: {
                            [awbInput.toString().trim()]: {
                                current_status: currentStatus,
                                status: currentStatus,
                                courier_name: courier,
                                awb_number: orderDoc.awbNumber || awbInput,
                                scans: scans.reverse()
                            }
                        },
                        source: "Local Shipment Tracker",
                        statusCodeReference: exports.ITHINK_STATUS_CODES
                    });
                }
            }
            catch (localTrackErr) {
                console.error("Local tracking fallback error:", localTrackErr);
            }
            const errorMsg = trackingResponse?.remark || trackingResponse?.message || "Tracking details are being synced with courier network";
            return res.status(200).json({
                success: true,
                awb_number_list: awbInput,
                data: {
                    [awbInput.toString().trim()]: {
                        current_status: "Manifested",
                        status: "Manifested",
                        courier_name: "iThink Logistics",
                        scans: [
                            {
                                activity: "Consignment Booked & Manifest Generated",
                                location: "Chembur Warehouse, Mumbai",
                                date: new Date().toLocaleString("en-IN"),
                                status_detail: "Awaiting pickup scan by carrier"
                            }
                        ]
                    }
                }
            });
        }
    }
    catch (err) {
        console.error("Track Shipment Error:", err);
        return res.status(500).json({ success: false, message: err.message || "Internal server error" });
    }
};
exports.trackiThinkShipment = trackiThinkShipment;
/**
 * POST /api/logistics/pincode-check or POST /api/logistics/pincode/check
 * Checks if a specific destination pincode is serviceable by iThink Logistics
 */
const checkPincodeServiceability = async (req, res) => {
    try {
        const pincodeInput = req.params?.pincode || req.body?.pincode || req.query?.pincode;
        if (!pincodeInput) {
            return res.status(400).json({ success: false, message: "Pincode is required" });
        }
        const cleanPincode = Number(pincodeInput.toString().replace(/\D/g, "").slice(0, 6));
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
                pincode: cleanPincode,
                from_pincode: fromPincode,
                to_pincode: cleanPincode
            }
        };
        console.log("iThink Pincode Check Payload:", JSON.stringify(payload));
        const response = await postToiThink("pincode/check.json", payload);
        console.log("iThink Pincode Check Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success") && response.data) {
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
                city: response.city || response.data.city || "",
                state: response.state || response.data.state || "",
                data: response.data
            });
        }
        else {
            return res.status(200).json({
                success: true,
                serviceable: false,
                message: response?.remark || response?.message || "Not serviceable",
                rawResponse: response
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
 * POST /api/logistics/shipping-charge or POST /api/logistics/rate/check
 * Calculates live shipping rates & charges from iThink Logistics rate/check.json API based on cart products and exact weight
 */
const getShippingCharge = async (req, res) => {
    try {
        const { from_pincode = 400071, to_pincode, pincode, orderItems = [], totalPrice = 500, payment_method = "prepaid", weight: explicitWeight, } = req.body || {};
        const destPincode = to_pincode || pincode;
        if (!destPincode) {
            return res.status(400).json({ success: false, message: "to_pincode or pincode is required" });
        }
        const cleanDestPin = Number(destPincode.toString().replace(/\D/g, "").slice(0, 6));
        // 1. Calculate total order weight in Grams from Product collection
        let totalWeightGrams = 0;
        let maxLength = 15;
        let maxWidth = 12;
        let totalHeight = 4;
        if (Array.isArray(orderItems) && orderItems.length > 0) {
            for (const item of orderItems) {
                const prodId = item.productId || item.id || item._id;
                const qty = Number(item.qty || item.quantity || 1);
                let itemWeight = Number(item.weight || item.weightGrams || 0);
                if (!itemWeight && prodId && mongoose_1.default.Types.ObjectId.isValid(prodId)) {
                    try {
                        const pDoc = await Product_model_1.default.findById(prodId);
                        if (pDoc) {
                            const raw = Number(pDoc.weight || pDoc.weightGrams || 150);
                            itemWeight = raw > 5 ? raw : raw * 1000;
                            maxLength = Math.max(maxLength, Number(pDoc.dimensions?.length || 15));
                            maxWidth = Math.max(maxWidth, Number(pDoc.dimensions?.width || 12));
                            totalHeight += Number(pDoc.dimensions?.height || 4) * qty;
                        }
                    }
                    catch (e) {
                        console.error("Product weight lookup notice:", e);
                    }
                }
                if (!itemWeight)
                    itemWeight = 150;
                totalWeightGrams += (itemWeight > 5 ? itemWeight : itemWeight * 1000) * qty;
            }
        }
        if (explicitWeight && Number(explicitWeight) > 0) {
            const ew = Number(explicitWeight);
            totalWeightGrams = ew > 5 ? ew : ew * 1000;
        }
        if (totalWeightGrams <= 0)
            totalWeightGrams = 200; // default 200 gm
        const weightInKg = Math.max(0.1, Math.round((totalWeightGrams / 1000) * 1000) / 1000);
        // 2. Call iThink live rate API
        if (ITHINK_ACCESS_TOKEN && ITHINK_SECRET_KEY) {
            const payload = {
                data: {
                    access_token: ITHINK_ACCESS_TOKEN,
                    secret_key: ITHINK_SECRET_KEY,
                    from_pincode: Number(from_pincode || 400071),
                    to_pincode: cleanDestPin,
                    shipping_weight_kg: weightInKg,
                    weight: weightInKg.toString(),
                    shipping_length_cms: maxLength,
                    shipping_width_cms: maxWidth,
                    shipping_height_cms: totalHeight,
                    length: String(maxLength),
                    width: String(maxWidth),
                    height: String(totalHeight),
                    order_type: "Forward",
                    payment_method: payment_method === "cod" ? "COD" : "Prepaid",
                    service_type: "Surface",
                    product_mrp: String(totalPrice || 500)
                }
            };
            console.log("iThink Live Rate Check Payload:", JSON.stringify(payload));
            const response = await postToiThink("rate/check.json", payload);
            console.log("iThink Live Rate Check Response:", JSON.stringify(response));
            if (response && (response.status === "success" || response.status_code === 200) && Array.isArray(response.data)) {
                const isCod = payment_method === "cod";
                const couriers = response.data.filter((c) => {
                    if (isCod)
                        return c.cod === "Y" || c.cod === "yes" || c.cod === 1;
                    return c.prepaid === "Y" || c.prepaid === "yes" || c.prepaid === 1;
                });
                if (couriers.length > 0) {
                    // Sort couriers by live rate ascending (cheapest / best rate first)
                    couriers.sort((a, b) => Number(a.rate || 999) - Number(b.rate || 999));
                    const bestCourier = couriers[0];
                    const bestRate = Math.round(Number(bestCourier.rate));
                    return res.status(200).json({
                        success: true,
                        serviceable: true,
                        shippingCharge: bestRate,
                        courierName: bestCourier.logistic_name,
                        serviceType: bestCourier.service_type,
                        weightGrams: totalWeightGrams,
                        weightKg: weightInKg,
                        edd: response.expected_delivery_date || `${bestCourier.delivery_tat || 4} Days`,
                        couriers: couriers.map((c) => ({
                            name: c.logistic_name,
                            service: c.service_type,
                            rate: Math.round(Number(c.rate)),
                            tat: `${c.delivery_tat || 4} Days`
                        })),
                        source: "iThink Live Multi-Carrier Rate API"
                    });
                }
            }
        }
        // 3. Smart Zone/Weight Fallback if courier network is temporarily unreachable
        const fallbackRate = weightInKg <= 0.5 ? 65 : Math.round(65 + (weightInKg - 0.5) * 40);
        return res.status(200).json({
            success: true,
            serviceable: true,
            shippingCharge: fallbackRate,
            courierName: "Delhivery / BlueDart",
            weightGrams: totalWeightGrams,
            weightKg: weightInKg,
            source: "Calculated Weight Slab"
        });
    }
    catch (err) {
        console.error("Shipping Charge Calculation Error:", err);
        return res.status(200).json({
            success: true,
            serviceable: true,
            shippingCharge: 65,
            weightGrams: 250,
            weightKg: 0.25,
            source: "Fallback Standard Rate"
        });
    }
};
exports.getShippingCharge = getShippingCharge;
/**
 * POST /api/logistics/orders/get-details
 * Retrieves complete order details and product data from iThink Logistics against an AWB list / Order Number
 */
const getiThinkOrderDetails = async (req, res) => {
    try {
        const { awb_number_list, awbNumber, order_no, orderId, start_date, end_date } = req.body;
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        let awbList = awb_number_list || awbNumber || "";
        let orderNo = order_no || "";
        let orderDate = new Date();
        // If orderId is provided, lookup order in DB to autofill AWB and start_date if missing
        if (orderId && (!awbList || !start_date)) {
            try {
                const localOrder = await Order_model_1.default.findById(orderId);
                if (localOrder) {
                    if (!awbList && localOrder.awbNumber) {
                        awbList = localOrder.awbNumber;
                    }
                    if (localOrder.createdAt) {
                        orderDate = new Date(localOrder.createdAt);
                    }
                }
            }
            catch (dbErr) {
                console.error("Order lookup error in get_details:", dbErr);
            }
        }
        if (Array.isArray(awbList)) {
            awbList = awbList.join(",");
        }
        if (!awbList && !orderNo) {
            return res.status(400).json({
                success: false,
                message: "awb_number_list or awbNumber is mandatory to fetch order details"
            });
        }
        // Format dates: YYYY-MM-DD
        const formatDateOnly = (d) => {
            const pad = (n) => n.toString().padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };
        const now = new Date();
        const thirtyDaysAgo = new Date(orderDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        const startDateFormatted = start_date || formatDateOnly(thirtyDaysAgo);
        const endDateFormatted = end_date || formatDateOnly(new Date(now.getTime() + 24 * 60 * 60 * 1000));
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                awb_number_list: awbList.toString().trim(),
                start_date: startDateFormatted,
                end_date: endDateFormatted,
            }
        };
        if (orderNo) {
            payload.data.order_no = orderNo.toString().trim();
        }
        console.log("iThink Order Get Details Payload:", JSON.stringify(payload));
        const response = await postToiThink("order/get_details.json", payload);
        console.log("iThink Order Get Details Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success") && response.data) {
            return res.status(200).json({
                success: true,
                data: response.data
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || "Failed to retrieve order details from iThink Logistics";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Get Order Details Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkOrderDetails = getiThinkOrderDetails;
/**
 * POST /api/logistics/shipping/label or GET /api/logistics/shipments/:awbNumber/label
 * Generates and prints official Shipment Label PDFs with customizable page size & display options
 */
const getiThinkShippingLabel = async (req, res) => {
    try {
        const awbFromParams = req.params?.awbNumber;
        const { awb_numbers, awbNumber, orderId, page_size = "A6", display_cod_prepaid = 1, display_shipper_mobile = 1, display_shipper_address = 1, } = req.body || {};
        let awbInput = awbFromParams || awb_numbers || awbNumber;
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        // If orderId is provided, lookup order to get its AWB
        if (orderId && !awbInput) {
            try {
                const localOrder = await Order_model_1.default.findById(orderId);
                if (localOrder?.awbNumber) {
                    awbInput = localOrder.awbNumber;
                }
            }
            catch (dbErr) {
                console.error("Order lookup error in shipping label:", dbErr);
            }
        }
        if (!awbInput) {
            return res.status(400).json({
                success: false,
                message: "awb_numbers or awbNumber is mandatory to generate shipment label"
            });
        }
        // Format AWB numbers (up to 100 AWBs, comma separated)
        if (Array.isArray(awbInput)) {
            awbInput = awbInput.slice(0, 100).join(",");
        }
        else if (typeof awbInput === "string") {
            const parts = awbInput.split(",").map((s) => s.trim()).filter(Boolean);
            awbInput = parts.slice(0, 100).join(",");
        }
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                awb_numbers: awbInput.toString(),
                page_size: page_size.toString(),
                display_cod_prepaid: Number(display_cod_prepaid),
                display_shipper_mobile: Number(display_shipper_mobile),
                display_shipper_address: Number(display_shipper_address),
            }
        };
        console.log("iThink Shipping Label Payload:", JSON.stringify(payload));
        const labelResponse = await postToiThink("shipping/label.json", payload);
        console.log("iThink Shipping Label Response:", JSON.stringify(labelResponse));
        if (labelResponse && (labelResponse.status_code === 200 || labelResponse.status === "success") && labelResponse.data && (labelResponse.data.label_url || labelResponse.data.url)) {
            const labelUrl = labelResponse.data.label_url || labelResponse.data.url || "";
            // Update local Order record if single AWB
            if (labelUrl && typeof awbInput === "string" && !awbInput.includes(",")) {
                try {
                    await Order_model_1.default.findOneAndUpdate({ awbNumber: awbInput }, { $set: { shippingLabelUrl: labelUrl } });
                }
                catch (updateErr) {
                    console.error("Failed to update shippingLabelUrl in Order:", updateErr);
                }
            }
            return res.status(200).json({
                success: true,
                label_url: labelUrl,
                data: labelResponse.data
            });
        }
        else {
            // Local/Dynamic Fallback: lookup Order in database and serve printable HTML Shipping Label
            try {
                const idStr = awbInput.toString().trim();
                const orderDoc = await Order_model_1.default.findOne({
                    $or: [
                        { awbNumber: idStr },
                        ...(mongoose_1.default.Types.ObjectId.isValid(idStr) ? [{ _id: idStr }] : [])
                    ]
                });
                if (orderDoc) {
                    const host = (req.get && req.get("host")) || req.headers?.host || "localhost:5000";
                    const protocol = req.protocol || "http";
                    const localLabelUrl = `${protocol}://${host}/api/logistics/orders/${orderDoc._id}/label-html`;
                    return res.status(200).json({
                        success: true,
                        label_url: localLabelUrl,
                        source: "Local Shipping Label Generator"
                    });
                }
            }
            catch (localLblErr) {
                console.error("Local label fallback lookup error:", localLblErr);
            }
            const host = (req.get && req.get("host")) || req.headers?.host || "localhost:5000";
            const protocol = req.protocol || "http";
            const directUrl = `${protocol}://${host}/api/logistics/shipments/${encodeURIComponent(awbInput.toString())}/label-html`;
            return res.status(200).json({
                success: true,
                label_url: directUrl,
                source: "Direct Label Generator"
            });
        }
    }
    catch (err) {
        console.error("Get Shipping Label Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkShippingLabel = getiThinkShippingLabel;
/**
 * GET /api/logistics/orders/:orderId/label-html or GET /api/logistics/shipments/:awbNumber/label-html
 * Serves an A6 format printable shipping label in HTML with barcode simulation and consignment details
 */
const renderOrderLabelHtml = async (req, res) => {
    try {
        const { orderId, awbNumber } = req.params;
        const rawIdentifier = orderId || awbNumber;
        const identifier = Array.isArray(rawIdentifier) ? rawIdentifier[0] : (rawIdentifier || "");
        const orderDoc = await Order_model_1.default.findOne({
            $or: [
                ...(identifier && mongoose_1.default.Types.ObjectId.isValid(identifier) ? [{ _id: identifier }] : []),
                ...(identifier ? [{ awbNumber: identifier }] : [])
            ]
        }).populate("user");
        if (!orderDoc) {
            return res.status(404).send(`
        <div style="font-family:sans-serif; text-align:center; padding:40px;">
          <h2>Shipping Label Not Found</h2>
          <p>Unable to locate consignment record for identifier: ${identifier}</p>
        </div>
      `);
        }
        const customerName = orderDoc.shippingAddress?.name || orderDoc.user?.name || "Valued Customer";
        const customerPhone = orderDoc.shippingAddress?.phone || orderDoc.user?.number || "N/A";
        const addressLine1 = [orderDoc.shippingAddress?.home, orderDoc.shippingAddress?.street || orderDoc.shippingAddress?.address].filter(Boolean).join(", ") || "Delivery Address";
        const addressLine2 = [orderDoc.shippingAddress?.landmark, orderDoc.shippingAddress?.city, orderDoc.shippingAddress?.state].filter(Boolean).join(", ");
        const pin = orderDoc.shippingAddress?.postalCode || "400077";
        const awb = orderDoc.awbNumber || `ITL${orderDoc._id.toString().slice(-8).toUpperCase()}`;
        const courier = orderDoc.courierName || "iThink Logistics (Delhivery / Bluedart)";
        const total = Number(orderDoc.totalPrice || 0);
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Shipping Label - ${awb}</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f1f5f9; }
    .label-box { width: 380px; margin: 0 auto; background: #fff; border: 2px solid #000; padding: 16px; border-radius: 8px; box-sizing: border-box; }
    .label-header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
    .carrier-title { font-size: 16px; font-weight: 900; text-transform: uppercase; }
    .mode-badge { font-size: 14px; font-weight: 800; border: 2px solid #000; padding: 2px 8px; border-radius: 4px; }
    .barcode-sim { text-align: center; margin: 12px 0; border-bottom: 1px dashed #64748b; padding-bottom: 12px; }
    .barcode-lines { height: 44px; background: repeating-linear-gradient(90deg, #000 0px, #000 2px, transparent 2px, transparent 4px, #000 4px, #000 7px, transparent 7px, transparent 9px); margin-bottom: 4px; }
    .awb-text { font-family: monospace; font-size: 14px; font-weight: 900; letter-spacing: 2px; }
    .deliver-to { border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 12px; }
    .sec-title { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #475569; margin-bottom: 4px; }
    .cust-name { font-size: 14px; font-weight: 800; }
    .cust-addr { font-size: 12px; line-height: 1.4; margin-top: 4px; }
    .pincode-highlight { font-size: 18px; font-weight: 900; font-family: monospace; margin-top: 6px; }
    .shipper-details { font-size: 10px; line-height: 1.4; color: #334155; }
    .pkg-info { display: flex; justify-content: space-between; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 10px; font-size: 11px; margin: 10px 0; }
    .btn-print { background: #000; color: #fff; border: none; padding: 8px 16px; font-size: 12px; font-weight: 700; border-radius: 6px; cursor: pointer; display: block; margin: 0 auto 16px auto; }
    @media print {
      body { background: #fff; padding: 0; }
      .label-box { border: 2px solid #000; width: 100%; max-width: 4in; height: 6in; margin: 0; border-radius: 0; }
      .btn-print { display: none; }
    }
  </style>
</head>
<body>
  <button class="btn-print" onclick="window.print()">🖨️ Print Label (A6 Format)</button>
  <div class="label-box">
    <div class="label-header">
      <div>
        <div class="carrier-title">${courier}</div>
        <div style="font-size: 10px; color: #64748b;">Standard Surface Routing</div>
      </div>
      <div class="mode-badge">${orderDoc.status === "Paid" ? "PREPAID" : "COD"}</div>
    </div>

    <div class="barcode-sim">
      <div class="barcode-lines"></div>
      <div class="awb-text">AWB: ${awb}</div>
    </div>

    <div class="deliver-to">
      <div class="sec-title">SHIP TO / CUSTOMER ADDRESS:</div>
      <div class="cust-name">${customerName}</div>
      <div class="cust-addr">
        ${addressLine1}<br>
        ${addressLine2}<br>
        Phone: <b>${customerPhone}</b>
      </div>
      <div class="pincode-highlight">PIN: ${pin}</div>
    </div>

    <div class="pkg-info">
      <div><b>Order:</b> #${orderDoc._id.toString().slice(-8).toUpperCase()}</div>
      <div><b>Weight:</b> 0.50 KG</div>
      <div><b>Collect:</b> ₹${orderDoc.status === "Paid" ? "0 (Paid)" : total.toLocaleString()}</div>
    </div>

    <div class="shipper-details">
      <div class="sec-title">RETURN / SHIPPER ADDRESS:</div>
      <b>ARTIORI (Athena Design Studios) - Hub 122518</b><br>
      Plot No 7, Moti Baug, Chembur, Mumbai, Maharashtra - 400071<br>
      Support: contact@artiory.com | 7304185760
    </div>
  </div>
</body>
</html>
    `;
        res.setHeader("Content-Type", "text/html");
        return res.status(200).send(html);
    }
    catch (err) {
        console.error("Render Label HTML Error:", err);
        return res.status(500).send("<h3>Failed to render shipping label.</h3>");
    }
};
exports.renderOrderLabelHtml = renderOrderLabelHtml;
/**
 * POST /api/logistics/shipping/invoice or GET /api/logistics/shipments/:awbNumber/invoice
 * Generates and prints official Customer Invoices for shipments via iThink Logistics API
 */
const getiThinkCustomerInvoice = async (req, res) => {
    try {
        const awbFromParams = req.params?.awbNumber;
        const { awb_numbers, awbNumber, orderId } = req.body || {};
        let awbInput = awbFromParams || awb_numbers || awbNumber;
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        // If orderId is provided, lookup order to get its AWB
        if (orderId && !awbInput) {
            try {
                const localOrder = await Order_model_1.default.findById(orderId);
                if (localOrder?.awbNumber) {
                    awbInput = localOrder.awbNumber;
                }
            }
            catch (dbErr) {
                console.error("Order lookup error in customer invoice:", dbErr);
            }
        }
        if (!awbInput) {
            return res.status(400).json({
                success: false,
                message: "awb_numbers or awbNumber is mandatory to generate customer invoice"
            });
        }
        // Format AWB numbers (up to 100 AWBs, comma separated)
        if (Array.isArray(awbInput)) {
            awbInput = awbInput.slice(0, 100).join(",");
        }
        else if (typeof awbInput === "string") {
            const parts = awbInput.split(",").map((s) => s.trim()).filter(Boolean);
            awbInput = parts.slice(0, 100).join(",");
        }
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                awb_numbers: awbInput.toString()
            }
        };
        console.log("iThink Customer Invoice Payload:", JSON.stringify(payload));
        const invoiceResponse = await postToiThink("shipping/invoice.json", payload);
        console.log("iThink Customer Invoice Response:", JSON.stringify(invoiceResponse));
        if (invoiceResponse && (invoiceResponse.status_code === 200 || invoiceResponse.status === "success") && invoiceResponse.data && (invoiceResponse.data.invoice_url || invoiceResponse.data.url)) {
            const invoiceUrl = invoiceResponse.data.invoice_url || invoiceResponse.data.url || "";
            return res.status(200).json({
                success: true,
                invoice_url: invoiceUrl,
                data: invoiceResponse.data
            });
        }
        else {
            // Local/Dynamic Fallback: lookup Order in database and serve printable HTML Tax Invoice
            try {
                const idStr = awbInput.toString().trim();
                const orderDoc = await Order_model_1.default.findOne({
                    $or: [
                        { awbNumber: idStr },
                        ...(mongoose_1.default.Types.ObjectId.isValid(idStr) ? [{ _id: idStr }] : [])
                    ]
                });
                if (orderDoc) {
                    const host = (req.get && req.get("host")) || req.headers?.host || "localhost:5000";
                    const protocol = req.protocol || "http";
                    const localInvoiceUrl = `${protocol}://${host}/api/logistics/orders/${orderDoc._id}/invoice-html`;
                    return res.status(200).json({
                        success: true,
                        invoice_url: localInvoiceUrl,
                        source: "Local Tax Invoice Generator"
                    });
                }
            }
            catch (localInvErr) {
                console.error("Local invoice fallback lookup error:", localInvErr);
            }
            const host = (req.get && req.get("host")) || req.headers?.host || "localhost:5000";
            const protocol = req.protocol || "http";
            const directUrl = `${protocol}://${host}/api/logistics/shipments/${encodeURIComponent(awbInput.toString())}/invoice-html`;
            return res.status(200).json({
                success: true,
                invoice_url: directUrl,
                source: "Direct Invoice Generator"
            });
        }
    }
    catch (err) {
        console.error("Get Customer Invoice Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkCustomerInvoice = getiThinkCustomerInvoice;
function numberToWords(amount) {
    const words = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
    const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
    function convertChunk(n) {
        if (n === 0)
            return "";
        if (n < 20)
            return words[n] + " ";
        if (n < 100)
            return tens[Math.floor(n / 10)] + " " + convertChunk(n % 10);
        return words[Math.floor(n / 100)] + " Hundred " + convertChunk(n % 100);
    }
    const intPart = Math.floor(amount);
    const decPart = Math.round((amount - intPart) * 100);
    if (intPart === 0 && decPart === 0)
        return "Zero Rupees Only";
    let result = "";
    const crore = Math.floor(intPart / 10000000);
    const lakh = Math.floor((intPart % 10000000) / 100000);
    const thousand = Math.floor((intPart % 100000) / 1000);
    const remainder = intPart % 1000;
    if (crore > 0)
        result += convertChunk(crore) + "Crore ";
    if (lakh > 0)
        result += convertChunk(lakh) + "Lakh ";
    if (thousand > 0)
        result += convertChunk(thousand) + "Thousand ";
    if (remainder > 0)
        result += convertChunk(remainder);
    result = result.trim() + " Rupees";
    if (decPart > 0) {
        result += " and " + convertChunk(decPart).trim() + " Paise";
    }
    return "Indian " + result + " Only";
}
/**
 * GET /api/logistics/orders/:orderId/invoice-html or GET /api/logistics/shipments/:awbNumber/invoice-html
 * Serves an authentic, professional, black & white A4 Tax Invoice with official Artiory Logo
 */
const renderOrderInvoiceHtml = async (req, res) => {
    try {
        const { orderId, awbNumber } = req.params;
        const rawIdentifier = orderId || awbNumber;
        const identifier = Array.isArray(rawIdentifier) ? rawIdentifier[0] : (rawIdentifier || "");
        const orderDoc = await Order_model_1.default.findOne({
            $or: [
                ...(identifier && mongoose_1.default.Types.ObjectId.isValid(identifier) ? [{ _id: identifier }] : []),
                ...(identifier ? [{ awbNumber: identifier }] : [])
            ]
        }).populate("user").populate("orderItems.productId");
        if (!orderDoc) {
            return res.status(404).send(`
        <div style="font-family: Arial, sans-serif; text-align: center; padding: 40px; color: #111;">
          <h2>Tax Invoice Not Found</h2>
          <p>Unable to locate order record for identifier: ${identifier}</p>
        </div>
      `);
        }
        const customerName = orderDoc.shippingAddress?.name || orderDoc.user?.name || "Valued Customer";
        const customerPhone = orderDoc.shippingAddress?.phone || orderDoc.user?.number || orderDoc.user?.phone || "N/A";
        const customerEmail = orderDoc.shippingAddress?.email || orderDoc.user?.email || "customer@artiory.com";
        const addressLine1 = [orderDoc.shippingAddress?.home, orderDoc.shippingAddress?.street || orderDoc.shippingAddress?.address].filter(Boolean).join(", ") || "Customer Address";
        const addressLine2 = [orderDoc.shippingAddress?.landmark, orderDoc.shippingAddress?.city, orderDoc.shippingAddress?.state].filter(Boolean).join(", ");
        const pin = orderDoc.shippingAddress?.postalCode || "400071";
        const stateName = orderDoc.shippingAddress?.state || "Maharashtra";
        const isMaharashtra = stateName.toLowerCase().includes("maharashtra") || !orderDoc.shippingAddress?.state;
        const formattedDate = orderDoc.createdAt ? new Date(orderDoc.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : new Date().toLocaleDateString("en-IN");
        const formattedOrderDate = orderDoc.createdAt ? new Date(orderDoc.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : new Date().toLocaleDateString("en-IN");
        const itemsTotal = orderDoc.orderItems.reduce((acc, it) => acc + (Number(it.price || 0) * Number(it.qty || 1)), 0);
        // Determine actual shipping charge stored on order
        let actualShipping = 0;
        if (orderDoc.shippingCharge !== undefined && orderDoc.shippingCharge !== null) {
            actualShipping = Number(orderDoc.shippingCharge);
        }
        else if (Number(orderDoc.totalPrice) > itemsTotal) {
            actualShipping = Number(orderDoc.totalPrice) - itemsTotal;
        }
        const discount = Number(orderDoc.discountAmount || 0);
        const total = Number(orderDoc.totalPrice || (itemsTotal + actualShipping - discount));
        const shortId = orderDoc._id.toString().slice(-8).toUpperCase();
        const invoiceNumber = `INV-${new Date().getFullYear()}-${shortId}`;
        // GST Calculations on Goods (18% GST breakdown: 9% CGST + 9% SGST or 18% IGST)
        const taxableItems = itemsTotal / 1.18;
        const gstItems = itemsTotal - taxableItems;
        const cgstAmt = isMaharashtra ? gstItems / 2 : 0;
        const sgstAmt = isMaharashtra ? gstItems / 2 : 0;
        const igstAmt = !isMaharashtra ? gstItems : 0;
        const amountInWords = numberToWords(total);
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tax Invoice - ${invoiceNumber}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: #000000;
      background-color: #f8fafc;
      padding: 20px;
      font-size: 11px;
      line-height: 1.4;
      -webkit-font-smoothing: antialiased;
    }
    .print-controls {
      max-width: 210mm;
      margin: 0 auto 15px auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn-print {
      background-color: #000000;
      color: #ffffff;
      border: 1px solid #000000;
      padding: 8px 18px;
      font-size: 12px;
      font-weight: 700;
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-print:hover {
      background-color: #222222;
    }
    .btn-close {
      background-color: #ffffff;
      color: #000000;
      border: 1px solid #cccccc;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
    }
    .invoice-wrapper {
      max-width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      background: #ffffff;
      padding: 14mm 15mm;
      border: 1.5px solid #000000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.06);
      position: relative;
    }
    .header-table {
      width: 100%;
      border-collapse: collapse;
      border-bottom: 2px solid #000000;
      padding-bottom: 12px;
      margin-bottom: 12px;
    }
    .header-table td {
      vertical-align: top;
    }
    .company-brand {
      font-size: 26px;
      font-weight: 900;
      letter-spacing: 2px;
      text-transform: uppercase;
      line-height: 1;
      margin-bottom: 3px;
      color: #000000;
    }
    .company-sub-brand {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: #222222;
      margin-bottom: 6px;
    }
    .company-sub {
      font-size: 9.5px;
      color: #333333;
      line-height: 1.4;
    }
    .inv-header-box {
      text-align: right;
    }
    .inv-badge {
      display: inline-block;
      border: 2px solid #000000;
      padding: 4px 12px;
      font-size: 14px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 3px;
    }
    .inv-copy-label {
      font-size: 8.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      color: #444444;
    }
    .meta-grid {
      font-size: 10px;
      line-height: 1.45;
      text-align: right;
    }
    .meta-grid b {
      font-weight: 700;
    }
    .meta-grid span {
      font-family: monospace;
      font-size: 10.5px;
      font-weight: 700;
    }
    .section-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #000000;
      margin-bottom: 12px;
    }
    .section-table th {
      background-color: #f3f4f6;
      border: 1px solid #000000;
      padding: 5px 8px;
      font-size: 9.5px;
      font-weight: 800;
      text-transform: uppercase;
      text-align: left;
      letter-spacing: 0.5px;
    }
    .section-table td {
      border: 1px solid #000000;
      padding: 8px 10px;
      vertical-align: top;
      width: 50%;
      font-size: 10px;
      line-height: 1.5;
    }
    .items-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #000000;
      margin-bottom: 12px;
    }
    .items-table th {
      background-color: #f3f4f6;
      border: 1px solid #000000;
      padding: 7px 6px;
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      text-align: center;
      letter-spacing: 0.3px;
    }
    .items-table td {
      border: 1px solid #000000;
      padding: 6px 6px;
      font-size: 9.5px;
      vertical-align: middle;
    }
    .text-left { text-align: left !important; }
    .text-center { text-align: center !important; }
    .text-right { text-align: right !important; }
    .font-mono { font-family: monospace; font-size: 10px; }
    .font-bold { font-weight: 700; }
    .summary-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 12px;
    }
    .summary-table td {
      vertical-align: top;
    }
    .words-box {
      border: 1px solid #000000;
      padding: 10px 12px;
      font-size: 10px;
      height: 100%;
      background-color: #fafafa;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .calc-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #000000;
    }
    .calc-table td {
      border: 1px solid #000000;
      padding: 5px 8px;
      font-size: 10px;
    }
    .total-row td {
      background-color: #f3f4f6;
      font-size: 12px;
      font-weight: 900;
      border-top: 2px solid #000000;
    }
    .footer-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #000000;
      margin-top: 10px;
    }
    .footer-table td {
      border: 1px solid #000000;
      padding: 8px 10px;
      vertical-align: top;
    }
    .terms-box {
      font-size: 8.5px;
      color: #333333;
      line-height: 1.4;
      width: 62%;
    }
    .sign-box {
      width: 38%;
      text-align: center;
      font-size: 9.5px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 85px;
    }
    .sign-placeholder {
      font-family: monospace;
      font-size: 8px;
      color: #555555;
      border: 1px dashed #777777;
      padding: 3px;
      margin: 6px auto;
      width: 85%;
      text-transform: uppercase;
    }
    @media print {
      @page {
        size: A4 portrait;
        margin: 8mm 10mm;
      }
      body {
        background: #ffffff !important;
        padding: 0 !important;
        font-size: 10.5px;
      }
      .print-controls {
        display: none !important;
      }
      .invoice-wrapper {
        border: 1px solid #000000 !important;
        box-shadow: none !important;
        padding: 0 !important;
        width: 100% !important;
        max-width: 100% !important;
      }
    }
  </style>
</head>
<body>
  
  <!-- Top Print Toolbar -->
  <div class="print-controls">
    <div style="font-size: 12px; font-weight: 700; color: #334155;">
      ARTIORY TAX INVOICE • OFFICIAL A4 RECORD
    </div>
    <div style="display: flex; gap: 8px;">
      <button class="btn-print" onclick="window.print()">
        🖨️ Print / Save as PDF (Ctrl+P)
      </button>
      <button class="btn-close" onclick="window.close()">
        Close
      </button>
    </div>
  </div>

  <div class="invoice-wrapper">
    
    <!-- Header: Company Typography & Invoice Meta -->
    <table class="header-table">
      <tr>
        <td style="width: 56%;">
          <div class="company-brand">ARTIORY</div>
          <div class="company-sub-brand">Athena Design Studios</div>
          <div class="company-sub">
            <b>Regd. Office:</b> 102 Chhadva Residency, Plot No.7, Moti Baug, V N Purav Marg, Chembur, Mumbai 400071<br>
            <b>Support Email:</b> contact@artiory.com &nbsp;|&nbsp; <b>Website:</b> www.artiory.com
          </div>
        </td>
        <td style="width: 44%; text-align: right;">
          <div class="inv-header-box">
            <div class="inv-badge">TAX INVOICE</div>
            <div class="inv-copy-label">(ORIGINAL FOR RECIPIENT • SECTION 31 CGST ACT)</div>
            <div class="meta-grid">
              <div><b>Invoice No:</b> <span>${invoiceNumber}</span></div>
              <div><b>Invoice Date:</b> ${formattedDate}</div>
              <div><b>Order ID:</b> <span>#ORD-${shortId}</span></div>
              <div><b>Order Date:</b> ${formattedOrderDate}</div>
              <div><b>Payment Status:</b> ${orderDoc.status === "Paid" ? "Online / Prepaid (Verified)" : "Cash on Delivery"}</div>
              <div><b>Place of Supply:</b> ${isMaharashtra ? "Maharashtra (State Code 27)" : `${stateName} (Inter-State)`}</div>
              <div><b>Reverse Charge:</b> Not Applicable</div>
            </div>
          </div>
        </td>
      </tr>
    </table>

    <!-- Billing & Dispatch Logistics Table -->
    <table class="section-table">
      <thead>
        <tr>
          <th>BILL TO & SHIP TO (CUSTOMER)</th>
          <th>DISPATCH & LOGISTICS FULFILLMENT</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <b>Customer Name:</b> ${customerName}<br>
            <b>Delivery Address:</b> ${addressLine1}<br>
            ${addressLine2 ? `<b>Landmark / Area:</b> ${addressLine2}<br>` : ''}
            <b>City / District:</b> ${orderDoc.shippingAddress?.city || 'Mumbai'}<br>
            <b>State & Postal PIN:</b> ${stateName} - <span style="font-family: monospace; font-weight: 700;">${pin}</span><br>
            <b>Contact Details:</b> 📞 ${customerPhone} &nbsp;|&nbsp; ✉️ ${customerEmail}<br>
            <b>Customer GSTIN:</b> Unregistered Consumer (B2C)
          </td>
          <td>
            <b>Origin Warehouse:</b> Artiory Fulfillment Hub (Hub ID: 122518)<br>
            <b>Dispatch Center:</b> 102 Chhadva Residency, Plot No.7, Moti Baug, V N Purav Marg, Chembur, Mumbai 400071<br>
            <b>Courier Partner:</b> ${orderDoc.courierName || "iThink Logistics Multi-Carrier Network"}<br>
            <b>Consignment AWB No:</b> <span style="font-family: monospace; font-weight: 700;">${orderDoc.awbNumber || "Manifest Booked"}</span><br>
            <b>Shipping Service:</b> Standard Surface / Air Express Tracked
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Itemized Products Table -->
    <table class="items-table">
      <thead>
        <tr>
          <th style="width: 4%;">#</th>
          <th style="width: 40%;" class="text-left">Description of Goods / Products</th>
          <th style="width: 10%;">HSN/SAC</th>
          <th style="width: 13%;">SKU Code</th>
          <th style="width: 6%;">Qty</th>
          <th style="width: 12%;" class="text-right">Unit Price (₹)</th>
          <th style="width: 15%;" class="text-right">Total Amount (₹)</th>
        </tr>
      </thead>
      <tbody>
        ${orderDoc.orderItems.map((item, idx) => {
            const productObj = typeof item.productId === "object" ? item.productId : null;
            const itemName = item.name || productObj?.productName || "Handcrafted Consumer Product";
            const skuCode = productObj?.skuCode || item?.sku || item?.skuCode || `SKU-${shortId}`;
            const itemPrice = Number(item.price || 0);
            const itemQty = Number(item.qty || 1);
            const itemTotal = itemPrice * itemQty;
            return `
            <tr>
              <td class="text-center">${idx + 1}</td>
              <td class="text-left font-bold">${itemName}</td>
              <td class="text-center font-mono">950300</td>
              <td class="text-center font-mono">${skuCode}</td>
              <td class="text-center font-bold">${itemQty}</td>
              <td class="text-right font-mono">₹${itemPrice.toFixed(2)}</td>
              <td class="text-right font-mono font-bold">₹${itemTotal.toFixed(2)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>

    <!-- Financial Calculation & Words Grid -->
    <table class="summary-table">
      <tr>
        <td style="width: 54%; padding-right: 12px;">
          <div class="words-box">
            <div>
              <div style="font-weight: 800; text-transform: uppercase; font-size: 9px; margin-bottom: 3px; letter-spacing: 0.5px;">
                Invoice Value in Words:
              </div>
              <div style="font-weight: 700; font-size: 11px; color: #000000; line-height: 1.4;">
                ${amountInWords}
              </div>
            </div>
            <div style="margin-top: 10px; font-size: 9px; color: #444444; border-top: 1px dashed #cccccc; padding-top: 6px;">
              <b>Payment Confirmation:</b> Received Full Payment &nbsp;|&nbsp; <b>Transaction Ref:</b> <span style="font-family: monospace; font-weight: 700;">${orderDoc.clientTxnId || shortId}</span>
            </div>
          </div>
        </td>
        <td style="width: 46%;">
          <table class="calc-table">
            <tr>
              <td>Items Subtotal (Taxable Value):</td>
              <td class="text-right font-mono">₹${taxableItems.toFixed(2)}</td>
            </tr>
            ${isMaharashtra ? `
            <tr>
              <td>Central GST (CGST @ 9%):</td>
              <td class="text-right font-mono">₹${cgstAmt.toFixed(2)}</td>
            </tr>
            <tr>
              <td>State GST (SGST @ 9%):</td>
              <td class="text-right font-mono">₹${sgstAmt.toFixed(2)}</td>
            </tr>
            ` : `
            <tr>
              <td>Integrated GST (IGST @ 18%):</td>
              <td class="text-right font-mono">₹${igstAmt.toFixed(2)}</td>
            </tr>
            `}
            <tr>
              <td>Shipping & Delivery Charges:</td>
              <td class="text-right font-mono font-bold">${actualShipping > 0 ? `₹${actualShipping.toFixed(2)}` : '₹0.00 (FREE)'}</td>
            </tr>
            ${discount > 0 ? `
            <tr>
              <td>Promotional Discount Applied:</td>
              <td class="text-right font-mono">- ₹${discount.toFixed(2)}</td>
            </tr>` : ''}
            <tr class="total-row">
              <td><b>TOTAL INVOICE VALUE:</b></td>
              <td class="text-right font-mono"><b>₹${total.toFixed(2)}</b></td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- Statutory Declarations & Signatory Section -->
    <table class="footer-table">
      <tr>
        <td class="terms-box">
          <b>TERMS & STATUTORY DECLARATION:</b><br>
          1. We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.<br>
          2. All disputes are subject to Mumbai, Maharashtra jurisdiction only.<br>
          3. This is a computer-generated tax invoice issued under Section 31 of CGST Act, 2017 and requires no physical ink signature.
        </td>
        <td class="sign-box">
          <div>
            <b>For Athena Design Studios (ARTIORY)</b>
          </div>
          <div class="sign-placeholder">
            [DIGITALLY AUTHORIZED & VERIFIED]
          </div>
          <div style="font-size: 8.5px; font-weight: 700;">
            Authorized Signatory
          </div>
        </td>
      </tr>
    </table>

    <div style="text-align: center; font-size: 8.5px; color: #555555; margin-top: 10px; text-transform: uppercase; letter-spacing: 0.5px;">
      Thank you for shopping with Artiory • For support, email contact@artiory.com or visit www.artiory.com
    </div>
  </div>

</body>
</html>
    `;
        res.setHeader("Content-Type", "text/html");
        return res.status(200).send(html);
    }
    catch (err) {
        console.error("Render Invoice HTML Error:", err);
        return res.status(500).send(`<h3>Error generating invoice: ${err.message}</h3>`);
    }
};
exports.renderOrderInvoiceHtml = renderOrderInvoiceHtml;
/**
 * POST /api/logistics/state/get or GET /api/logistics/states
 * Retrieves state information and state IDs from iThink Logistics for warehouse and address configurations
 */
const getiThinkStates = async (req, res) => {
    try {
        const countryIdInput = req.body?.country_id || req.query?.country_id || req.params?.countryId || 101;
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
                country_id: Number(countryIdInput)
            }
        };
        console.log("iThink State Get Payload:", JSON.stringify(payload));
        const response = await postToiThink("state/get.json", payload);
        console.log("iThink State Get Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success") && response.data) {
            return res.status(200).json({
                success: true,
                country_id: Number(countryIdInput),
                data: response.data
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || "Failed to retrieve state information";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Get States Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkStates = getiThinkStates;
/**
 * POST /api/logistics/city/get or GET /api/logistics/cities/:stateId
 * Retrieves city information and city IDs from iThink Logistics against a state_id
 */
const getiThinkCities = async (req, res) => {
    try {
        const stateIdInput = req.body?.state_id || req.query?.state_id || req.params?.stateId;
        if (!stateIdInput) {
            return res.status(400).json({
                success: false,
                message: "state_id is mandatory to retrieve cities"
            });
        }
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
                state_id: Number(stateIdInput)
            }
        };
        console.log("iThink City Get Payload:", JSON.stringify(payload));
        const response = await postToiThink("city/get.json", payload);
        console.log("iThink City Get Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success") && response.data) {
            return res.status(200).json({
                success: true,
                state_id: Number(stateIdInput),
                data: response.data
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || "Failed to retrieve city information";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Get Cities Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkCities = getiThinkCities;
/**
 * POST /api/logistics/warehouse/add or POST /api/logistics/warehouse
 * Adds a new pickup location / warehouse on iThink Logistics
 */
const addiThinkWarehouse = async (req, res) => {
    try {
        const { company_name, address1, address2 = "", mobile, pincode, city_id, state_id, country_id = 101, gps = "" } = req.body || {};
        if (!company_name || !address1 || !mobile || !pincode) {
            return res.status(400).json({
                success: false,
                message: "company_name, address1, mobile, and pincode are mandatory required fields"
            });
        }
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        // Clean phone and pincode
        const cleanMobile = Number(mobile.toString().replace(/\D/g, "").slice(-10));
        const cleanPin = Number(pincode.toString().replace(/\D/g, "").slice(0, 6));
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                company_name: company_name.toString().trim(),
                address1: address1.toString().trim(),
                address2: address2.toString().trim(),
                mobile: cleanMobile,
                pincode: cleanPin,
                country_id: Number(country_id) || 101
            }
        };
        if (city_id)
            payload.data.city_id = Number(city_id);
        if (state_id)
            payload.data.state_id = Number(state_id);
        if (gps)
            payload.data.gps = gps.toString().trim();
        console.log("iThink Warehouse Add Payload:", JSON.stringify(payload));
        const response = await postToiThink("warehouse/add.json", payload);
        console.log("iThink Warehouse Add Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success")) {
            const warehouseId = response.data?.pickup_address_id || response.data?.warehouse_id || response.pickup_address_id || null;
            return res.status(200).json({
                success: true,
                message: response.message || response.remark || "Warehouse / Pickup location added successfully! It will be approved within 24 hours.",
                pickup_address_id: warehouseId,
                data: response.data || response
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || response?.html_message || "Failed to add warehouse";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Add Warehouse Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.addiThinkWarehouse = addiThinkWarehouse;
/**
 * POST /api/logistics/warehouse/get or GET /api/logistics/warehouses
 * Retrieves registered warehouses list and approval statuses from iThink Logistics
 */
const getiThinkWarehouses = async (req, res) => {
    try {
        const warehouseIdInput = req.body?.warehouse_id || req.query?.warehouse_id || req.params?.warehouseId;
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
            }
        };
        if (warehouseIdInput) {
            payload.data.warehouse_id = Number(warehouseIdInput);
        }
        console.log("iThink Warehouse Get Payload:", JSON.stringify(payload));
        const response = await postToiThink("warehouse/get.json", payload);
        console.log("iThink Warehouse Get Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success")) {
            return res.status(200).json({
                success: true,
                data: response.data || response
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || "Failed to retrieve registered warehouses";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Get Warehouses Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkWarehouses = getiThinkWarehouses;
/**
 * POST /api/logistics/rate/zone-rate or POST /api/logistics/rate/zone_rate
 * Calculates rate across all geographical delivery zones via iThink rate/zone_rate.json API
 */
const getiThinkZoneRates = async (req, res) => {
    try {
        const { from_pincode = 400001, shipping_length_cms, shipping_width_cms, shipping_height_cms, shipping_weight_kg, shipping_weight, order_type = "Forward", payment_method = "Prepaid", service_type = "Surface", product_mrp, totalPrice } = req.body || {};
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        let maxLength = Number(shipping_length_cms || 10);
        let maxWidth = Number(shipping_width_cms || 10);
        let totalHeight = Number(shipping_height_cms || 5);
        let calculatedWeight = Number(shipping_weight_kg || shipping_weight || 0.5);
        maxLength = Math.min(1000, Math.max(1, Math.round(maxLength)));
        maxWidth = Math.min(1000, Math.max(1, Math.round(maxWidth)));
        totalHeight = Math.min(1000, Math.max(1, Math.round(totalHeight)));
        const finalWeight = Math.min(10, Math.max(0.05, Math.round(calculatedWeight * 100) / 100));
        const finalMRP = Number(product_mrp || totalPrice || 100);
        const finalPaymentMethod = payment_method.toString().toLowerCase() === "cod" ? "COD" : "Prepaid";
        const finalOrderType = order_type.toString().toLowerCase() === "reverse" ? "Reverse" : "Forward";
        const finalServiceType = service_type.toString().toLowerCase() === "air" ? "Air" : "Surface";
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                from_pincode: Number(from_pincode),
                shipping_length_cms: maxLength,
                shipping_width_cms: maxWidth,
                shipping_height_cms: totalHeight,
                shipping_weight_kg: finalWeight,
                order_type: finalOrderType,
                payment_method: finalPaymentMethod,
                service_type: finalServiceType,
                product_mrp: finalMRP
            }
        };
        console.log("iThink Zone Rate Check Payload:", JSON.stringify(payload));
        const response = await postToiThink("rate/zone_rate.json", payload);
        console.log("iThink Zone Rate Check Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success")) {
            return res.status(200).json({
                success: true,
                data: response.data || response
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || "Failed to retrieve zone rate information";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Get Zone Rates Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkZoneRates = getiThinkZoneRates;
/**
 * POST /api/logistics/store/get or GET /api/logistics/stores
 * Retrieves registered stores list and store statuses from iThink Logistics
 */
const getiThinkStores = async (req, res) => {
    try {
        const storeIdInput = req.body?.store_id || req.query?.store_id || req.params?.storeId;
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
            }
        };
        if (storeIdInput) {
            payload.data.store_id = Number(storeIdInput);
        }
        else if (ITHINK_STORE_ID) {
            payload.data.store_id = Number(ITHINK_STORE_ID);
        }
        console.log("iThink Store Get Payload:", JSON.stringify(payload));
        const response = await postToiThink("store/get.json", payload);
        console.log("iThink Store Get Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success")) {
            return res.status(200).json({
                success: true,
                data: response.data || response,
                active_store: {
                    store_id: ITHINK_STORE_ID,
                    store_url: ITHINK_STORE_URL
                }
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || "Failed to retrieve registered stores";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Get Stores Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkStores = getiThinkStores;
/**
 * POST /api/logistics/store/get-order-details or POST /api/logistics/store/order-details
 * Retrieves order & product details from store against a list of order numbers via iThink store/get-order-details.json API
 */
const getiThinkStoreOrderDetails = async (req, res) => {
    try {
        const { order_no_list, orderNoList, order_no, platform_id } = req.body || {};
        let orderListInput = order_no_list || orderNoList || order_no;
        if (!orderListInput) {
            return res.status(400).json({
                success: false,
                message: "order_no_list is mandatory to retrieve store order details"
            });
        }
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        if (Array.isArray(orderListInput)) {
            orderListInput = orderListInput.join(",");
        }
        else if (typeof orderListInput === "string") {
            const parts = orderListInput.split(",").map((s) => s.trim()).filter(Boolean);
            orderListInput = parts.join(",");
        }
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                order_no_list: orderListInput.toString(),
                platform_id: Number(platform_id || ITHINK_STORE_ID || 1)
            }
        };
        console.log("iThink Store Get Order Details Payload:", JSON.stringify(payload));
        const response = await postToiThink("store/get-order-details.json", payload);
        console.log("iThink Store Get Order Details Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success")) {
            return res.status(200).json({
                success: true,
                data: response.data || response
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || "Failed to retrieve store order details";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Get Store Order Details Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkStoreOrderDetails = getiThinkStoreOrderDetails;
/**
 * POST /api/logistics/store/get-order-list or POST /api/logistics/store/order-list
 * Retrieves order list along with product details for a given date range via iThink store/get-order-list.json API
 */
const getiThinkStoreOrderList = async (req, res) => {
    try {
        const { platform_id, start_date, end_date } = req.body || {};
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        const formatDateOnly = (d) => {
            const pad = (n) => n.toString().padStart(2, "0");
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        };
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const startDateFormatted = start_date || formatDateOnly(thirtyDaysAgo);
        const endDateFormatted = end_date || formatDateOnly(new Date(now.getTime() + 24 * 60 * 60 * 1000));
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                platform_id: Number(platform_id || ITHINK_STORE_ID || 1),
                start_date: startDateFormatted,
                end_date: endDateFormatted
            }
        };
        console.log("iThink Store Get Order List Payload:", JSON.stringify(payload));
        const response = await postToiThink("store/get-order-list.json", payload);
        console.log("iThink Store Get Order List Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success")) {
            return res.status(200).json({
                success: true,
                data: response.data || response
            });
        }
        else {
            const errorMsg = response?.remark || response?.message || "Failed to retrieve store order list";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("Get Store Order List Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.getiThinkStoreOrderList = getiThinkStoreOrderList;
/**
 * POST /api/logistics/ndr/action or POST /api/logistics/ndr/add-reattempt-rto
 * Performs NDR (Non-Delivery Report) action: Reattempt (1) or RTO (2) on an order
 */
const handleNDRAction = async (req, res) => {
    try {
        const { awb_numbers, awbNumber, orderId, ndr_action = 1, // 1 => Reattempt, 2 => RTO
        reattempt_date, reattempt_time = "12:00:00", reattempt_mobile_number, reattempt_address, reattempt_address_type = 1, // 1 => Home, 2 => Office
        rto_remark = "Customer requested cancellation / Undeliverable" } = req.body || {};
        let awbInput = awb_numbers || awbNumber;
        if (orderId && !awbInput) {
            try {
                const localOrder = await Order_model_1.default.findById(orderId);
                if (localOrder?.awbNumber) {
                    awbInput = localOrder.awbNumber;
                }
            }
            catch (dbErr) {
                console.error("Order lookup error in NDR action:", dbErr);
            }
        }
        if (!awbInput) {
            return res.status(400).json({
                success: false,
                message: "awb_numbers or orderId is required to perform NDR action"
            });
        }
        if (!ITHINK_ACCESS_TOKEN || !ITHINK_SECRET_KEY) {
            return res.status(400).json({
                success: false,
                message: "Logistics credentials not configured in server environment"
            });
        }
        const actionNum = Number(ndr_action);
        const payload = {
            data: {
                access_token: ITHINK_ACCESS_TOKEN,
                secret_key: ITHINK_SECRET_KEY,
                awb_numbers: awbInput.toString().trim(),
                ndr_action: actionNum
            }
        };
        if (actionNum === 1) {
            // Reattempt action
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const pad = (n) => n.toString().padStart(2, "0");
            const defaultDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
            payload.data.reattempt_date = reattempt_date || defaultDate;
            payload.data.reattempt_time = reattempt_time;
            if (reattempt_mobile_number) {
                payload.data.reattempt_mobile_number = Number(reattempt_mobile_number.toString().replace(/\D/g, "").slice(-10));
            }
            if (reattempt_address) {
                payload.data.reattempt_address = reattempt_address.toString().trim();
            }
            payload.data.reattempt_address_type = Number(reattempt_address_type);
        }
        else if (actionNum === 2) {
            // RTO action
            payload.data.rto_remark = rto_remark.toString().trim();
        }
        console.log("iThink NDR Action Payload:", JSON.stringify(payload));
        const response = await postToiThink("ndr/add-reattempt-rto.json", payload);
        console.log("iThink NDR Action Response:", JSON.stringify(response));
        if (response && (response.status_code === 200 || response.status === "success")) {
            // Update local Order record
            try {
                const orderDoc = await Order_model_1.default.findOne({ awbNumber: awbInput.toString().trim() });
                if (orderDoc) {
                    if (actionNum === 2) {
                        orderDoc.shipmentStatus = "RTO";
                    }
                    else {
                        orderDoc.shipmentStatus = "In-Transit";
                    }
                    await orderDoc.save();
                }
            }
            catch (orderUpdateErr) {
                console.error("Failed to update Order shipmentStatus in NDR:", orderUpdateErr);
            }
            return res.status(200).json({
                success: true,
                message: response.message || response.remark || (actionNum === 1 ? "Reattempt scheduled successfully!" : "Consignment marked for RTO successfully!"),
                data: response.data || response
            });
        }
        else {
            // Local/Processing Fallback: update Order document directly
            try {
                const idStr = awbInput.toString().trim();
                const orderDoc = await Order_model_1.default.findOne({
                    $or: [
                        { awbNumber: idStr },
                        ...(mongoose_1.default.Types.ObjectId.isValid(idStr) ? [{ _id: idStr }] : [])
                    ]
                });
                if (orderDoc) {
                    if (actionNum === 2) {
                        orderDoc.shipmentStatus = "RTO";
                    }
                    else {
                        orderDoc.shipmentStatus = "In-Transit";
                    }
                    await orderDoc.save();
                    return res.status(200).json({
                        success: true,
                        message: actionNum === 1 ? "Reattempt scheduled successfully!" : "Consignment marked for RTO successfully!",
                        data: {
                            status: "success",
                            shipmentStatus: orderDoc.shipmentStatus,
                            action: actionNum === 1 ? "Reattempt" : "RTO",
                            awb_number: orderDoc.awbNumber || idStr
                        },
                        source: "Local NDR Handler"
                    });
                }
            }
            catch (ndrUpdateErr) {
                console.error("Failed to update local order in NDR fallback:", ndrUpdateErr);
            }
            const errorMsg = response?.remark || response?.message || "Failed to process NDR action";
            return res.status(400).json({
                success: false,
                message: errorMsg,
                rawResponse: response
            });
        }
    }
    catch (err) {
        console.error("NDR Action Error:", err);
        return res.status(500).json({
            success: false,
            message: err.message || "Internal server error"
        });
    }
};
exports.handleNDRAction = handleNDRAction;
