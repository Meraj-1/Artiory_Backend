"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const orderSchema = new mongoose_1.default.Schema({
    user: {
        type: mongoose_1.default.Schema.Types.ObjectId,
        required: true,
        ref: "User"
    },
    orderItems: [
        {
            productId: { type: mongoose_1.default.Schema.Types.ObjectId, ref: "Product", required: true },
            name: { type: String, required: true },
            qty: { type: Number, required: true },
            price: { type: Number, required: true }
        }
    ],
    totalPrice: {
        type: Number,
        required: true,
        default: 0.0
    },
    status: {
        type: String,
        required: true,
        default: "Pending", // Pending, Paid, Delivered, Cancelled
    },
    awbNumber: {
        type: String
    },
    courierName: {
        type: String
    },
    logisticsOrderId: {
        type: String
    },
    shipmentStatus: {
        type: String,
        required: true,
        default: "Unshipped" // Unshipped, Shipped, In-Transit, Delivered, RTO
    },
    shippingLabelUrl: {
        type: String
    },
    clientTxnId: {
        type: String
    }
}, {
    timestamps: true
});
exports.default = mongoose_1.default.model("Order", orderSchema);
