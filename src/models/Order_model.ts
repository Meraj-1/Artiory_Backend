import mongoose, { Document } from "mongoose";

export interface IOrderItem {
  productId: mongoose.Schema.Types.ObjectId;
  name: string;
  qty: number;
  price: number;
}

export interface IShippingAddress {
  name?: string;
  email?: string;
  phone?: string;
  alternatePhone?: string;
  home?: string;
  street?: string;
  landmark?: string;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  addressType?: string;
}

export interface IOrder extends Document {
  user: mongoose.Schema.Types.ObjectId;
  orderItems: IOrderItem[];
  totalPrice: number;
  discountAmount?: number;
  shippingCharge?: number;
  couponCode?: string;
  shippingAddress?: IShippingAddress;
  status: string;
  awbNumber?: string;
  courierName?: string;
  logisticsOrderId?: string;
  shipmentStatus: string;
  shippingLabelUrl?: string;
  clientTxnId?: string;
  returnUrl?: string;
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
    discountAmount: {
      type: Number,
      default: 0.0
    },
    shippingCharge: {
      type: Number,
      default: 0.0
    },
    couponCode: {
      type: String
    },
    shippingAddress: {
      name: { type: String },
      email: { type: String },
      phone: { type: String },
      alternatePhone: { type: String },
      home: { type: String },
      street: { type: String },
      landmark: { type: String },
      address: { type: String },
      city: { type: String },
      state: { type: String },
      postalCode: { type: String },
      country: { type: String, default: "India" },
      addressType: { type: String, default: "Home" }
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
    },
    returnUrl: {
      type: String
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model<IOrder>("Order", orderSchema);
