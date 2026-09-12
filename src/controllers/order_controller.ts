import { Request, Response } from "express";
import mongoose from "mongoose";
import Order from "../models/Order_model";
import Product from "../models/Product_model";
import User from "../models/User_model";
import { bookShipmentForOrder } from "./logistics_controller";
import { sendOrderConfirmationEmails } from "../services/email_service";


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

    // 1. Stock availability validation
    for (const item of orderItems) {
      if (item.productId && mongoose.Types.ObjectId.isValid(item.productId)) {
        const product = await Product.findById(item.productId);
        if (product) {
          const currentStock = product.stockQuantity ?? 0;
          if (item.qty > currentStock && currentStock > 0) {
            return res.status(400).json({
              message: `Insufficient stock for product "${product.productName}". Only ${currentStock} items left in stock!`
            });
          }
        }
      }
    }

    // 3. Resolve user (authenticated or guest)
    let userId = req.user?._id as any;
    if (!userId && (shippingAddress?.email || shippingAddress?.phone)) {
      try {
        const userEmail = shippingAddress?.email?.trim() || `guest_${(shippingAddress?.phone || Date.now()).toString().slice(-6)}@artiory.com`;
        let guestUser = await User.findOne({ email: userEmail });
        if (!guestUser && shippingAddress?.phone) {
          guestUser = await User.findOne({ number: shippingAddress.phone.toString().slice(-10) });
        }
        if (!guestUser) {
          guestUser = await User.create({
            name: shippingAddress?.name?.trim() || "Guest Customer",
            email: userEmail,
            number: (shippingAddress?.phone || "").toString().slice(-10),
            roles: ["user"]
          });
        }
        userId = guestUser._id;
      } catch (userCreateErr) {
        console.warn("Guest user auto-creation notice:", userCreateErr);
      }
    }

    // 4. Save order document
    const isGuestOrder = !req.user?._id || req.body?.isGuest === true;
    const order = new Order({
      user: userId || undefined,
      orderItems,
      totalPrice,
      shippingAddress,
      discountAmount,
      shippingCharge,
      couponCode,
      status: "Pending",
      shipmentStatus: "Unshipped",
      isGuest: isGuestOrder
    });

    const createdOrder = await order.save();

    res.status(201).json(createdOrder);
  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ message: "Server Error", error: (error as any)?.message });
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
              const status = (await querySabPaisaStatus(o.clientTxnId) || "").toUpperCase().trim();
              if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID" || status === "0200" || status === "OK") {
                o.status = "Paid";
                await o.save();
                if (o.user) {
                  await User.findByIdAndUpdate(o.user, { $set: { cart: [] } });
                }
              }
            }
          } catch (e) {
            console.error(`Pending order check error for ${o._id}:`, e);
          }
        })
      );
    }

    // 2. Fetch and return ONLY confirmed Paid, Shipped, In-Transit, Delivered orders
    const userFilter: any[] = [{ user: userId }];
    if (req.user?.email) {
      userFilter.push({ "shippingAddress.email": req.user.email });
    }

    const confirmedOrders = await Order.find({
      $or: userFilter,
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
    const rawParam = req.params.id;
    const rawId = Array.isArray(rawParam) ? rawParam[0] : rawParam;
    const cleanId = typeof rawId === "string" ? rawId.trim().replace(/^#?\s*(ORD|ORDER)?[-_:\s]*/i, "") : "";

    let order = null;
    if (mongoose.Types.ObjectId.isValid(cleanId) && cleanId.length === 24) {
      order = await Order.findById(cleanId)
        .populate("user", "name email profileImage")
        .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight");
    }

    if (!order) {
      const lookupConditions: any[] = [
        { clientTxnId: cleanId },
        { clientTxnId: rawId },
        { awbNumber: cleanId },
        { awbNumber: rawId },
        { logisticsOrderId: cleanId },
        { logisticsOrderId: rawId },
        { logisticsOrderId: `#${cleanId}` },
        { sabpaisaTxnId: cleanId },
      ];

      if (/^\d+$/.test(cleanId)) {
        lookupConditions.push({ logisticsOrderId: Number(cleanId) });
      }

      if (cleanId.length >= 4 && /^[0-9a-fA-F]+$/.test(cleanId)) {
        lookupConditions.push({
          $expr: {
            $regexMatch: {
              input: { $toString: "$_id" },
              regex: cleanId + "$",
              options: "i",
            },
          },
        });
      }

      order = await Order.findOne({ $or: lookupConditions })
        .populate("user", "name email profileImage")
        .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight");
    }

    if (order) {
      if (order.status === "Pending" && order.clientTxnId) {
        try {
          const status = (await querySabPaisaStatus(order.clientTxnId) || "").toUpperCase().trim();
          if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID" || status === "0200" || status === "OK") {
            order.status = "Paid";
            await order.save();
            if (order.user) {
              await User.findByIdAndUpdate(order.user, { $set: { cart: [] } });
            }
          } else if (status === "EXPIRED" || status === "FAILED" || status === "0300") {
            order.status = "Failed";
            await order.save();
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
    // 1. Auto-cleanup or reconcile abandoned pending orders (> 15 mins old)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const pendingOrders = await Order.find({
      status: "Pending",
      createdAt: { $lt: fifteenMinsAgo }
    });

    if (pendingOrders.length > 0) {
      await Promise.all(
        pendingOrders.map(async (order) => {
          try {
            if (order.clientTxnId) {
              const status = (await querySabPaisaStatus(order.clientTxnId) || "").toUpperCase().trim();
              if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID" || status === "0200" || status === "OK") {
                order.status = "Paid";
                for (const item of order.orderItems) {
                  if (item.productId) {
                    await Product.findByIdAndUpdate(item.productId, { $inc: { stockQuantity: -item.qty } }).catch(() => {});
                  }
                }
                await order.save();
                console.log(`Reconciled Order ${order._id} to Paid`);
                return;
              }
            }
          } catch (err) {
            console.error(`Reconciliation check error for order ${order._id}:`, err);
          }
          // If abandoned/unpaid, delete it so it does not remain in DB
          await Order.findByIdAndDelete(order._id).catch(() => {});
        })
      );
    }

    // 2. Return ONLY confirmed Paid/Shipped orders to dashboard (No Pending, No Failed)
    const allOrders = await Order.find({
      status: { $in: ["Paid", "Shipped", "In-Transit", "Delivered", "RTO"] }
    })
      .populate("user", "name email number")
      .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: allOrders });
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
    const { orderId, clientTxnId, forcePaid } = req.body;
    if (!orderId && !clientTxnId) {
      return res.status(400).json({ success: false, message: "orderId or clientTxnId is required" });
    }

    let order = null;
    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      order = await Order.findById(orderId);
    }
    if (!order && clientTxnId) {
      const parsedId = clientTxnId.split("-")[0];
      if (mongoose.Types.ObjectId.isValid(parsedId)) {
        order = await Order.findById(parsedId);
      }
      if (!order) {
        order = await Order.findOne({ clientTxnId });
      }
    }

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    // If admin explicitly marked as Paid with forcePaid flag
    if (forcePaid) {
      order.status = "Paid";
      if (clientTxnId) order.clientTxnId = clientTxnId;
      await order.save();
      if (order.user) {
        await User.findByIdAndUpdate(order.user, { $set: { cart: [] } });
      }

      // Auto-trigger iThink Logistics shipment booking & notifications immediately
      bookShipmentForOrder(order._id).catch((e) => console.error("Auto-shipment trigger error:", e));

      // Trigger Resend transactional email notification to Customer & Admin
      sendOrderConfirmationEmails(order._id).catch((e) => console.error("Resend confirmation email error:", e));

      return res.status(200).json({ success: true, message: "Order successfully marked as Paid!", status: order.status });
    }

    const txnToQuery = clientTxnId || order.clientTxnId || order._id.toString();
    order.clientTxnId = txnToQuery;
    const status = (await querySabPaisaStatus(txnToQuery) || "").toUpperCase().trim();

    if (status === "SUCCESS" || status === "TXN_SUCCESS" || status === "0000" || status === "PAID" || status === "0200" || status === "OK") {
      order.status = "Paid";
      await order.save();
      if (order.user) {
        await User.findByIdAndUpdate(order.user, { $set: { cart: [] } });
      }

      // Auto-trigger iThink Logistics shipment booking & notifications immediately
      bookShipmentForOrder(order._id).catch((e) => console.error("Auto-shipment trigger error:", e));

      // Trigger Resend transactional email notification to Customer & Admin
      sendOrderConfirmationEmails(order._id).catch((e) => console.error("Resend confirmation email error:", e));

      return res.status(200).json({ success: true, message: "Order reconciled successfully with SabPaisa! Status set to Paid.", status: order.status });
    } else {
      if (status === "EXPIRED" || status === "FAILED" || status === "0300") {
        order.status = "Failed";
        await order.save();
      }
      return res.status(400).json({ success: false, message: `SabPaisa returned status: ${status}`, status });
    }
  } catch (error: any) {
    console.error("Reconcile Order Error:", error);
    res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};

