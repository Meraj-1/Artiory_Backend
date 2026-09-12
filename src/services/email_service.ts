import { Resend } from "resend";
import mongoose from "mongoose";
import Order from "../models/Order_model";
import User from "../models/User_model";
void User;

// Initialize Resend using secured environment variable
const getResendClient = (): Resend | null => {
  const apiKey = (process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    console.warn("Resend email skipped: RESEND_API_KEY is not configured.");
    return null;
  }
  return new Resend(apiKey);
};

/**
 * Direct function matching the pastebin reference signature:
 * handleSuccessfulPayment(orderId, customerEmail, amount)
 */
export async function handleSuccessfulPayment(
  orderId: string,
  customerEmail: string,
  amount: number | string
): Promise<{ customerEmailSent: boolean; adminEmailSent: boolean }> {
  const resend = getResendClient();
  if (!resend) {
    return { customerEmailSent: false, adminEmailSent: false };
  }

  let customerEmailSent = false;
  let adminEmailSent = false;

  try {
    // 1. Send Order Confirmation Email to the Customer
    if (customerEmail && customerEmail.includes("@")) {
      try {
        const customerEmailResponse = await resend.emails.send({
          from: "Artiory Orders <orders@artiory.com>", // Verified domain
          to: customerEmail.trim(),                   // Dynamic customer address
          replyTo: "support@artiory.com",             // Where customer replies will route to
          subject: `Order #${orderId} Confirmed!`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px; background-color: #ffffff;">
              <h2 style="color: #111827; margin-top: 0; font-size: 22px;">Thank you for your purchase!</h2>
              <p style="color: #374151; font-size: 15px; line-height: 1.5;">We have successfully processed your payment of <strong>₹${amount}</strong> through SabPaisa.</p>
              <p style="color: #374151; font-size: 15px; line-height: 1.5;">Your order ID is <strong>#${orderId}</strong>. We are currently preparing your package and will update you as soon as it ships.</p>
              <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 24px 0;">
              <p style="font-size: 13px; color: #6b7280; line-height: 1.4;">If you have any questions, reply to this email or reach out to <a href="mailto:support@artiory.com" style="color: #2563eb; text-decoration: underline;">support@artiory.com</a>.</p>
            </div>
          `,
        });

        if (customerEmailResponse.data?.id) {
          console.log(`Customer confirmation email sent: ${customerEmailResponse.data.id} (To: ${customerEmail})`);
          customerEmailSent = true;
        } else if (customerEmailResponse.error) {
          console.error("Resend customer email error:", customerEmailResponse.error);
        }
      } catch (custErr) {
        console.error("Failed to send customer email via Resend:", custErr);
      }
    } else {
      console.warn(`Customer email skipped: Invalid or missing email address (${customerEmail})`);
    }

    // 2. Send Alert Email to the Store Admin
    try {
      const adminRecipient = (process.env.ADMIN_EMAIL || "admin@artiory.com").trim();
      const adminEmailResponse = await resend.emails.send({
        from: "System Alert <system@artiory.com>",
        to: adminRecipient,
        subject: `[ALERT] New Paid Order Received #${orderId}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px; background-color: #ffffff;">
            <h3 style="color: #111827; margin-top: 0; font-size: 20px;">New Paid Order Notification</h3>
            <p style="font-size: 15px; margin: 8px 0;"><strong>Order ID:</strong> #${orderId}</p>
            <p style="font-size: 15px; margin: 8px 0;"><strong>Amount Collected:</strong> ₹${amount}</p>
            <p style="font-size: 15px; margin: 8px 0;"><strong>Customer Email:</strong> ${customerEmail}</p>
            <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;">
            <p style="font-size: 14px; color: #374151;">Please check your <a href="https://dashboard.artiory.com/dashboard/orders" style="color: #2563eb; font-weight: bold; text-decoration: underline;">Admin Dashboard</a> to review the order and generate iThinkLogistics shipping labels.</p>
          </div>
        `,
      });

      if (adminEmailResponse.data?.id) {
        console.log(`Admin alert email sent: ${adminEmailResponse.data.id} (To: ${adminRecipient})`);
        adminEmailSent = true;
      } else if (adminEmailResponse.error) {
        console.error("Resend admin alert email error:", adminEmailResponse.error);
      }
    } catch (adminErr) {
      console.error("Failed to send admin alert email via Resend:", adminErr);
    }
  } catch (error) {
    console.error("Failed to process transaction emails via Resend:", error);
  }

  return { customerEmailSent, adminEmailSent };
}

/**
 * High-level helper that extracts details directly from the Order document in MongoDB
 * and triggers handleSuccessfulPayment with rich order info
 */
export async function sendOrderConfirmationEmails(
  orderIdOrDoc: string | mongoose.Types.ObjectId | any
): Promise<void> {
  try {
    let order = orderIdOrDoc;
    if (typeof order === "string" || order instanceof mongoose.Types.ObjectId) {
      order = await Order.findById(order).populate("user");
    }

    if (!order) {
      console.warn(`sendOrderConfirmationEmails skipped: Order not found (${orderIdOrDoc})`);
      return;
    }

    const orderId = order._id.toString();
    const user = order.user as any;
    const customerEmail =
      order.shippingAddress?.email ||
      user?.email ||
      "";
    const amount = Number(order.totalPrice || 0).toFixed(2);
    const customerName =
      order.shippingAddress?.name ||
      user?.name ||
      "Valued Customer";

    // Format item summary for customer and admin
    const items = order.orderItems || [];
    const itemsHtmlRows = items
      .map(
        (item: any) => `
        <tr style="border-bottom: 1px solid #f0f0f0;">
          <td style="padding: 10px 0; color: #374151;">${item.name} <span style="color: #6b7280; font-size: 13px;">(x${item.qty})</span></td>
          <td style="padding: 10px 0; text-align: right; font-weight: 600; color: #111827;">₹${(Number(item.price || 0) * Number(item.qty || 1)).toFixed(2)}</td>
        </tr>
      `
      )
      .join("");

    const itemsSummaryTable = items.length
      ? `
      <div style="background-color: #f9fafb; border: 1px solid #f3f4f6; padding: 16px; border-radius: 6px; margin: 20px 0;">
        <h4 style="margin: 0 0 12px 0; color: #111827; font-size: 15px;">Order Items</h4>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          ${itemsHtmlRows}
          <tr style="border-top: 2px solid #e5e7eb; font-weight: bold;">
            <td style="padding: 10px 0; color: #111827;">Total Paid:</td>
            <td style="padding: 10px 0; text-align: right; color: #111827;">₹${amount}</td>
          </tr>
        </table>
      </div>
    `
      : "";

    const shippingAddressText = order.shippingAddress
      ? [
          order.shippingAddress.address || [order.shippingAddress.home, order.shippingAddress.street].filter(Boolean).join(", "),
          order.shippingAddress.landmark,
          [order.shippingAddress.city, order.shippingAddress.state, order.shippingAddress.postalCode].filter(Boolean).join(" - "),
          order.shippingAddress.country || "India",
        ]
          .filter(Boolean)
          .join("<br>")
      : "";

    const resend = getResendClient();
    if (!resend) return;

    // 1. Send Rich Order Confirmation Email to Customer
    if (customerEmail && customerEmail.includes("@")) {
      try {
        const custRes = await resend.emails.send({
          from: "Artiory Orders <orders@artiory.com>",
          to: customerEmail.trim(),
          replyTo: "support@artiory.com",
          subject: `Order #${orderId} Confirmed!`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px; background-color: #ffffff;">
              <h2 style="color: #111827; margin-top: 0; font-size: 22px;">Thank you for your purchase, ${customerName}!</h2>
              <p style="color: #374151; font-size: 15px; line-height: 1.5;">We have successfully processed your payment of <strong>₹${amount}</strong> through SabPaisa.</p>
              <p style="color: #374151; font-size: 15px; line-height: 1.5;">Your order ID is <strong>#${orderId}</strong>. We are currently preparing your package and will update you as soon as it ships.</p>
              
              ${itemsSummaryTable}

              ${
                shippingAddressText
                  ? `
                <div style="margin: 20px 0; font-size: 14px; color: #374151;">
                  <strong style="color: #111827;">Shipping Address:</strong><br>
                  ${customerName}<br>
                  ${shippingAddressText}
                </div>
              `
                  : ""
              }

              <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 24px 0;">
              <p style="font-size: 13px; color: #6b7280; line-height: 1.4;">If you have any questions, reply to this email or reach out to <a href="mailto:support@artiory.com" style="color: #2563eb; text-decoration: underline;">support@artiory.com</a>.</p>
            </div>
          `,
        });
        if (custRes.data?.id) {
          console.log(`[Resend] Customer confirmation sent: ${custRes.data.id} (To: ${customerEmail})`);
        } else if (custRes.error) {
          console.error("[Resend] Customer email error:", custRes.error);
        }
      } catch (e) {
        console.error("[Resend] Customer email exception:", e);
      }
    }

    // 2. Send Alert Email to Store Admin
    try {
      const adminRecipient = (process.env.ADMIN_EMAIL || "admin@artiory.com").trim();
      const adminRes = await resend.emails.send({
        from: "System Alert <system@artiory.com>",
        to: adminRecipient,
        subject: `[ALERT] New Paid Order Received #${orderId}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px; background-color: #ffffff;">
            <h3 style="color: #111827; margin-top: 0; font-size: 20px;">New Paid Order Notification</h3>
            <p style="font-size: 15px; margin: 8px 0;"><strong>Order ID:</strong> #${orderId}</p>
            <p style="font-size: 15px; margin: 8px 0;"><strong>Amount Collected:</strong> ₹${amount}</p>
            <p style="font-size: 15px; margin: 8px 0;"><strong>Customer Name:</strong> ${customerName}</p>
            <p style="font-size: 15px; margin: 8px 0;"><strong>Customer Email:</strong> ${customerEmail}</p>
            <p style="font-size: 15px; margin: 8px 0;"><strong>Customer Phone:</strong> ${order.shippingAddress?.phone || user?.number || "N/A"}</p>
            
            ${itemsSummaryTable}

            <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 20px 0;">
            <p style="font-size: 14px; color: #374151;">Please check your <a href="https://dashboard.artiory.com/dashboard/orders" style="color: #2563eb; font-weight: bold; text-decoration: underline;">Admin Dashboard</a> to review the order and generate iThinkLogistics shipping labels.</p>
          </div>
        `,
      });
      if (adminRes.data?.id) {
        console.log(`[Resend] Admin alert sent: ${adminRes.data.id} (To: ${adminRecipient})`);
      } else if (adminRes.error) {
        console.error("[Resend] Admin alert error:", adminRes.error);
      }
    } catch (e) {
      console.error("[Resend] Admin email exception:", e);
    }
  } catch (error) {
    console.error("Failed to execute sendOrderConfirmationEmails:", error);
  }
}

/**
 * Sends real-time shipment dispatch notification to the customer with Courier Name, AWB, and Tracking Link
 */
export async function sendShipmentNotificationEmail(
  orderIdOrDoc: string | mongoose.Types.ObjectId | any
): Promise<boolean> {
  try {
    let order = orderIdOrDoc;
    if (typeof order === "string" || order instanceof mongoose.Types.ObjectId) {
      order = await Order.findById(order).populate("user");
    }

    if (!order) {
      console.warn("sendShipmentNotificationEmail skipped: Order not found");
      return false;
    }

    const orderId = order._id.toString();
    const user = order.user as any;
    const customerEmail =
      order.shippingAddress?.email ||
      user?.email ||
      "";

    if (!customerEmail || !customerEmail.includes("@")) {
      console.warn(`sendShipmentNotificationEmail skipped: No valid customer email for order ${orderId}`);
      return false;
    }

    const customerName =
      order.shippingAddress?.name ||
      user?.name ||
      "Valued Customer";

    const courier = order.courierName || "Delhivery";
    const awb = order.awbNumber || "N/A";
    const trackingUrl =
      order.trackingUrl ||
      (order.awbNumber ? `https://www.ithinklogistics.co.in/postship/tracking/${order.awbNumber}` : `https://artiory.com/track-order?orderId=${orderId}`);

    const resend = getResendClient();
    if (!resend) return false;

    const res = await resend.emails.send({
      from: "Artiory Orders <orders@artiory.com>",
      to: customerEmail.trim(),
      replyTo: "support@artiory.com",
      subject: `Your Order #${orderId} Has Shipped with ${courier}! 📦`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #eaeaea; border-radius: 8px; background-color: #ffffff;">
          <h2 style="color: #111827; margin-top: 0; font-size: 22px;">Good news, ${customerName}! Your order has been dispatched.</h2>
          <p style="color: #374151; font-size: 15px; line-height: 1.5;">
            Your package for Order <strong>#${orderId}</strong> is on its way to you via <strong>${courier}</strong>.
          </p>

          <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 18px; margin: 20px 0;">
            <div style="margin-bottom: 12px;">
              <span style="font-size: 13px; color: #64748b; text-transform: uppercase; font-weight: 600;">Courier Partner:</span>
              <div style="font-size: 16px; font-weight: 700; color: #0f172a;">${courier}</div>
            </div>
            <div style="margin-bottom: 16px;">
              <span style="font-size: 13px; color: #64748b; text-transform: uppercase; font-weight: 600;">AWB / Tracking Number:</span>
              <div style="font-size: 18px; font-family: monospace; font-weight: 700; color: #0f172a;">${awb}</div>
            </div>
            <div style="text-align: center; margin-top: 16px;">
              <a href="${trackingUrl}" style="background-color: #000000; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-size: 14px; font-weight: bold; display: inline-block;">Track Shipment Live</a>
            </div>
          </div>

          <p style="font-size: 13px; color: #64748b; line-height: 1.5;">
            You can track the progress of your shipment in real-time by clicking the button above or by visiting <a href="https://artiory.com/track-order" style="color: #2563eb; text-decoration: underline;">artiory.com/track-order</a>.
          </p>

          <hr style="border: 0; border-top: 1px solid #eaeaea; margin: 24px 0;">
          <p style="font-size: 12px; color: #94a3b8;">If you need any assistance, reply directly to this email or reach us at <a href="mailto:support@artiory.com" style="color: #2563eb;">support@artiory.com</a>.</p>
        </div>
      `,
    });

    if (res.data?.id) {
      console.log(`[Resend] Shipment dispatched email sent: ${res.data.id} (To: ${customerEmail}, AWB: ${awb})`);
      return true;
    } else if (res.error) {
      console.error("[Resend] Shipment dispatched email error:", res.error);
      return false;
    }
    return false;
  } catch (err) {
    console.error("Failed to send shipment dispatched email:", err);
    return false;
  }
}
