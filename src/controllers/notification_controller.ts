import { Request, Response } from "express";
import Product from "../models/Product_model";
import ComboProduct from "../models/ComboProduct_model";
import Order from "../models/Order_model";
import User from "../models/User_model";
import Notification from "../models/Notification_model";

export const getNotifications = async (req: Request, res: Response): Promise<any> => {
  try {
    // 1. Fetch read notification records from DB
    const savedNotifs = await Notification.find().lean();
    const readMap = new Map<string, boolean>();
    const dismissedSet = new Set<string>();

    savedNotifs.forEach((n: any) => {
      if (n.notificationId) {
        readMap.set(n.notificationId, Boolean(n.read));
        if (n.metadata?.dismissed) {
          dismissedSet.add(n.notificationId);
        }
      }
    });

    const notifications: any[] = [];

    // 2. Live Out of Stock Alerts
    const outOfStockProducts = await Product.find({
      $or: [{ stockQuantity: { $lte: 0 } }, { stock: { $lte: 0 } }]
    }).lean();

    outOfStockProducts.forEach((p: any) => {
      const id = `oos_${p._id}`;
      if (!dismissedSet.has(id)) {
        notifications.push({
          id,
          title: `🚨 Out of Stock: ${p.productName || p.name || "Product"}`,
          message: `SKU "${p.skuCode || p.sku || "N/A"}" has 0 stock remaining in inventory. Restock action required.`,
          type: "alert",
          category: "stock",
          link: "/dashboard/inventory",
          read: readMap.get(id) || false,
          badge: "OUT OF STOCK",
          badgeColor: "#ef4444",
          createdAt: p.updatedAt || p.createdAt || new Date(),
        });
      }
    });

    // 3. Live Low Stock Alerts (Stock between 1 and 5)
    const lowStockProducts = await Product.find({
      $or: [
        { stockQuantity: { $gt: 0, $lte: 5 } },
        { stock: { $gt: 0, $lte: 5 } }
      ]
    }).lean();

    lowStockProducts.forEach((p: any) => {
      const id = `low_${p._id}`;
      const qty = p.stockQuantity ?? p.stock ?? 1;
      if (!dismissedSet.has(id)) {
        notifications.push({
          id,
          title: `⚠️ Low Stock: ${p.productName || p.name || "Product"}`,
          message: `Only ${qty} units left for SKU "${p.skuCode || p.sku || "N/A"}". Consider restocking soon.`,
          type: "inventory",
          category: "stock",
          link: "/dashboard/inventory",
          read: readMap.get(id) || false,
          badge: `${qty} LEFT`,
          badgeColor: "#f59e0b",
          createdAt: p.updatedAt || p.createdAt || new Date(),
        });
      }
    });

    // 4. Live Out of Stock Combo Products
    const outOfStockCombos = await ComboProduct.find({
      $or: [{ stockQuantity: { $lte: 0 } }, { stock: { $lte: 0 } }]
    }).lean();

    outOfStockCombos.forEach((c: any) => {
      const id = `oos_combo_${c._id}`;
      if (!dismissedSet.has(id)) {
        notifications.push({
          id,
          title: `🚨 Combo Out of Stock: ${c.title || c.name || "Combo Product"}`,
          message: `Combo SKU "${c.comboSku || c.sku || "N/A"}" is currently out of stock.`,
          type: "alert",
          category: "stock",
          link: "/dashboard/inventory",
          read: readMap.get(id) || false,
          badge: "COMBO OOS",
          badgeColor: "#ef4444",
          createdAt: c.updatedAt || c.createdAt || new Date(),
        });
      }
    });

    // 5. Live Recent Orders (Last 25 orders)
    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(25)
      .populate("user")
      .lean();

    recentOrders.forEach((o: any) => {
      const shortId = o._id.toString().slice(-8).toUpperCase();
      const customerName = o.shippingAddress?.name || o.user?.name || "Customer";
      const totalFormatted = Number(o.totalPrice || 0).toLocaleString("en-IN");
      const itemsSummary = Array.isArray(o.orderItems)
        ? o.orderItems.map((i: any) => `${i.name || "Item"} (x${i.qty || 1})`).join(", ")
        : "Order items";

      if (o.status === "Paid") {
        const id = `ord_paid_${o._id}`;
        if (!dismissedSet.has(id)) {
          notifications.push({
            id,
            title: `💰 Payment Received: Order #${shortId}`,
            message: `${customerName} completed payment of ₹${totalFormatted} for ${itemsSummary}.`,
            type: "order",
            category: "order",
            link: "/dashboard/orders",
            read: readMap.get(id) || false,
            badge: "PAID",
            badgeColor: "#22c55e",
            createdAt: o.createdAt || new Date(),
          });
        }
      } else if (o.status === "Pending") {
        const id = `ord_pend_${o._id}`;
        if (!dismissedSet.has(id)) {
          notifications.push({
            id,
            title: `📦 New Order Placed: #${shortId}`,
            message: `${customerName} placed order #${shortId} worth ₹${totalFormatted}.`,
            type: "order",
            category: "order",
            link: "/dashboard/orders",
            read: readMap.get(id) || false,
            badge: "PENDING",
            badgeColor: "#3b82f6",
            createdAt: o.createdAt || new Date(),
          });
        }
      } else if (o.status === "Failed") {
        const id = `ord_fail_${o._id}`;
        if (!dismissedSet.has(id)) {
          notifications.push({
            id,
            title: `⚠️ Payment Failed / Reconcile Needed: #${shortId}`,
            message: `Order #${shortId} from ${customerName} (₹${totalFormatted}) failed or requires SabPaisa reconciliation.`,
            type: "alert",
            category: "order",
            link: "/dashboard/orders",
            read: readMap.get(id) || false,
            badge: "FAILED",
            badgeColor: "#f43f5e",
            createdAt: o.createdAt || new Date(),
          });
        }
      }

      // Shipped status notification
      if (o.awbNumber) {
        const shipId = `ship_${o._id}_${o.awbNumber}`;
        if (!dismissedSet.has(shipId)) {
          notifications.push({
            id: shipId,
            title: `🚚 Dispatched: Order #${shortId}`,
            message: `Consignment booked with ${o.courierName || "iThink Logistics"} (AWB: ${o.awbNumber}).`,
            type: "order",
            category: "shipping",
            link: "/dashboard/orders",
            read: readMap.get(shipId) || false,
            badge: "SHIPPED",
            badgeColor: "#a855f7",
            createdAt: o.updatedAt || o.createdAt || new Date(),
          });
        }
      }
    });

    // 6. Live New Customer Signups (Last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentUsers = await User.find({ createdAt: { $gte: sevenDaysAgo } })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    recentUsers.forEach((u: any) => {
      const id = `usr_${u._id}`;
      if (!dismissedSet.has(id)) {
        notifications.push({
          id,
          title: `👤 New Customer Registered: ${u.name || "Customer"}`,
          message: `${u.name || "New user"} (${u.email || u.number || "No contact"}) created an account.`,
          type: "customer",
          category: "customer",
          link: "/dashboard/customers",
          read: readMap.get(id) || false,
          badge: "NEW USER",
          badgeColor: "#6366f1",
          createdAt: u.createdAt || new Date(),
        });
      }
    });

    // Sort all notifications newest first
    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const unreadCount = notifications.filter((n) => !n.read).length;
    const stats = {
      total: notifications.length,
      unread: unreadCount,
      outOfStock: outOfStockProducts.length + outOfStockCombos.length,
      lowStock: lowStockProducts.length,
      recentOrders: recentOrders.length,
    };

    return res.status(200).json({
      success: true,
      data: notifications,
      stats,
    });
  } catch (error: any) {
    console.error("Get Notifications Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch notifications",
    });
  }
};

