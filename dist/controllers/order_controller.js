"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderById = exports.getMyOrders = exports.createOrder = void 0;
const Order_model_1 = __importDefault(require("../models/Order_model"));
const Product_model_1 = __importDefault(require("../models/Product_model"));
const User_model_1 = __importDefault(require("../models/User_model"));
const createOrder = async (req, res) => {
    try {
        const { orderItems, totalPrice } = req.body;
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
        });
        const createdOrder = await order.save();
        // 4. Reset user cart dynamically
        if (req.user?._id) {
            await User_model_1.default.findByIdAndUpdate(req.user._id, {
                $set: { cart: [] }
            });
        }
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
        const orders = await Order_model_1.default.find({ user: req.user._id });
        res.status(200).json(orders);
    }
    catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
};
exports.getMyOrders = getMyOrders;
const getOrderById = async (req, res) => {
    try {
        const order = await Order_model_1.default.findById(req.params.id).populate("user", "name email profileImage");
        if (order) {
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
