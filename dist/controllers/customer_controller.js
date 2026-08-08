"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCustomersList = void 0;
const User_model_1 = __importDefault(require("../models/User_model"));
const Order_model_1 = __importDefault(require("../models/Order_model"));
const mongoose_1 = __importDefault(require("mongoose"));
const sendError = (res, status, message) => res.status(status).json({ success: false, message });
const formatLastOrder = (date) => {
    return new Date(date).toLocaleString("en-US", { month: "short", day: "numeric" }); // e.g. "Jan 10"
};
const formatJoined = (date) => {
    return new Date(date).toLocaleString("en-US", { month: "short", year: "numeric" }); // e.g. "Mar 2024"
};
// GET /api/customers
const getCustomersList = async (req, res) => {
    try {
        const db = mongoose_1.default.connection.db;
        if (!db) {
            sendError(res, 500, "Database connection not available");
            return;
        }
        // Fetch all users with role user
        const users = await User_model_1.default.find({ roles: { $in: ["user"] } });
        // Fetch all orders and addresses
        const [orders, addresses] = await Promise.all([
            Order_model_1.default.find().sort({ createdAt: -1 }),
            db.collection("addresses").find().toArray()
        ]);
        const data = users.map((u, idx) => {
            const userOrders = orders.filter(o => o.user.toString() === u._id.toString());
            const spent = userOrders.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
            const lastOrderObj = userOrders[0];
            const lastOrder = lastOrderObj ? formatLastOrder(lastOrderObj.createdAt) : "—";
            const userAddress = addresses.find((a) => a.userId.toString() === u._id.toString());
            const city = userAddress ? userAddress.city : "—";
            let status = "Inactive";
            if (spent >= 50000) {
                status = "VIP";
            }
            else if (userOrders.length > 0) {
                status = "Active";
            }
            return {
                id: idx + 1,
                dbId: u._id,
                name: u.name,
                email: u.email,
                phone: u.number || userAddress?.phone || "—",
                city,
                orders: userOrders.length,
                spent,
                lastOrder,
                status,
                joined: formatJoined(u.createdAt),
                avatar: u.name ? u.name.charAt(0).toUpperCase() : "U",
            };
        });
        data.sort((a, b) => b.spent - a.spent);
        res.status(200).json({ success: true, data });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.getCustomersList = getCustomersList;
