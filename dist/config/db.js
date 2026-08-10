"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const connectDB = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error("MONGODB_URI environment variable is not defined");
        }
        await mongoose_1.default.connect(process.env.MONGODB_URI);
        console.log("MongoDB Connected");
    }
    catch (error) {
        console.error("Database connection failed:", error);
        throw error;
    }
};
exports.default = connectDB;
