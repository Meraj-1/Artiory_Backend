import { Request, Response } from "express";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET_NAME } from "../config/r2";
import User from "../models/User_model";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

export const uploadProfileImage = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Not authorized" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    const fileExt = req.file.originalname.split(".").pop();
    const fileName = `profiles/${user._id}-${uuidv4()}.${fileExt}`;

    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: fileName,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
    });

    await r2Client.send(command);

    // Assuming public access is configured on the bucket, construct the URL
    // Replace YOUR_R2_PUBLIC_URL in .env with your custom domain or R2 dev URL
    const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileName}`;

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { profileImage: publicUrl },
      { new: true }
    ).select("-googleId");

    res.status(200).json({
      message: "Profile image uploaded successfully",
      profileImage: publicUrl,
      user: updatedUser
    });
  } catch (error) {
    console.error("Profile image upload error:", error);
    res.status(500).json({ message: "Failed to upload image" });
  }
};


export const AddAddress = async (req: Request, res: Response) => {
  try {
    const {
      userId,
      home,
      street,
      city,
      state,
      postalCode,
      country,
      phone,
    } = req.body;

    // Validation
    if (
      !userId ||
      !home ||
      !street ||
      !city ||
      !state ||
      !postalCode ||
      !country ||
      !phone
    ) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    const address = {
      userId,
      home,
      street,
      city,
      state,
      postalCode,
      country,
      phone,
      createdAt: new Date(),
    };

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(500).json({
        success: false,
        message: "Database connection is not available.",
      });
    }

    const result = await db.collection("addresses").insertOne(address);

    return res.status(201).json({
      success: true,
      message: "Address added successfully.",
      insertedId: result.insertedId,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};