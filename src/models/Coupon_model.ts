import mongoose, { Schema, Document } from "mongoose";

export interface ICoupon extends Document {
  code: string;
  type: "percent" | "flat";
  value: number;
  minOrder: number;
  uses: number;
  maxUses: number;
  expiry: Date;
  active: boolean;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    type: {
      type: String,
      enum: ["percent", "flat"],
      required: true,
      default: "percent",
    },
    value: {
      type: Number,
      required: true,
      default: 0,
    },
    minOrder: {
      type: Number,
      default: 0,
    },
    uses: {
      type: Number,
      default: 0,
    },
    maxUses: {
      type: Number,
      default: 999,
    },
    expiry: {
      type: Date,
      required: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    description: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<ICoupon>("Coupon", couponSchema);