export const trackOrder = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ success: false, message: "Order ID, Phone Number, or Email is required" });
    }

    const rawQuery = query.trim();
    const cleanId = rawQuery.replace(/^#?\s*(ORD|ORDER)?[-_:\s]*/i, "").trim();
    const digitsOnly = rawQuery.replace(/\D/g, "");
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawQuery);

    const orConditions: any[] = [];

    // 1. Direct MongoDB 24-character ObjectId
    if (mongoose.Types.ObjectId.isValid(cleanId) && cleanId.length === 24) {
      orConditions.push({ _id: new mongoose.Types.ObjectId(cleanId) });
    }

    // 2. Short ID suffix of MongoDB ObjectId (e.g. 506E4938 or 6e4938)
    if (cleanId.length >= 4 && /^[0-9a-fA-F]+$/.test(cleanId)) {
      orConditions.push({
        $expr: {
          $regexMatch: {
            input: { $toString: "$_id" },
            regex: cleanId + "$",
            options: "i",
          },
        },
      });
    }

    // 3. iThink Logistics Order ID (as sent in SMS e.g. #35468 or 35468)
    orConditions.push({ logisticsOrderId: cleanId });
    orConditions.push({ logisticsOrderId: rawQuery });
    orConditions.push({ logisticsOrderId: `#${cleanId}` });
    if (/^\d+$/.test(cleanId)) {
      orConditions.push({ logisticsOrderId: Number(cleanId) });
    }

    // 4. AWB Tracking Number
    orConditions.push({ awbNumber: cleanId });
    orConditions.push({ awbNumber: rawQuery });

    // 5. Client Transaction ID & SabPaisa Txn ID
    orConditions.push({ clientTxnId: cleanId });
    orConditions.push({ clientTxnId: rawQuery });
    orConditions.push({ sabpaisaTxnId: cleanId });
    orConditions.push({ sabpaisaTxnId: rawQuery });

    // 6. Mobile Number search (10-digit)
    if (digitsOnly.length >= 10) {
      const phone10 = digitsOnly.slice(-10);
      orConditions.push({ "shippingAddress.phone": phone10 });
      orConditions.push({ "shippingAddress.phone": `+91${phone10}` });
      orConditions.push({ "shippingAddress.phone": `91${phone10}` });
      orConditions.push({ "shippingAddress.alternatePhone": phone10 });
    }

    // 7. Email Address search
    if (isEmail || rawQuery.includes("@")) {
      orConditions.push({ "shippingAddress.email": new RegExp(`^${rawQuery.toLowerCase()}$`, "i") });
    }

    const orders = await Order.find({ $or: orConditions })
      .populate("orderItems.productId", "productName skuCode thumbnail images sellingPrice mrp weight")
      .sort({ createdAt: -1 })
      .limit(10);

    if (!orders || orders.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No orders found matching your search. Please verify your Order ID, Phone Number, or Email."
      });
    }

    return res.status(200).json({ success: true, data: orders });
  } catch (error: any) {
    console.error("Track Order Error:", error);
    return res.status(500).json({ success: false, message: "Server Error", error: error.message });
  }
};
