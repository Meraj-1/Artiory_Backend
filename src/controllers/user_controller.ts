import { Request, Response } from "express";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2Client, R2_BUCKET_NAME, R2_PUBLIC_URL } from "../config/r2";
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
    const publicUrl = `${R2_PUBLIC_URL}/${fileName}`;

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


export const AddAddress = async (req: Request, res: Response): Promise<any> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const {
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
      userId: user._id,
      home,
      street,
      city,
      state,
      postalCode,
      country,
      phone,
      createdAt: new Date(),
      updatedAt: new Date()
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
      data: { _id: result.insertedId, ...address }
    });
  } catch (error) {
    console.error("Add address error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

export const getAddresses = async (req: Request, res: Response): Promise<any> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(500).json({ success: false, message: "Database connection not available" });
    }

    const addresses = await db.collection("addresses").find({
      $or: [
        { userId: user._id.toString() },
        { userId: new mongoose.Types.ObjectId(String(user._id)) }
      ]
    }).toArray();

    return res.status(200).json({
      success: true,
      data: addresses
    });
  } catch (error) {
    console.error("Get addresses error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

export const updateAddress = async (req: Request, res: Response): Promise<any> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid address ID" });
    }

    const {
      home,
      street,
      city,
      state,
      postalCode,
      country,
      phone,
    } = req.body;

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(500).json({ success: false, message: "Database connection not available" });
    }

    const addressObjectId = new mongoose.Types.ObjectId(id);

    const address = await db.collection("addresses").findOne({ _id: addressObjectId });
    if (!address) {
      return res.status(404).json({ success: false, message: "Address not found" });
    }

    if (String(address.userId) !== String(user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to update this address" });
    }

    const updateFields: any = {
      updatedAt: new Date()
    };
    if (home !== undefined) updateFields.home = home;
    if (street !== undefined) updateFields.street = street;
    if (city !== undefined) updateFields.city = city;
    if (state !== undefined) updateFields.state = state;
    if (postalCode !== undefined) updateFields.postalCode = postalCode;
    if (country !== undefined) updateFields.country = country;
    if (phone !== undefined) updateFields.phone = phone;

    await db.collection("addresses").updateOne(
      { _id: addressObjectId },
      { $set: updateFields }
    );

    const updatedAddress = await db.collection("addresses").findOne({ _id: addressObjectId });

    return res.status(200).json({
      success: true,
      message: "Address updated successfully",
      data: updatedAddress
    });
  } catch (error) {
    console.error("Update address error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

export const deleteAddress = async (req: Request, res: Response): Promise<any> => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ success: false, message: "Not authorized" });
    }

    const id = String(req.params.id);
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid address ID" });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(500).json({ success: false, message: "Database connection not available" });
    }

    const addressObjectId = new mongoose.Types.ObjectId(id);

    const address = await db.collection("addresses").findOne({ _id: addressObjectId });
    if (!address) {
      return res.status(404).json({ success: false, message: "Address not found" });
    }

    if (String(address.userId) !== String(user._id)) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this address" });
    }

    await db.collection("addresses").deleteOne({ _id: addressObjectId });

    return res.status(200).json({
      success: true,
      message: "Address deleted successfully"
    });
  } catch (error) {
    console.error("Delete address error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};