"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCoupon = exports.deleteCoupon = exports.updateCoupon = exports.createCoupon = exports.getCoupons = void 0;
const Coupon_model_1 = __importDefault(require("../models/Coupon_model"));
const sendError = (res, status, message) => res.status(status).json({ success: false, message });
// GET /api/coupons
const getCoupons = async (req, res) => {
    try {
        const coupons = await Coupon_model_1.default.find().sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: coupons });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.getCoupons = getCoupons;
// POST /api/coupons
const createCoupon = async (req, res) => {
    try {
        const { code, type, value, minOrder, maxUses, expiry, description } = req.body;
        if (!code || !value || !expiry) {
            sendError(res, 400, "Code, Value, and Expiry are required");
            return;
        }
        const formattedCode = code.toString().trim().toUpperCase();
        const existing = await Coupon_model_1.default.findOne({ code: formattedCode });
        if (existing) {
            sendError(res, 409, "Coupon code already exists");
            return;
        }
        const coupon = await Coupon_model_1.default.create({
            code: formattedCode,
            type: type || "percent",
            value: Number(value),
            minOrder: Number(minOrder || 0),
            maxUses: Number(maxUses || 999),
            expiry: new Date(expiry),
            description: description || "",
            active: true,
            uses: 0,
        });
        res.status(201).json({ success: true, message: "Coupon created successfully", data: coupon });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.createCoupon = createCoupon;
// PUT /api/coupons/:id
const updateCoupon = async (req, res) => {
    try {
        const { active, description, maxUses, minOrder, value, expiry } = req.body;
        const coupon = await Coupon_model_1.default.findById(req.params.id);
        if (!coupon) {
            sendError(res, 404, "Coupon not found");
            return;
        }
        if (active !== undefined)
            coupon.active = active;
        if (description !== undefined)
            coupon.description = description;
        if (maxUses !== undefined)
            coupon.maxUses = Number(maxUses);
        if (minOrder !== undefined)
            coupon.minOrder = Number(minOrder);
        if (value !== undefined)
            coupon.value = Number(value);
        if (expiry !== undefined)
            coupon.expiry = new Date(expiry);
        await coupon.save();
        res.status(200).json({ success: true, message: "Coupon updated successfully", data: coupon });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.updateCoupon = updateCoupon;
// DELETE /api/coupons/:id
const deleteCoupon = async (req, res) => {
    try {
        const deleted = await Coupon_model_1.default.findByIdAndDelete(req.params.id);
        if (!deleted) {
            sendError(res, 404, "Coupon not found");
            return;
        }
        res.status(200).json({ success: true, message: "Coupon deleted successfully" });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.deleteCoupon = deleteCoupon;
// POST /api/coupons/validate
const validateCoupon = async (req, res) => {
    try {
        const { code, orderTotal } = req.body;
        if (!code) {
            sendError(res, 400, "Coupon code is required");
            return;
        }
        const targetCode = code.toString().trim().toUpperCase();
        const coupon = await Coupon_model_1.default.findOne({ code: targetCode });
        if (!coupon) {
            sendError(res, 404, "Invalid coupon code");
            return;
        }
        if (!coupon.active) {
            sendError(res, 400, "This coupon is inactive");
            return;
        }
        if (new Date(coupon.expiry) < new Date()) {
            sendError(res, 400, "This coupon has expired");
            return;
        }
        if (coupon.uses >= coupon.maxUses) {
            sendError(res, 400, "This coupon code usage limit has been reached");
            return;
        }
        const total = Number(orderTotal || 0);
        if (total < coupon.minOrder) {
            sendError(res, 400, `Minimum order amount of ₹${coupon.minOrder} is required for this coupon`);
            return;
        }
        // Calculate discount amount
        let discountAmount = 0;
        if (coupon.type === "percent") {
            discountAmount = Math.round((total * coupon.value) / 100);
        }
        else {
            discountAmount = coupon.value;
        }
        // Discount cannot exceed order total
        discountAmount = Math.min(discountAmount, total);
        res.status(200).json({
            success: true,
            message: "Coupon applied successfully",
            data: {
                code: coupon.code,
                type: coupon.type,
                value: coupon.value,
                discountAmount,
            }
        });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.validateCoupon = validateCoupon;
