import mongoose, { Schema, Document } from "mongoose";

export interface IComboItem {
  product: mongoose.Types.ObjectId;
  quantity: number;
}

export interface IComboProduct extends Document {
  comboName: string;
  comboSku: string;
  active: boolean;
  published: boolean;
  comboDesc?: string;
  comboPrice: number;
  stockLogic: "auto" | "manual";
  comboStock: number;
  reorderLevel?: number;
  items: IComboItem[];
  createdAt: Date;
  updatedAt: Date;
}

const comboProductSchema = new Schema<IComboProduct>(
  {
    comboName: {
      type: String,
      required: true,
      trim: true,
    },
    comboSku: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    active: {
      type: Boolean,
      default: true,
    },
    published: {
      type: Boolean,
      default: false,
    },
    comboDesc: {
      type: String,
      default: "",
    },
    comboPrice: {
      type: Number,
      required: true,
      default: 0,
    },
    stockLogic: {
      type: String,
      enum: ["auto", "manual"],
      default: "auto",
    },
    comboStock: {
      type: Number,
      default: 0,
    },
    reorderLevel: {
      type: Number,
      default: 5,
    },
    items: [
      {
        product: {
          type: Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          default: 1,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IComboProduct>("ComboProduct", comboProductSchema);
