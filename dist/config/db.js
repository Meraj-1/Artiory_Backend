"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const FALLBACK_URI = "mongodb+srv://clicktrick11_db_user:3KZo2K0QoU56K5dA@cluster0.umw4qh1.mongodb.net/test?retryWrites=true&w=majority";
let cachedPromise = null;
const connectDB = async () => {
    if (mongoose_1.default.connection.readyState === 1) {
        return mongoose_1.default;
    }
    if (!cachedPromise) {
        const uri = process.env.MONGODB_URI || FALLBACK_URI;
        cachedPromise = mongoose_1.default.connect(uri, {
            bufferCommands: false,
            serverSelectionTimeoutMS: 5000,
        }).then((m) => {
            console.log("MongoDB Connected successfully");
            return m;
        }).catch((err) => {
            cachedPromise = null;
            console.error("Database connection failed:", err.message);
            throw err;
        });
    }
    await cachedPromise;
    return mongoose_1.default;
};
exports.default = connectDB;
