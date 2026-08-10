"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importStar(require("mongoose"));
const productSchema = new mongoose_1.Schema({
    productName: {
        type: String,
        required: true,
        trim: true,
    },
    skuCode: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        uppercase: true,
    },
    category: {
        type: String,
        default: "",
    },
    subCategory: {
        type: String,
        default: "",
    },
    variants: [
        {
            color: String,
            design: String,
            sellingPrice: Number,
            mrp: Number,
            stockQuantity: Number,
            imageUrl: String,
        },
    ],
    sellingPrice: {
        type: Number,
        default: 0,
    },
    mrp: {
        type: Number,
        default: 0,
    },
    stockQuantity: {
        type: Number,
        default: 0,
    },
    shortDescription: {
        type: String,
        default: "",
    },
    detailedDescription: {
        type: String,
        default: "",
    },
    weight: {
        type: Number,
        default: 0,
    },
    dimensions: {
        length: Number,
        width: Number,
        height: Number,
    },
    gst: {
        type: Number,
        default: 0,
    },
    active: {
        type: Boolean,
        default: true,
    },
    published: {
        type: Boolean,
        default: false,
    },
    thumbnail: {
        type: String,
        default: "",
    },
    images: [{ type: String }],
}, {
    timestamps: true,
});
exports.default = mongoose_1.default.model("Product", productSchema);
