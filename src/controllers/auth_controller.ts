import { Request, Response } from "express";
import User from "../models/User_model";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export const googleLogin = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: "Google ID Token is required" });
    }

    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload) {
      return res.status(400).json({ message: "Invalid Google Token" });
    }

    const { email, name, sub: googleId, picture: profileImage } = payload;

    // First, check if a user exists by EMAIL (handles old email/password accounts)
    let user = await User.findOne({ email });

    if (user) {
      // User exists, just update their googleId and profile image if missing
      user.googleId = googleId;
      if (profileImage && !user.profileImage) {
        user.profileImage = profileImage;
      }
      await user.save();
    } else {
      // User doesn't exist by email, so we create a completely new user
      user = await User.create({
        name,
        email,
        googleId,
        profileImage,
      });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET!,
      {
        expiresIn: "7d"
      }
    );

    res.status(200).json({
      message: "Authentication successful",
      token,
      user
    });
  } catch (error) {
    console.error("Google Auth Error:", error);
    res.status(500).json({
      message: "Server Error during authentication"
    });
  }
};

export const logout = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    res.status(200).json({
      success: true,
      message: "Logged out successfully (client should delete token)"
    });
  } catch (error) {
    res.status(500).json({
      message: "Server Error"
    });
  }
};

export const deleteAccount = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const user = req.user; // from auth middleware
    if (!user) {
      return res.status(401).json({ message: "Not authorized" });
    }

    await User.findByIdAndDelete(user._id);

    res.status(200).json({
      message: "User account deleted successfully"
    });
  } catch (error) {
    console.error("Delete Account Error:", error);
    res.status(500).json({
      message: "Server Error while deleting account"
    });
  }
};

export const adminLogin = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const { email, password } = req.body;

    const adminEmail = process.env.ADMIN_EMAIL || "admin@artiory.com";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

    if (email && password && (email !== adminEmail || password !== adminPassword)) {
      return res.status(401).json({ message: "Invalid admin credentials" });
    }

    let user = await User.findOne({ email: adminEmail });
    if (!user) {
      user = await User.create({
        name: "Admin User",
        email: adminEmail,
        googleId: "admin-google-id-" + Date.now(),
      });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET!,
      { expiresIn: "30d" }
    );

    return res.status(200).json({
      message: "Admin login successful",
      token,
      user
    });
  } catch (error) {
    console.error("Admin Login Error:", error);
    return res.status(500).json({ message: "Server Error during admin login" });
  }
};
