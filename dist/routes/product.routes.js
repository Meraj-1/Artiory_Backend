"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const product_controller_1 = require("../controllers/product.controller");
const auth_middleware_1 = require("../middleware/auth_middleware");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
// Public
router.get("/dashboard", product_controller_1.getDashboardProducts);
router.get("/store", product_controller_1.getStoreProducts);
router.get("/", product_controller_1.getProducts);
router.get("/:id", product_controller_1.getProductById);
// Protected
router.post("/", auth_middleware_1.protect, upload.any(), product_controller_1.createProduct);
router.put("/:id", auth_middleware_1.protect, upload.any(), product_controller_1.updateProduct);
router.delete("/:id", auth_middleware_1.protect, product_controller_1.deleteProduct);
router.patch("/:id/publish", auth_middleware_1.protect, product_controller_1.publishProduct);
router.patch("/:id/unpublish", auth_middleware_1.protect, product_controller_1.unpublishProduct);
router.post("/:id/upload-image", auth_middleware_1.protect, upload.any(), product_controller_1.uploadProductImage);
exports.default = router;
