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
// PUT /api/inventory/update or PATCH /api/inventory/:sku
const updateInventoryItem = async (req, res) => {
    try {
        const rawSku = req.params.sku || req.body.sku;
        const { stock, reorderLevel } = req.body;
        if (!rawSku) {
            sendError(res, 400, "SKU code is required");
            return;
        }
        const targetSku = rawSku.toString().trim();
        const newStock = Number(stock ?? 0);
        const newReorder = reorderLevel !== undefined ? Number(reorderLevel) : undefined;
        const skuRegex = new RegExp(`^${targetSku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        // Try finding and updating standard Product
        let product = await Product_model_1.default.findOne({
            $or: [
                { skuCode: skuRegex },
                { skuCode: targetSku },
                { sku: skuRegex }
            ]
        });
        if (product) {
            if (stock !== undefined) {
                product.stockQuantity = newStock;
            }
            if (newReorder !== undefined) {
                product.reorderLevel = newReorder;
            }
            await product.save();
            res.status(200).json({
                success: true,
                message: "Product inventory updated successfully",
                data: {
                    sku: product.skuCode,
                    name: product.productName,
                    stock: product.stockQuantity,
                    reorderLevel: product.reorderLevel
                }
            });
            return;
        }
        // Try finding and updating ComboProduct
        let combo = await ComboProduct_model_1.default.findOne({
            $or: [
                { comboSku: skuRegex },
                { comboSku: targetSku }
            ]
        });
        if (combo) {
            if (newReorder !== undefined) {
                combo.reorderLevel = newReorder;
            }
            if (stock !== undefined) {
                combo.comboStock = newStock;
                combo.stockLogic = "manual";
            }
            await combo.save();
            res.status(200).json({
                success: true,
                message: "Combo inventory updated successfully",
                data: {
                    sku: combo.comboSku,
                    name: combo.comboName,
                    stock: combo.comboStock,
                    reorderLevel: combo.reorderLevel
                }
            });
            return;
        }
        sendError(res, 404, `Inventory item not found with SKU: ${targetSku}`);
    }
    catch (err) {
        console.error("Update inventory error:", err);
        sendError(res, 500, err.message || "Server Error");
    }
};
exports.updateInventoryItem = updateInventoryItem;
