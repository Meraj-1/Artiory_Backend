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
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model<IUser>("User", userSchema);