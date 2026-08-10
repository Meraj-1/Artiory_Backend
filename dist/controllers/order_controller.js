"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderById = exports.getMyOrders = exports.createOrder = void 0;
const Order_model_1 = __importDefault(require("../models/Order_model"));
const createOrder = async (req, res) => {
    try {
        const { orderItems, totalPrice } = req.body;
        if (!orderItems || orderItems.length === 0) {
            return res.status(400).json({ message: "No order items" });
        }
        const order = new Order_model_1.default({
            user: req.user?._id,
            orderItems,
            totalPrice,
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
