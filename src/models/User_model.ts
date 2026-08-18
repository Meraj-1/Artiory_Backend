import mongoose, { Document } from "mongoose";

export interface IUser extends Document {
  name: string;
  email: string;
  googleId?: string;
  profileImage?: string;
  passwordHash?: string;
  number?: string;
  gender?: string;
  roles?: string[];
  cart?: {
    productId: string;
    name: string;
    price: number;
    image: string;
    quantity: number;
    stock?: number;
  }[];
  wishlist?: {
    productId: string;
    name: string;
    price: number;
    image: string;
  }[];
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new mongoose.Schema<IUser>(
  {
    name: {
      type: String,
      required: true
    },
    email: {
      type: String,
      required: true,
      unique: true
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true
    },
    profileImage: {
      type: String,
      default: ""
    },
    passwordHash: {
      type: String,
      default: ""
    },
    number: {
      type: String,
      default: ""
    },
    gender: {
      type: String,
      default: ""
    },
    roles: {
      type: [String],
      default: ["user"]
    },
    cart: [
      {
        productId: { type: String, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        image: { type: String, required: true },
        quantity: { type: Number, required: true, default: 1 },
        stock: { type: Number }
      }
    ],
    wishlist: [
      {
        productId: { type: String, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true },
        image: { type: String, required: true }
      }
    ]
  },
  {
    timestamps: true
  }
);

export default mongoose.model<IUser>("User", userSchema);