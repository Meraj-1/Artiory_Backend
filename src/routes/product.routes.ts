import { Router } from "express";
import multer from "multer";
import {
  getDashboardProducts,
  getStoreProducts,
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  publishProduct,
  unpublishProduct,
  uploadProductImage,
} from "../controllers/product.controller";
import { protect } from "../middleware/auth_middleware";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Public
router.get("/dashboard", getDashboardProducts);
router.get("/store", getStoreProducts);
router.get("/", getProducts);
router.get("/:id", getProductById);

// Protected
router.post("/", protect, upload.any(), createProduct);
router.put("/:id", protect, upload.any(), updateProduct);
router.delete("/:id", protect, deleteProduct);
router.patch("/:id/publish", protect, publishProduct);
router.patch("/:id/unpublish", protect, unpublishProduct);
router.post("/:id/upload-image", protect, upload.any(), uploadProductImage);

export default router;
