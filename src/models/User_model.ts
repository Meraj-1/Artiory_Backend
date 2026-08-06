import mongoose, { Document } from "mongoose";

export interface IUser extends Document {
  name: string;
  email: string;
  googleId: string;
  profileImage?: string;
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
      required: true,
      unique: true
    },
    profileImage: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model<IUser>("User", userSchema);