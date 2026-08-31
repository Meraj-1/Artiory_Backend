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

// PUT /api/inventory/update or PATCH /api/inventory/:sku
export const updateInventoryItem = async (req: Request, res: Response): Promise<void> => {
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
    let product = await Product.findOne({
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
    let combo = await ComboProduct.findOne({
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
  } catch (err: any) {
    console.error("Update inventory error:", err);
    sendError(res, 500, err.message || "Server Error");
  }
};
