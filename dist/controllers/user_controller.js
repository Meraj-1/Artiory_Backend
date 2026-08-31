"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncUserWishlist = exports.getUserWishlist = exports.syncUserCart = exports.getUserCart = exports.deleteAddress = exports.updateAddress = exports.getAddresses = exports.AddAddress = exports.uploadProfileImage = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const r2_1 = require("../config/r2");
const User_model_1 = __importDefault(require("../models/User_model"));
const Product_model_1 = __importDefault(require("../models/Product_model"));
const mongoose_1 = __importDefault(require("mongoose"));
const uuid_1 = require("uuid");
const uploadProfileImage = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ message: "Not authorized" });
        }
        if (!req.file) {
            return res.status(400).json({ message: "No image file provided" });
        }
        const fileExt = req.file.originalname.split(".").pop();
        const fileName = `profiles/${user._id}-${(0, uuid_1.v4)()}.${fileExt}`;
        const command = new client_s3_1.PutObjectCommand({
            Bucket: r2_1.R2_BUCKET_NAME,
            Key: fileName,
            Body: req.file.buffer,
            ContentType: req.file.mimetype,
        });
        await r2_1.r2Client.send(command);
        // Assuming public access is configured on the bucket, construct the URL
        // Replace YOUR_R2_PUBLIC_URL in .env with your custom domain or R2 dev URL
        const publicUrl = `${r2_1.R2_PUBLIC_URL}/${fileName}`;
        const updatedUser = await User_model_1.default.findByIdAndUpdate(user._id, { profileImage: publicUrl }, { new: true }).select("-googleId");
        res.status(200).json({
            message: "Profile image uploaded successfully",
            profileImage: publicUrl,
            user: updatedUser
        });
    }
    catch (error) {
        console.error("Profile image upload error:", error);
        res.status(500).json({ message: "Failed to upload image" });
    }
};
exports.uploadProfileImage = uploadProfileImage;
const AddAddress = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized" });
        }
        const { type, home, street, city, state, postalCode, country, phone, } = req.body;
        // Validation
        if (!home ||
            !street ||
            !city ||
            !state ||
            !postalCode ||
            !country ||
            !phone) {
            return res.status(400).json({
                success: false,
                message: "All fields are required.",
            });
        }
        const address = {
            userId: user._id,
            type: type || "Home",
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
        const db = mongoose_1.default.connection.db;
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
    }
    catch (error) {
        console.error("Add address error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
        });
    }
};
exports.AddAddress = AddAddress;
const getAddresses = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized" });
        }
        const db = mongoose_1.default.connection.db;
        if (!db) {
            return res.status(500).json({ success: false, message: "Database connection not available" });
        }
        const addresses = await db.collection("addresses").find({
            $or: [
                { userId: user._id.toString() },
                { userId: new mongoose_1.default.Types.ObjectId(String(user._id)) }
            ]
        }).toArray();
        return res.status(200).json({
            success: true,
            data: addresses
        });
    }
    catch (error) {
        console.error("Get addresses error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
exports.getAddresses = getAddresses;
const updateAddress = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized" });
        }
        const id = String(req.params.id);
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid address ID" });
        }
        const { home, street, city, state, postalCode, country, phone, } = req.body;
        const db = mongoose_1.default.connection.db;
        if (!db) {
            return res.status(500).json({ success: false, message: "Database connection not available" });
        }
        const addressObjectId = new mongoose_1.default.Types.ObjectId(id);
        const address = await db.collection("addresses").findOne({ _id: addressObjectId });
        if (!address) {
            return res.status(404).json({ success: false, message: "Address not found" });
        }
        if (String(address.userId) !== String(user._id)) {
            return res.status(403).json({ success: false, message: "Not authorized to update this address" });
        }
        const updateFields = {
            updatedAt: new Date()
        };
        if (home !== undefined)
            updateFields.home = home;
        if (street !== undefined)
            updateFields.street = street;
        if (city !== undefined)
            updateFields.city = city;
        if (state !== undefined)
            updateFields.state = state;
        if (postalCode !== undefined)
            updateFields.postalCode = postalCode;
        if (country !== undefined)
            updateFields.country = country;
        if (phone !== undefined)
            updateFields.phone = phone;
        await db.collection("addresses").updateOne({ _id: addressObjectId }, { $set: updateFields });
        const updatedAddress = await db.collection("addresses").findOne({ _id: addressObjectId });
        return res.status(200).json({
            success: true,
            message: "Address updated successfully",
            data: updatedAddress
        });
    }
    catch (error) {
        console.error("Update address error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
exports.updateAddress = updateAddress;
const deleteAddress = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized" });
        }
        const id = String(req.params.id);
        if (!mongoose_1.default.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: "Invalid address ID" });
        }
        const db = mongoose_1.default.connection.db;
        if (!db) {
            return res.status(500).json({ success: false, message: "Database connection not available" });
        }
        const addressObjectId = new mongoose_1.default.Types.ObjectId(id);
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
    }
    catch (error) {
        console.error("Delete address error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
exports.deleteAddress = deleteAddress;
const getUserCart = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized" });
        }
        const fullUser = await User_model_1.default.findById(user._id);
        if (!fullUser || !fullUser.cart || fullUser.cart.length === 0) {
            return res.status(200).json({ success: true, cart: [] });
        }
        const refreshedCart = await Promise.all(fullUser.cart.map(async (item) => {
            if (mongoose_1.default.Types.ObjectId.isValid(String(item.productId))) {
                const product = await Product_model_1.default.findById(item.productId);
                if (product) {
                    const currentStock = product.stockQuantity ?? 0;
                    let quantity = item.quantity;
                    if (quantity > currentStock) {
                        quantity = currentStock;
                    }
                    return {
                        ...item.toObject(),
                        stock: currentStock,
                        quantity: quantity
                    };
                }
            }
            return item.toObject();
        }));
        let needsSave = false;
        for (let i = 0; i < fullUser.cart.length; i++) {
            if (fullUser.cart[i].quantity !== refreshedCart[i].quantity) {
                needsSave = true;
                break;
            }
        }
        if (needsSave) {
            fullUser.cart = refreshedCart;
            await fullUser.save();
        }
        return res.status(200).json({
            success: true,
            cart: refreshedCart
        });
    }
    catch (error) {
        console.error("Get user cart error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
exports.getUserCart = getUserCart;
const syncUserCart = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized" });
        }
        const { cartItems } = req.body;
        if (!Array.isArray(cartItems)) {
            return res.status(400).json({ success: false, message: "cartItems must be an array" });
        }
        const fullUser = await User_model_1.default.findById(user._id);
        if (!fullUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        const validatedCartItems = await Promise.all(cartItems.map(async (item) => {
            if (mongoose_1.default.Types.ObjectId.isValid(String(item.productId))) {
                const product = await Product_model_1.default.findById(item.productId);
                if (product) {
                    const currentStock = product.stockQuantity ?? 0;
                    let quantity = item.quantity;
                    if (quantity > currentStock) {
                        quantity = currentStock;
                    }
                    return {
                        productId: item.productId,
                        name: item.name || product.productName,
                        price: item.price || product.sellingPrice || 0,
                        image: item.image || product.thumbnail || "",
                        quantity: quantity,
                        stock: currentStock
                    };
                }
            }
            return item;
        }));
        fullUser.cart = validatedCartItems;
        await fullUser.save();
        return res.status(200).json({
            success: true,
            cart: fullUser.cart
        });
    }
    catch (error) {
        console.error("Sync user cart error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
exports.syncUserCart = syncUserCart;
const getUserWishlist = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized" });
        }
        const fullUser = await User_model_1.default.findById(user._id);
        if (!fullUser || !fullUser.wishlist || fullUser.wishlist.length === 0) {
            return res.status(200).json({ success: true, wishlist: [] });
        }
        const enrichedWishlist = await Promise.all(fullUser.wishlist.map(async (item) => {
            let stock = 999;
            const rawItem = item.toObject ? item.toObject() : item;
            if (mongoose_1.default.Types.ObjectId.isValid(String(item.productId))) {
                const product = await Product_model_1.default.findById(item.productId);
                if (product) {
                    stock = product.stockQuantity ?? 0;
                    return {
                        ...rawItem,
                        stock: stock,
                        stockQuantity: stock,
                        isOutOfStock: stock <= 0,
                        price: product.sellingPrice || item.price,
                        name: product.productName || item.name,
                        image: product.thumbnail || item.image
                    };
                }
            }
            return {
                ...rawItem,
                stock: stock,
                stockQuantity: stock,
                isOutOfStock: stock <= 0
            };
        }));
        return res.status(200).json({
            success: true,
            wishlist: enrichedWishlist
        });
    }
    catch (error) {
        console.error("Get user wishlist error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
exports.getUserWishlist = getUserWishlist;
const syncUserWishlist = async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: "Not authorized" });
        }
        const { wishlistItems } = req.body;
        if (!Array.isArray(wishlistItems)) {
            return res.status(400).json({ success: false, message: "wishlistItems must be an array" });
        }
        const fullUser = await User_model_1.default.findById(user._id);
        if (!fullUser) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        fullUser.wishlist = wishlistItems;
        await fullUser.save();
        return res.status(200).json({
            success: true,
            wishlist: fullUser.wishlist
        });
    }
    catch (error) {
        console.error("Sync user wishlist error:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
exports.syncUserWishlist = syncUserWishlist;
