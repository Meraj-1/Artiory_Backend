"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUser = exports.adminLogin = exports.deleteAccount = exports.logout = exports.googleLogin = void 0;
const User_model_1 = __importDefault(require("../models/User_model"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const google_auth_library_1 = require("google-auth-library");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const googleLogin = async (req, res) => {
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
        let user = await User_model_1.default.findOne({ email });
        if (user) {
            // User exists, just update their googleId and profile image if missing
            user.googleId = googleId;
            if (profileImage && !user.profileImage) {
                user.profileImage = profileImage;
            }
            await user.save();
        }
        else {
            // User doesn't exist by email, so we create a completely new user
            user = await User_model_1.default.create({
                name,
                email,
                googleId,
                profileImage,
            });
        }
        const token = jsonwebtoken_1.default.sign({ id: user._id }, process.env.JWT_SECRET, {
            expiresIn: "7d"
        });
        res.status(200).json({
            message: "Authentication successful",
            token,
            user
        });
    }
    catch (error) {
        console.error("Google Auth Error:", error);
        res.status(500).json({
            message: "Server Error during authentication"
        });
    }
};
exports.googleLogin = googleLogin;
const logout = async (req, res) => {
    try {
        res.status(200).json({
            success: true,
            message: "Logged out successfully (client should delete token)"
        });
    }
    catch (error) {
        res.status(500).json({
            message: "Server Error"
        });
    }
};
exports.logout = logout;
const deleteAccount = async (req, res) => {
    try {
        const user = req.user; // from auth middleware
        if (!user) {
            return res.status(401).json({ message: "Not authorized" });
        }
        await User_model_1.default.findByIdAndDelete(user._id);
        res.status(200).json({
            message: "User account deleted successfully"
        });
    }
    catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({
            message: "Server Error while deleting account"
        });
    }
};
exports.deleteAccount = deleteAccount;
const adminLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        const adminEmail = process.env.ADMIN_EMAIL || "admin@artiory.com";
        const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
        if (email && password && (email !== adminEmail || password !== adminPassword)) {
            return res.status(401).json({ message: "Invalid admin credentials" });
        }
        let user = await User_model_1.default.findOne({ email: adminEmail });
        if (!user) {
            user = await User_model_1.default.create({
                name: "Admin User",
                email: adminEmail,
                googleId: "admin-google-id-" + Date.now(),
            });
        }
        const token = jsonwebtoken_1.default.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
        return res.status(200).json({
            message: "Admin login successful",
            token,
            user
        });
    }
    catch (error) {
        console.error("Admin Login Error:", error);
        return res.status(500).json({ message: "Server Error during admin login" });
    }
};
exports.adminLogin = adminLogin;
const registerUser = async (req, res) => {
    try {
        const { name, email: rawEmail, password } = req.body;
        if (!name || !rawEmail || !password) {
            return res.status(400).json({ error: "Name, email, and password are required" });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: "Password must be at least 6 characters long" });
        }
        const email = rawEmail.toLowerCase().trim();
        const existing = await User_model_1.default.findOne({ email });
        if (existing) {
            if (existing.passwordHash) {
                return res.status(409).json({ error: "Email already in use." });
            }
            const salt = await bcryptjs_1.default.genSalt(12);
            const passwordHash = await bcryptjs_1.default.hash(password, salt);
            existing.passwordHash = passwordHash;
            existing.name = existing.name || name;
            await existing.save();
            return res.status(200).json({
                message: "Password set successfully. You can now login.",
                user: { id: existing._id, name: existing.name, email: existing.email }
            });
        }
        const salt = await bcryptjs_1.default.genSalt(12);
        const passwordHash = await bcryptjs_1.default.hash(password, salt);
        const newUser = await User_model_1.default.create({
            name,
            email,
            passwordHash,
        });
        res.status(201).json({
            message: "User registered successfully",
            user: { id: newUser._id, name: newUser.name, email: newUser.email }
        });
    }
    catch (error) {
        console.error("Register Error:", error);
        if (error.message && error.message.includes("duplicate key error")) {
            return res.status(409).json({ error: "Email already in use" });
        }
        res.status(500).json({ error: "Server Error during registration" });
    }
};
exports.registerUser = registerUser;
