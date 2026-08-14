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
  listProduct,
  unlistProduct,
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
router.patch("/:id/list", protect, listProduct);
router.patch("/:id/unlist", protect, unlistProduct);
router.post("/:id/upload-image", protect, upload.any(), uploadProductImage);

export default router;
