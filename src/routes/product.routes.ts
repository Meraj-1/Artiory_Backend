import { Router } from "express";
import multer from "multer";
import {
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
router.get("/", getProducts);
router.get("/:id", getProductById);

// Protected
router.post("/", protect, upload.single("image"), createProduct);
router.put("/:id", protect, upload.single("image"), updateProduct);
router.delete("/:id", protect, deleteProduct);
router.patch("/:id/publish", protect, publishProduct);
router.patch("/:id/unpublish", protect, unpublishProduct);
router.post("/:id/upload-image", protect, upload.single("image"), uploadProductImage);

export default router;
