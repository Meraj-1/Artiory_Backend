import mongoose, { Schema, Document } from "mongoose";

export interface IProductVariant {
  color?: string;
  design?: string;
  sellingPrice?: number;
  mrp?: number;
  stockQuantity?: number;
  imageUrl?: string;
}

export interface IProduct extends Document {
  productName: string;
  skuCode: string;
  category?: string;
  subCategory?: string;
  variants?: IProductVariant[];
  sellingPrice?: number;
  mrp?: number;
  stockQuantity?: number;
  reorderLevel?: number;
  shortDescription?: string;
  detailedDescription?: string;
  weight?: number; // Weight in grams (e.g. 150)
  weightGrams?: number;
  weightUnit?: string;
  dimensions?: {
    length?: number;
    width?: number;
    height?: number;
  };
  gst?: number;
  active: boolean;
  published: boolean;
  thumbnail?: string;
  images?: string[];
  deletedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    skuCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    category: {
      type: String,
      default: "",
    },
    subCategory: {
      type: String,
      default: "",
    },
    variants: [
      {
        color: String,
        design: String,
        sellingPrice: Number,
        mrp: Number,
        stockQuantity: Number,
        imageUrl: String,
      },
    ],
    sellingPrice: {
      type: Number,
      default: 0,
    },
    mrp: {
      type: Number,
      default: 0,
    },
    stockQuantity: {
      type: Number,
      default: 0,
    },
    reorderLevel: {
      type: Number,
      default: 5,
    },
    shortDescription: {
      type: String,
      default: "",
    },
    detailedDescription: {
      type: String,
      default: "",
    },
    weight: {
      type: Number,
      default: 0,
    },
    weightGrams: {
      type: Number,
      default: 0,
    },
    weightUnit: {
      type: String,
      default: "gm",
    },
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
    },
    gst: {
      type: Number,
      default: 0,
    },
    active: {
      type: Boolean,
      default: true,
    },
    published: {
      type: Boolean,
      default: false,
    },
    thumbnail: {
      type: String,
      default: "",
    },
    images: [{ type: String }],
    deletedAt: {
      type: Date,
      index: { expires: '7d' },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model<IProduct>("Product", productSchema);
