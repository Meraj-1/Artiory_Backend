import { Request, Response } from "express";
import Product from "../models/Product_model";
import ComboProduct from "../models/ComboProduct_model";

const sendError = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

const formatDate = (date: Date) => {
  return new Date(date).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// GET /api/inventory
export const getInventoryList = async (req: Request, res: Response): Promise<void> => {
  try {
    const [products, combos] = await Promise.all([
      Product.find().select("skuCode productName stockQuantity reorderLevel updatedAt"),
      ComboProduct.find().select("comboSku comboName comboStock reorderLevel updatedAt")
    ]);

    const productItems = products.map((p) => ({
      sku: p.skuCode,
      name: p.productName,
      type: "Product" as const,
      stock: p.stockQuantity || 0,
      reorderLevel: p.reorderLevel ?? 5,
      lastUpdated: formatDate(p.updatedAt),
      updatedTime: new Date(p.updatedAt).getTime()
    }));

    const comboItems = combos.map((c) => ({
      sku: c.comboSku,
      name: c.comboName,
      type: "Combo" as const,
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
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};

// PUT /api/inventory/update
export const updateInventoryItem = async (req: Request, res: Response): Promise<void> => {
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
    let product = await Product.findOne({ skuCode: targetSku });
    if (product) {
      product.stockQuantity = newStock;
      product.reorderLevel = newReorder;
      await product.save();
      
      res.status(200).json({ success: true, message: "Product inventory updated successfully" });
      return;
    }

    // Try finding and updating ComboProduct
    let combo = await ComboProduct.findOne({ comboSku: targetSku });
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
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Server Error");
  }
};
