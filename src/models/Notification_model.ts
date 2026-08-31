import mongoose, { Schema, Document } from "mongoose";

export interface INotification extends Document {
  notificationId: string;
  title: string;
  message: string;
  type: "order" | "inventory" | "alert" | "customer" | "system";
  link?: string;
  read: boolean;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    notificationId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["order", "inventory", "alert", "customer", "system"],
      default: "system",
    },
    link: {
      type: String,
      default: "/dashboard",
    },
    read: {
      type: Boolean,
      default: false,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.models.Notification || mongoose.model<INotification>("Notification", notificationSchema);