export const markNotificationRead = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Notification ID is required" });
    }

    await Notification.findOneAndUpdate(
      { notificationId: id },
      {
        $set: {
          notificationId: id,
          read: true,
          title: req.body?.title || "Notification",
          message: req.body?.message || "",
          type: req.body?.type || "system",
        },
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, message: "Notification marked as read" });
  } catch (error: any) {
    console.error("Mark Read Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to mark read" });
  }
};

export const markAllNotificationsRead = async (req: Request, res: Response): Promise<any> => {
  try {
    const { notificationIds = [] } = req.body;

    if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      const ops = notificationIds.map((id: string) => ({
        updateOne: {
          filter: { notificationId: id },
          update: { $set: { notificationId: id, read: true } },
          upsert: true,
        },
      }));
      await Notification.bulkWrite(ops);
    }

    return res.status(200).json({ success: true, message: "All notifications marked as read" });
  } catch (error: any) {
    console.error("Mark All Read Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to mark all read" });
  }
};

export const dismissNotification = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Notification ID is required" });
    }

    await Notification.findOneAndUpdate(
      { notificationId: id },
      {
        $set: {
          notificationId: id,
          read: true,
          "metadata.dismissed": true,
        },
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true, message: "Notification dismissed" });
  } catch (error: any) {
    console.error("Dismiss Notification Error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to dismiss" });
  }
};
