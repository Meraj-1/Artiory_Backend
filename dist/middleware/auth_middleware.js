"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.protect = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const User_model_1 = __importDefault(require("../models/User_model"));
const protect = async (req, res, next) => {
    let token;
    const authHeader = (req.headers.authorization || req.headers["x-auth-token"] || req.headers["x-access-token"]);
    if (authHeader) {
        token = authHeader.startsWith("Bearer ")
            ? authHeader.split(" ")[1]
            : authHeader;
    }
    if (token) {
        // 1. Quietly handle admin bypass token to avoid false jwt verification error logging
        if (token.startsWith("artiory-token-")) {
            const adminEmail = process.env.ADMIN_EMAIL || "admin@artiory.com";
            let adminUser = await User_model_1.default.findOne({ email: adminEmail });
            if (!adminUser) {
                adminUser = await User_model_1.default.create({
                    name: "Admin User",
                    email: adminEmail,
                    googleId: "admin-dev-id",
                });
            }
            req.user = adminUser;
            return next();
        }
        // 2. Verify standard database user JWT
        try {
            const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
            const user = await User_model_1.default.findById(decoded.id).select("-googleId");
            if (user) {
                req.user = user;
                return next();
            }
        }
        catch (error) {
            console.error("JWT Verification Error:", error);
            return res.status(401).json({ message: "Not authorized, token failed" });
        }
    }
    return res.status(401).json({ message: "Not authorized, no token" });
};
exports.protect = protect;
