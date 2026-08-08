"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateInventoryItem = exports.getInventoryList = void 0;
const Product_model_1 = __importDefault(require("../models/Product_model"));
const ComboProduct_model_1 = __importDefault(require("../models/ComboProduct_model"));
const sendError = (res, status, message) => res.status(status).json({ success: false, message });
const formatDate = (date) => {
    return new Date(date).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
};
// GET /api/inventory
const getInventoryList = async (req, res) => {
    try {
        const [products, combos] = await Promise.all([
            Product_model_1.default.find().select("skuCode productName stockQuantity reorderLevel updatedAt"),
            ComboProduct_model_1.default.find().select("comboSku comboName comboStock reorderLevel updatedAt")
        ]);
        const productItems = products.map((p) => ({
            sku: p.skuCode,
            name: p.productName,
            type: "Product",
            stock: p.stockQuantity || 0,
            reorderLevel: p.reorderLevel ?? 5,
            lastUpdated: formatDate(p.updatedAt),
            updatedTime: new Date(p.updatedAt).getTime()
        }));
        const comboItems = combos.map((c) => ({
            sku: c.comboSku,
            name: c.comboName,
            type: "Combo",
            stock: c.comboStock || 0,
            reorderLevel: c.reorderLevel ?? 5,
            lastUpdated: formatDate(c.updatedAt),
            updatedTime: new Date(c.updatedAt).getTime()
        }));
        const merged = [...productItems, ...comboItems];
        merged.sort((a, b) => b.updatedTime - a.updatedTime);
        res.status(200).json({
            success: true,
            data: merged.map(({ updatedTime, ...rest }) => rest)
        });
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.getInventoryList = getInventoryList;
// PUT /api/inventory/update
const updateInventoryItem = async (req, res) => {
    try {
        const { sku, stock, reorderLevel } = req.body;
        if (!sku) {
            sendError(res, 400, "SKU code is required");
            return;
        }
        const targetSku = sku.toString().trim().toUpperCase();
        const newStock = Number(stock ?? 0);
        const newReorder = Number(reorderLevel ?? 5);
        // Try finding and updating standard Product
        let product = await Product_model_1.default.findOne({ skuCode: targetSku });
        if (product) {
            product.stockQuantity = newStock;
            product.reorderLevel = newReorder;
            await product.save();
            res.status(200).json({ success: true, message: "Product inventory updated successfully" });
            return;
        }
        // Try finding and updating ComboProduct
        let combo = await ComboProduct_model_1.default.findOne({ comboSku: targetSku });
        if (combo) {
            combo.reorderLevel = newReorder;
            // If updating stock manually, set stockLogic to manual so that automated calculations don't overwrite it
            if (stock !== undefined) {
                combo.comboStock = newStock;
                combo.stockLogic = "manual";
            }
            await combo.save();
            res.status(200).json({ success: true, message: "Combo inventory updated successfully" });
            return;
        }
        sendError(res, 404, "Inventory item not found with the specified SKU");
    }
    catch (err) {
        console.error(err);
        sendError(res, 500, "Server Error");
    }
};
exports.updateInventoryItem = updateInventoryItem;
