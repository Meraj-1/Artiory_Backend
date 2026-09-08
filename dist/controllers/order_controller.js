"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackOrder = exports.reconcileOrder = exports.getAllOrders = exports.getOrderById = exports.getMyOrders = exports.createOrder = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Order_model_1 = __importDefault(require("../models/Order_model"));
const Product_model_1 = __importDefault(require("../models/Product_model"));
const User_model_1 = __importDefault(require("../models/User_model"));
const createOrder = async (req, res) => {
    try {
        const { orderItems, totalPrice, shippingAddress, discountAmount = 0, shippingCharge = 0, couponCode = "", } = req.body;
        if (!orderItems || orderItems.length === 0) {
            return res.status(400).json({ message: "No order items" });
        }
        // 1. Atomic stock validation for all ordered products
        for (const item of orderItems) {
            const product = await Product_model_1.default.findById(item.productId);
            if (!product) {
                return res.status(404).json({ message: `Product "${item.name}" not found` });
            }
            const currentStock = product.stockQuantity ?? 0;
            if (item.qty > currentStock) {
                return res.status(400).json({
                    message: `Insufficient stock for product "${product.productName}". Only ${currentStock} items left in stock!`
                });
            }
        }
        // 2. Decrement stock counts in the database
        for (const item of orderItems) {
            await Product_model_1.default.findByIdAndUpdate(item.productId, {
                $inc: { stockQuantity: -item.qty }
            });
        }
        // 3. Save order document
        const order = new Order_model_1.default({
            user: req.user?._id,
            orderItems,
            totalPrice,
            shippingAddress,
            discountAmount,
            shippingCharge,
            couponCode,
        });
        const createdOrder = await order.save();
        res.status(201).json(createdOrder);
    }
    catch (error) {
        console.error("Create Order Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};
exports.createOrder = createOrder;
const getMyOrders = async (req, res) => {
    try {
        if (!req.user?._id) {
            return res.status(401).json({ message: "Not authorized" });
        }
        const userId = req.user._id;
        // 1. Find any Pending orders for this user to reconcile or delete if abandoned/cancelled
        const pendingOrders = await Order_model_1.default.find({ user: userId, status: "Pending" });
        if (pendingOrders.length > 0) {
            await Promise.all(pendingOrders.map(async (o) => {
                try {
                    if (o.clientTxnId) {
                        const status = await (0, payment_controller_1.querySabPaisaStatus)(o.clientTxnId);
                        if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
                            o.status = "Paid";
                            await o.save();
                            if (o.user) {
                                await User_model_1.default.findByIdAndUpdate(o.user, { $set: { cart: [] } });
                            }
                            return;
                        }
                    }
                    // If payment failed, expired, cancelled, or initiated >15 mins ago without payment -> delete & restore stock
                    const isStale = (Date.now() - new Date(o.createdAt).getTime()) > 15 * 60 * 1000;
                    if (isStale || !o.clientTxnId) {
                        if (o.orderItems && o.orderItems.length > 0) {
                            for (const item of o.orderItems) {
                                await Product_model_1.default.findByIdAndUpdate(item.productId, {
                                    $inc: { stockQuantity: item.qty }
                                });
                            }
                        }
                        await Order_model_1.default.findByIdAndDelete(o._id);
                        console.log(`Cleaned up unpaid/abandoned order ${o._id} from database`);
                    }
                }
                catch (e) {
                    console.error(`Pending order check error for ${o._id}:`, e);
                }
            }));
        }
        // 2. Fetch and return ONLY confirmed Paid, Shipped, In-Transit, Delivered orders
        const userFilter = [{ user: userId }];
        if (req.user?.email) {
            userFilter.push({ "shippingAddress.email": req.user.email });
        }
        const confirmedOrders = await Order_model_1.default.find({
            $or: userFilter,
            status: { $in: ["Paid", "Shipped", "Delivered", "In-Transit"] }
        })
            .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
            .sort({ createdAt: -1 });
        res.status(200).json(confirmedOrders);
    }
    catch (error) {
        console.error("Get My Orders Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};
exports.getMyOrders = getMyOrders;
const getOrderById = async (req, res) => {
    try {
        const rawParam = req.params.id;
        const rawId = Array.isArray(rawParam) ? rawParam[0] : rawParam;
        const cleanId = typeof rawId === "string" ? rawId.trim().replace(/^#?ORD-?/i, "") : "";
        let order = null;
        if (mongoose_1.default.Types.ObjectId.isValid(cleanId) && cleanId.length === 24) {
            order = await Order_model_1.default.findById(cleanId)
                .populate("user", "name email profileImage")
                .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight");
        }
        else {
            order = await Order_model_1.default.findOne({
                $or: [
                    { clientTxnId: cleanId },
                    { awbNumber: cleanId },
                    { logisticsOrderId: cleanId }
                ]
            })
                .populate("user", "name email profileImage")
                .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight");
        }
        if (order) {
            if (order.status === "Pending" && order.clientTxnId) {
                try {
                    const status = await (0, payment_controller_1.querySabPaisaStatus)(order.clientTxnId);
                    if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
                        order.status = "Paid";
                        await order.save();
                        if (order.user) {
                            await User_model_1.default.findByIdAndUpdate(order.user, { $set: { cart: [] } });
                        }
                    }
                    else if (status === "EXPIRED" || status === "FAILED" || status === "0300" || status === "0200") {
                        // Restore stock and delete unpaid order
                        for (const item of order.orderItems) {
                            await Product_model_1.default.findByIdAndUpdate(item.productId, {
                                $inc: { stockQuantity: item.qty }
                            });
                        }
                        await Order_model_1.default.findByIdAndDelete(order._id);
                        return res.status(404).json({ message: "Order payment was not completed" });
                    }
                }
                catch (e) {
                    console.error("Order live status enquiry check error:", e);
                }
            }
            res.status(200).json(order);
        }
        else {
            res.status(404).json({ message: "Order not found" });
        }
    }
    catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};
exports.getOrderById = getOrderById;
const payment_controller_1 = require("./payment_controller");
const getAllOrders = async (req, res) => {
    try {
        // 1. Reconcile or clean up all Pending orders
        const pendingOrders = await Order_model_1.default.find({ status: "Pending" });
        if (pendingOrders.length > 0) {
            await Promise.all(pendingOrders.map(async (order) => {
                try {
                    if (order.clientTxnId) {
                        const status = await (0, payment_controller_1.querySabPaisaStatus)(order.clientTxnId);
                        if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
                            order.status = "Paid";
                            await order.save();
                            console.log(`Reconciled Order ${order._id} to Paid`);
                            return;
                        }
                    }
                    // If failed, cancelled or stale (>15 mins) -> delete from DB and restore stock
                    const isStale = (Date.now() - new Date(order.createdAt).getTime()) > 15 * 60 * 1000;
                    if (isStale || !order.clientTxnId) {
                        if (order.orderItems && order.orderItems.length > 0) {
                            for (const item of order.orderItems) {
                                await Product_model_1.default.findByIdAndUpdate(item.productId, {
                                    $inc: { stockQuantity: item.qty }
                                });
                            }
                        }
                        await Order_model_1.default.findByIdAndDelete(order._id);
                        console.log(`Cleaned up unpaid pending order ${order._id} from database`);
                    }
                }
                catch (err) {
                    console.error(`Reconciliation/cleanup error for order ${order._id}:`, err);
                }
            }));
        }
        // 2. Return ONLY confirmed Paid, Shipped, Delivered, In-Transit orders to the dashboard
        const confirmedOrders = await Order_model_1.default.find({
            status: { $in: ["Paid", "Shipped", "Delivered", "In-Transit"] }
        })
            .populate("user", "name email number")
            .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
            .sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: confirmedOrders });
    }
    catch (error) {
        console.error("Get All Orders Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
};
exports.getAllOrders = getAllOrders;
const reconcileOrder = async (req, res) => {
    try {
        const { orderId, clientTxnId } = req.body;
        if (!orderId && !clientTxnId) {
            return res.status(400).json({ success: false, message: "orderId or clientTxnId is required" });
        }
        const order = await Order_model_1.default.findById(orderId || (clientTxnId ? clientTxnId.split("-")[0] : null));
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        const txnToQuery = clientTxnId || order.clientTxnId || order._id.toString();
        order.clientTxnId = txnToQuery;
        const status = await (0, payment_controller_1.querySabPaisaStatus)(txnToQuery);
        if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
            order.status = "Paid";
            await order.save();
            if (order.user) {
                await User_model_1.default.findByIdAndUpdate(order.user, { $set: { cart: [] } });
            }
            return res.status(200).json({ success: true, message: "Order reconciled successfully with SabPaisa! Status set to Paid.", status: order.status });
        }
        else {
            if (status === "EXPIRED" || status === "FAILED" || status === "0300" || status === "0200") {
                order.status = "Failed";
            }
            await order.save();
            return res.status(400).json({ success: false, message: `SabPaisa returned status: ${status}`, status });
        }
    }
    catch (error) {
        console.error("Reconcile Order Error:", error);
        res.status(500).json({ success: false, message: "Server Error", error: error.message });
    }
};
exports.reconcileOrder = reconcileOrder;
const trackOrder = async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || typeof query !== "string" || !query.trim()) {
            return res.status(400).json({ success: false, message: "Order ID, Phone Number, or Email is required" });
        }
        const rawQuery = query.trim();
        const cleanId = rawQuery.replace(/^#?ORD-?/i, "");
        let filter = {};
        if (mongoose_1.default.Types.ObjectId.isValid(cleanId) && cleanId.length === 24) {
            filter = { _id: cleanId };
        }
        else {
            const digitsOnly = rawQuery.replace(/\D/g, "");
            const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawQuery);
            if (digitsOnly.length >= 10) {
                const phone10 = digitsOnly.slice(-10);
                filter = {
                    $or: [
                        { "shippingAddress.phone": phone10 },
                        { "shippingAddress.phone": `+91${phone10}` },
                        { "shippingAddress.phone": `91${phone10}` },
                        { "shippingAddress.alternatePhone": phone10 }
                    ]
                };
            }
            else if (isEmail) {
                filter = { "shippingAddress.email": new RegExp(`^${rawQuery.toLowerCase()}$`, "i") };
            }
            else {
                filter = {
                    $or: [
                        { clientTxnId: cleanId },
                        { awbNumber: cleanId },
                        { logisticsOrderId: cleanId }
                    ]
                };
            }
        }
        const orders = await Order_model_1.default.find(filter)
            .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
            .sort({ createdAt: -1 })
            .limit(10);
        if (!orders || orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No orders found matching your search. Please verify your Order ID, Phone Number, or Email."
            });
        }
        return res.status(200).json({ success: true, data: orders });
    }
    catch (error) {
        console.error("Track Order Error:", error);
        return res.status(500).json({ success: false, message: "Server Error", error: error.message });
    }
};
exports.trackOrder = trackOrder;
