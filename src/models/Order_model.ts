import mongoose, { Document } from "mongoose";

export interface IOrderItem {
  productId: mongoose.Schema.Types.ObjectId;
  name: string;
  qty: number;
  price: number;
}

export interface IOrder extends Document {
  user: mongoose.Schema.Types.ObjectId;
  orderItems: IOrderItem[];
  totalPrice: number;
  status: string;
  awbNumber?: string;
  courierName?: string;
  logisticsOrderId?: string;
  shipmentStatus: string;
  shippingLabelUrl?: string;
  clientTxnId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderSchema = new mongoose.Schema<IOrder>(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "User"
    },
    orderItems: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        name: { type: String, required: true },
        qty: { type: Number, required: true },
        price: { type: Number, required: true }
      }
    ],
    totalPrice: {
      type: Number,
      required: true,
      default: 0.0
    },
    status: {
      type: String,
      required: true,
      default: "Pending", // Pending, Paid, Delivered, Cancelled
    },
    awbNumber: {
      type: String
    },
    courierName: {
      type: String
    },
    logisticsOrderId: {
      type: String
    },
    shipmentStatus: {
      type: String,
      required: true,
      default: "Unshipped" // Unshipped, Shipped, In-Transit, Delivered, RTO
    },
    shippingLabelUrl: {
      type: String
    },
    clientTxnId: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model<IOrder>("Order", orderSchema);
