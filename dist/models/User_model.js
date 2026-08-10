"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const userSchema = new mongoose_1.default.Schema({
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
}, {
    timestamps: true
});
exports.default = mongoose_1.default.model("User", userSchema);
