import mongoose, { Document } from "mongoose";

export interface IOrderItem {
  name: string;
  qty: number;
  price: number;
}

export interface IOrder extends Document {
  user: mongoose.Schema.Types.ObjectId;
  orderItems: IOrderItem[];
  totalPrice: number;
  status: string;
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
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model<IOrder>("Order", orderSchema);
