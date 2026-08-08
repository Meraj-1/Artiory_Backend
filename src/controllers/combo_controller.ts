import { Request, Response } from "express";
import ComboProduct from "../models/ComboProduct_model";
import Product from "../models/Product_model";

const sendError = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

// POST /api/combos
export const createComboProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const { comboName, comboSku, comboPrice, items, stockLogic, comboStock, active, published, comboDesc } = req.body;

    if (!comboName || !comboSku || !comboPrice || !Array.isArray(items) || items.length < 2) {
      sendError(res, 400, "Name, SKU, Price, and at least 2 items are required");
      return;
    }

    const formattedSku = comboSku.toString().trim().toUpperCase();
    const existing = await ComboProduct.findOne({ comboSku: formattedSku });
    if (existing) {
      sendError(res, 409, "Combo SKU already exists");
      return;
    }

    // Calculate auto stock if required
    let finalStock = Number(comboStock || 0);
    if (stockLogic === "auto") {
      const productIds = items.map((item: any) => item.product);
      const dbProducts = await Product.find({ _id: { $in: productIds } });
      
      const stocks = items.map((item: any) => {
        const dbProd = dbProducts.find((p) => p._id.toString() === String(item.product));
        const dbStock = dbProd ? (dbProd.stockQuantity || 0) : 0;
        return Math.floor(dbStock / Number(item.quantity || 1));
      });
      
      finalStock = stocks.length > 0 ? Math.min(...stocks) : 0;
    }

    const combo = await ComboProduct.create({
      comboName,
      comboSku: formattedSku,
      comboPrice: Number(comboPrice),
      items,
      stockLogic: stockLogic || "auto",
      comboStock: finalStock,
      active: active !== undefined ? active : true,
      published: published !== undefined ? published : false,
      comboDesc: comboDesc || "",
    });

    res.status(201).json({ success: true, message: "Combo product created successfully", data: combo });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// GET /api/combos
export const getComboProducts = async (req: Request, res: Response): Promise<void> => {
  try {
    const combos = await ComboProduct.find().populate("items.product", "productName skuCode sellingPrice mrp thumbnail stockQuantity");
    res.status(200).json({ success: true, data: combos });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// GET /api/combos/:id
export const getComboProductById = async (req: Request, res: Response): Promise<void> => {
  try {
    const combo = await ComboProduct.findById(req.params.id).populate("items.product", "productName skuCode sellingPrice mrp thumbnail stockQuantity");
    if (!combo) {
      sendError(res, 404, "Combo product not found");
      return;
    }
    res.status(200).json({ success: true, data: combo });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// PUT /api/combos/:id
export const updateComboProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const combo = await ComboProduct.findById(req.params.id);
    if (!combo) {
      sendError(res, 404, "Combo product not found");
      return;
    }

    const { comboName, comboPrice, items, stockLogic, comboStock, active, published, comboDesc } = req.body;

    const updatedData: any = {};
    if (comboName) updatedData.comboName = comboName;
    if (comboPrice) updatedData.comboPrice = Number(comboPrice);
    if (items) updatedData.items = items;
    if (stockLogic) updatedData.stockLogic = stockLogic;
    if (comboDesc !== undefined) updatedData.comboDesc = comboDesc;
    if (active !== undefined) updatedData.active = active;
    if (published !== undefined) updatedData.published = published;

    // Recalculate stock if auto stock logic is active
    const finalStockLogic = stockLogic || combo.stockLogic;
    const finalItems = items || combo.items;
    
    let finalStock = comboStock !== undefined ? Number(comboStock) : combo.comboStock;
    if (finalStockLogic === "auto") {
      const productIds = finalItems.map((item: any) => item.product);
      const dbProducts = await Product.find({ _id: { $in: productIds } });
      
      const stocks = finalItems.map((item: any) => {
        const dbProd = dbProducts.find((p) => p._id.toString() === String(item.product));
        const dbStock = dbProd ? (dbProd.stockQuantity || 0) : 0;
        return Math.floor(dbStock / Number(item.quantity || 1));
      });
      
      finalStock = stocks.length > 0 ? Math.min(...stocks) : 0;
    }
    updatedData.comboStock = finalStock;

    const updatedCombo = await ComboProduct.findByIdAndUpdate(req.params.id, updatedData, { new: true });
    res.status(200).json({ success: true, message: "Combo product updated successfully", data: updatedCombo });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// DELETE /api/combos/:id
export const deleteComboProduct = async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await ComboProduct.findByIdAndDelete(req.params.id);
    if (!deleted) {
      sendError(res, 404, "Combo product not found");
      return;
    }
    res.status(200).json({ success: true, message: "Combo product deleted successfully" });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};
