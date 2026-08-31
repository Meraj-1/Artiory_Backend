import { Request, Response } from "express";
import Order from "../models/Order_model";
import Product from "../models/Product_model";
import User from "../models/User_model";


export const createOrder = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const {
      orderItems,
      totalPrice,
      shippingAddress,
      discountAmount = 0,
      shippingCharge = 149,
      couponCode = "",
    } = req.body;

    if (!orderItems || orderItems.length === 0) {
      return res.status(400).json({ message: "No order items" });
    }

    // 1. Atomic stock validation for all ordered products
    for (const item of orderItems) {
      const product = await Product.findById(item.productId);
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
      await Product.findByIdAndUpdate(item.productId, {
        $inc: { stockQuantity: -item.qty }
      });
    }

    // 3. Save order document
    const order = new Order({
      user: req.user?._id as any,
      orderItems,
      totalPrice,
      shippingAddress,
      discountAmount,
      shippingCharge,
      couponCode,
    });

    const createdOrder = await order.save();

    res.status(201).json(createdOrder);
  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const getMyOrders = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: "Not authorized" });
    }

    const orders = await Order.find({ user: req.user._id as any })
      .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
      .sort({ createdAt: -1 });

    const pending = orders.filter((o) => o.status === "Pending" && o.clientTxnId);
    if (pending.length > 0) {
      await Promise.all(
        pending.map(async (o) => {
          try {
            const status = await querySabPaisaStatus(o.clientTxnId!);
            if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
              o.status = "Paid";
              await o.save();
            }
          } catch (e) {}
        })
      );
    }

    res.status(200).json(orders);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

export const getOrderById = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const order = await Order.findById(req.params.id)
      .populate("user", "name email profileImage")
      .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight");

    if (order) {
      if (order.status === "Pending" && order.clientTxnId) {
        try {
          const status = await querySabPaisaStatus(order.clientTxnId);
          if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
            order.status = "Paid";
            await order.save();
            if (order.user) {
              await User.findByIdAndUpdate(order.user, { $set: { cart: [] } });
            }
          }
        } catch (e) {
          console.error("Order live status enquiry check error:", e);
        }
      }
      res.status(200).json(order);
    } else {
      res.status(404).json({ message: "Order not found" });
    }
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

import { querySabPaisaStatus } from "./payment_controller";

export const getAllOrders = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    // 1. Fetch all orders
    const allOrders = await Order.find()
      .populate("user", "name email number")
      .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
      .sort({ createdAt: -1 });

    // 2. Reconcile any Pending orders that have a clientTxnId directly from SabPaisa
    const pendingOrdersToReconcile = allOrders.filter(
      (order) => order.status === "Pending" && order.clientTxnId
    );

    if (pendingOrdersToReconcile.length > 0) {
      await Promise.all(
        pendingOrdersToReconcile.map(async (order) => {
          try {
            const status = await querySabPaisaStatus(order.clientTxnId!);
            if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
              order.status = "Paid";
              await order.save();
              console.log(`Reconciled Order ${order._id} dynamically: status set to Paid`);
            } else if (
              status === "EXPIRED" ||
              status === "FAILED" ||
              status === "0300" ||
              status === "0200"
            ) {
              order.status = "Failed";
              // Restore stock for failed reconciliation
              for (const item of order.orderItems) {
                await Product.findByIdAndUpdate(item.productId, {
                  $inc: { stockQuantity: item.qty }
                });
              }
              await order.save();
              console.log(`Reconciled Order ${order._id} dynamically: status set to Failed and stock restored`);
            }
          } catch (err) {
            console.error(`Reconciliation failed for order ${order._id}:`, err);
          }
        })
      );
    }

    // 3. Return paid, shipped, delivered, or in-transit orders to dashboard
    const activeOrders = allOrders.filter((order) =>
      ["Paid", "Shipped", "Delivered", "In-Transit"].includes(order.status) ||
      order.shipmentStatus !== "Unshipped"
    );

    res.status(200).json({ success: true, data: activeOrders });
  } catch (error) {
    console.error("Get All Orders Error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

export const reconcileOrder = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { orderId, clientTxnId } = req.body;
    if (!orderId && !clientTxnId) {
      return res.status(400).json({ success: false, message: "orderId or clientTxnId is required" });
    }

    const order = await Order.findById(orderId || (clientTxnId ? clientTxnId.split("-")[0] : null));
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    const txnToQuery = clientTxnId || order.clientTxnId || order._id.toString();
    order.clientTxnId = txnToQuery;
    const status = await querySabPaisaStatus(txnToQuery);

    if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
      order.status = "Paid";
      await order.save();
      if (order.user) {
        await User.findByIdAndUpdate(order.user, { $set: { cart: [] } });
      }
      return res.status(200).json({ success: true, message: "Order reconciled successfully with SabPaisa! Status set to Paid.", status: order.status });
    } else {
      if (status === "EXPIRED" || status === "FAILED" || status === "0300" || status === "0200") {
        order.status = "Failed";
      }
      await order.save();
      return res.status(400).json({ success: false, message: `SabPaisa returned status: ${status}`, status });
    }
  } catch (error: any) {
    console.error("Reconcile Order Error:", error);
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};
