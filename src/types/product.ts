// types/product.ts

import { ObjectId } from "mongodb";

export interface ProductVariant {
  id: string;
  color: string;
  design?: string;
  sellingPrice: number;
  mrp: number;
  stockQuantity: number;
  images: string[];
}

export interface Product {
  _id?: ObjectId;

  productName: string;
  skuCode: string;

  category: string;
  subCategory: string;

  variants: ProductVariant[];

  sellingPrice: number;
  mrp: number;

  stockQuantity: number;

  shortDescription: string;
  detailedDescription: string;

  weight: number;

  dimensions: {
    length: number;
    width: number;
    height: number;
  };

  gst: number;

  active: boolean;

  thumbnail: string;

  createdAt: Date;
  updatedAt: Date;
}