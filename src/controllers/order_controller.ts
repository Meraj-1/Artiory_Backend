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
      shippingCharge = 0,
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

    const userId = req.user._id as any;

    // 1. Find any Pending orders for this user to reconcile or delete if abandoned/cancelled
    const pendingOrders = await Order.find({ user: userId, status: "Pending" });
    if (pendingOrders.length > 0) {
      await Promise.all(
        pendingOrders.map(async (o) => {
          try {
            if (o.clientTxnId) {
              const status = await querySabPaisaStatus(o.clientTxnId);
              if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
                o.status = "Paid";
                await o.save();
                if (o.user) {
                  await User.findByIdAndUpdate(o.user, { $set: { cart: [] } });
                }
                return;
              }
            }

            // If payment failed, expired, cancelled, or initiated >15 mins ago without payment -> delete & restore stock
            const isStale = (Date.now() - new Date(o.createdAt).getTime()) > 15 * 60 * 1000;
            if (isStale || !o.clientTxnId) {
              if (o.orderItems && o.orderItems.length > 0) {
                for (const item of o.orderItems) {
                  await Product.findByIdAndUpdate(item.productId, {
                    $inc: { stockQuantity: item.qty }
                  });
                }
              }
              await Order.findByIdAndDelete(o._id);
              console.log(`Cleaned up unpaid/abandoned order ${o._id} from database`);
            }
          } catch (e) {
            console.error(`Pending order check error for ${o._id}:`, e);
          }
        })
      );
    }

    // 2. Fetch and return ONLY confirmed Paid, Shipped, In-Transit, Delivered orders
    const confirmedOrders = await Order.find({
      user: userId,
      status: { $in: ["Paid", "Shipped", "Delivered", "In-Transit"] }
    })
      .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
      .sort({ createdAt: -1 });

    res.status(200).json(confirmedOrders);
  } catch (error) {
    console.error("Get My Orders Error:", error);
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
          } else if (status === "EXPIRED" || status === "FAILED" || status === "0300" || status === "0200") {
            // Restore stock and delete unpaid order
            for (const item of order.orderItems) {
              await Product.findByIdAndUpdate(item.productId, {
                $inc: { stockQuantity: item.qty }
              });
            }
            await Order.findByIdAndDelete(order._id);
            return res.status(404).json({ message: "Order payment was not completed" });
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
    // 1. Reconcile or clean up all Pending orders
    const pendingOrders = await Order.find({ status: "Pending" });

    if (pendingOrders.length > 0) {
      await Promise.all(
        pendingOrders.map(async (order) => {
          try {
            if (order.clientTxnId) {
              const status = await querySabPaisaStatus(order.clientTxnId);
              if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID") {
                order.status = "Paid";
                await order.save();
                console.log(`Reconciled Order ${order._id} to Paid`);
                return;
              }
            }

            // If failed, cancelled or stale (>15 mins) -> delete from DB and restore stock
            const isStale = (Date.now() - new Date(order.createdAt).getTime()) > 15 * 60 * 1000;
            if (isStale || !order.clientTxnId) {
              if (order.orderItems && order.orderItems.length > 0) {
                for (const item of order.orderItems) {
                  await Product.findByIdAndUpdate(item.productId, {
                    $inc: { stockQuantity: item.qty }
                  });
                }
              }
              await Order.findByIdAndDelete(order._id);
              console.log(`Cleaned up unpaid pending order ${order._id} from database`);
            }
          } catch (err) {
            console.error(`Reconciliation/cleanup error for order ${order._id}:`, err);
          }
        })
      );
    }

    // 2. Return ONLY confirmed Paid, Shipped, Delivered, In-Transit orders to the dashboard
    const confirmedOrders = await Order.find({
      status: { $in: ["Paid", "Shipped", "Delivered", "In-Transit"] }
    })
      .populate("user", "name email number")
      .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: confirmedOrders });
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
